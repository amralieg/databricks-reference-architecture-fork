"""
Arch2 — Databricks App backend for the Architecture Assistant.

Serves index.html and exposes the SAME /generate contract the local bridge.js
used ({system,user,model} -> {text}), but instead of shelling out to the local
`claude` CLI it calls a Databricks-hosted Claude Foundation Model serving
endpoint. The frontend's bridge path is unchanged.

Auth: in a Databricks App the injected service-principal OAuth credentials are
used automatically (WorkspaceClient()); locally it falls back to a CLI profile.
"""
import os

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from openai import OpenAI
from databricks.sdk import WorkspaceClient

HERE = os.path.dirname(__file__)
PARENT = os.path.dirname(HERE)  # .../app — the shared static board lives here

# The AI assistant is NOT a forked copy of the board any more. We serve the SHARED
# app/index.html (the exact page the static site publishes) and inject the AI layer
# at request time, so the canvas never drifts from the static board. The AI JS is
# spliced INSIDE the board's own <script> block (the one that defines build()) so it
# shares scope with ARCH / byId / resolveAtom / paintRef / etc.
BASE_HTML = os.path.join(PARENT, "index.html")
AI_CSS = os.path.join(HERE, "ai.css")
AI_JS = os.path.join(HERE, "ai.js")

_page_cache = {"key": None, "html": None}


def _compose_page() -> str:
    """Inject the AI CSS + JS into the shared board HTML.

    The AI JS is spliced just before the close of the MAIN board <script> (the
    block that defines build()) so it runs in the board's own script scope and
    can see ARCH / byId / resolveAtom / paintRef / etc. The AI JS injects its own
    panel DOM into <body> at runtime, so there is no separate HTML splice — that
    keeps this robust against the shared board's markup changing between releases.
    """
    base = open(BASE_HTML, encoding="utf-8").read()
    css = open(AI_CSS, encoding="utf-8").read()
    js = open(AI_JS, encoding="utf-8").read()
    # AI JS before the main board script's close. The board never emits a raw
    # </script> inside a string (it would end the block), so the first one after
    # build() is the real close.
    anchor = base.find("function build(")
    if anchor != -1:
        close = base.find("</script>", anchor)
        if close != -1:
            base = (base[:close]
                    + "\n/* ===== AI assistant (injected) ===== */\n" + js + "\n"
                    + base[close:])
    # AI CSS before the last </style> in <head>.
    head_end = base.find("</head>")
    style_close = base.rfind("</style>", 0, head_end if head_end != -1 else len(base))
    if style_close != -1:
        base = (base[:style_close]
                + "\n/* ===== AI assistant CSS (injected) ===== */\n" + css + "\n"
                + base[style_close:])
    return base


def _page() -> str:
    """Compose once, then reuse until any source file changes on disk."""
    try:
        key = tuple(os.path.getmtime(p) for p in (BASE_HTML, AI_CSS, AI_JS))
    except OSError:
        key = None
    if _page_cache["html"] is None or _page_cache["key"] != key:
        _page_cache["html"] = _compose_page()
        _page_cache["key"] = key
    return _page_cache["html"]

# Model tiers are discovered dynamically from the workspace's serving endpoints
# (see model_tiers()), so a newer Claude version is picked up with no code change.
# These map a tier id to the Claude family it draws from, its label, and default.
# Order is the fast -> thinking spectrum; `default` marks the initial selection.
TIERS = [
    {"id": "fast",     "family": "haiku",  "label": "Fast",     "default": False},
    {"id": "balanced", "family": "sonnet", "label": "Balanced", "default": False},
    {"id": "thinking", "family": "opus",   "label": "Thinking", "default": True},
]
TIER_BY_FAMILY = {t["family"]: t for t in TIERS}
DEFAULT_FAMILY = next(t["family"] for t in TIERS if t["default"])

# Static fallback endpoints, used only if the workspace can't be listed. Also
# env-overridable. Discovery (model_tiers) supersedes these when it succeeds.
FALLBACK_ENDPOINTS = {
    "haiku":  os.environ.get("FAST_ENDPOINT",     "databricks-claude-haiku-4-5"),
    "sonnet": os.environ.get("SERVING_ENDPOINT",  "databricks-claude-sonnet-5"),
    "opus":   os.environ.get("THINKING_ENDPOINT", "databricks-claude-opus-5"),
}
# Optional AI Gateway URL — when set, calls route through the Gateway so usage
# counters / inference tables register. Falls back to the serving-endpoints path.
AI_GATEWAY_URL = os.environ.get("AI_GATEWAY_URL", "")

IS_DATABRICKS_APP = bool(os.environ.get("DATABRICKS_APP_NAME"))

_TIERS_CACHE = None


def _version_key(version: str):
    """Sortable key for a Claude version suffix like '5' or '4-8' (higher = newer)."""
    parts = []
    for chunk in version.split("-"):
        parts.append(int(chunk) if chunk.isdigit() else 0)
    return tuple(parts)


def _discover_endpoints() -> dict:
    """Newest `databricks-claude-<family>-<version>` endpoint per family, from the
    live workspace. Returns {family: endpoint_name}. Empty on any failure."""
    best = {}  # family -> (version_key, name)
    try:
        w = _workspace_client()
        for ep in w.serving_endpoints.list():
            name = getattr(ep, "name", "") or ""
            if not name.startswith("databricks-claude-"):
                continue
            rest = name[len("databricks-claude-"):]        # e.g. "opus-5", "haiku-4-5"
            head, _, version = rest.partition("-")          # family, "-", version suffix
            if head not in TIER_BY_FAMILY or not version:
                continue
            vk = _version_key(version)
            if head not in best or vk > best[head][0]:
                best[head] = (vk, name)
    except Exception:
        return {}
    return {fam: nm for fam, (vk, nm) in best.items()}


def model_tiers() -> list:
    """The selectable tiers, resolved to live endpoints (cached per process).
    Falls back to FALLBACK_ENDPOINTS for any family discovery didn't return."""
    global _TIERS_CACHE
    if _TIERS_CACHE is not None:
        return _TIERS_CACHE
    discovered = _discover_endpoints()
    out = []
    for t in TIERS:
        fam = t["family"]
        endpoint = discovered.get(fam) or FALLBACK_ENDPOINTS.get(fam)
        if not endpoint:
            continue
        out.append({"id": t["id"], "label": t["label"], "endpoint": endpoint,
                    "default": t["default"]})
    _TIERS_CACHE = out
    return out


def _resolve_endpoint(model) -> str:
    """Map a frontend tier id to a live serving endpoint, validating against the
    discovered allowlist; fall back to the default tier for anything unknown."""
    tiers = model_tiers()
    by_id = {t["id"]: t["endpoint"] for t in tiers}
    if model in by_id:
        return by_id[model]
    default = next((t["endpoint"] for t in tiers if t["default"]), None)
    return default or FALLBACK_ENDPOINTS[DEFAULT_FAMILY]

app = FastAPI(title="Arch2 Architecture Assistant")

# Content-Security-Policy. The Databricks Apps proxy injects no security response
# headers, so the app sets its own on every response. The composed page carries
# large inline <script>/<style> blocks (so script/style need 'unsafe-inline')
# and pulls pdf.js from cdnjs. The AI assistant talks only to this app's own
# /generate endpoint (same origin), so connect-src is 'self'. The policy forbids
# framing and constrains object/base-uri and the allowed script origins.
CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("Content-Security-Policy", CSP)
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    return resp


def _content_text(content) -> str:
    """Flatten an assistant message's content to plain text.

    Reasoning models (e.g. databricks-claude-sonnet-5) return content as a list
    of typed blocks (reasoning, text, ...) rather than a string. Keep only the
    text blocks so the frontend receives the JSON string it expects.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") in (None, "text") and block.get("text"):
                    parts.append(block["text"])
            elif getattr(block, "type", None) in (None, "text"):
                parts.append(getattr(block, "text", "") or "")
        return "".join(parts)
    return str(content)


def _workspace_client() -> WorkspaceClient:
    if IS_DATABRICKS_APP:
        return WorkspaceClient()
    profile = os.environ.get("DATABRICKS_PROFILE", "DEFAULT")
    return WorkspaceClient(profile=profile)


def _oauth_token(w: WorkspaceClient) -> str:
    # w.config.token is None for OAuth/U2M; authenticate() returns the header.
    auth = w.config.authenticate()
    if auth and "Authorization" in auth:
        return auth["Authorization"].replace("Bearer ", "")
    return w.config.token or ""


def _llm_client() -> OpenAI:
    w = _workspace_client()
    token = _oauth_token(w)
    if AI_GATEWAY_URL:
        base_url = AI_GATEWAY_URL.rstrip("/")
    else:
        host = w.config.host
        if IS_DATABRICKS_APP:
            host = os.environ.get("DATABRICKS_HOST", host) or ""
            if host and not host.startswith("http"):
                host = f"https://{host}"
        base_url = f"{host.rstrip('/')}/serving-endpoints"
    return OpenAI(api_key=token, base_url=base_url)


@app.get("/health")
def health():
    return {"ok": True, "models": model_tiers()}


@app.get("/models")
def models():
    """The selectable model tiers (id, label, endpoint, default), discovered from
    the workspace's live Claude serving endpoints. The frontend builds its picker
    from this, so a newer Claude version appears with no code change."""
    return {"models": model_tiers()}


@app.post("/generate")
async def generate(req: Request):
    # CSRF: reject cross-origin POSTs. Browsers omit Origin on same-origin
    # requests; when present it must match the app's own URL. The platform gate
    # authenticates the user, but this stops a cross-site page from driving the
    # service-principal-authenticated proxy on a logged-in user's behalf.
    _app_url = os.environ.get("DATABRICKS_APP_URL", "")
    _origin = req.headers.get("origin")
    if _origin and _app_url and _origin.rstrip("/") != _app_url.rstrip("/"):
        return JSONResponse({"error": "Cross-origin request rejected"}, status_code=403)

    try:
        payload = await req.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    # `user` is either a plain string (text-only) or a list of OpenAI content
    # blocks (text + image_url) when the frontend attaches images. Pass either
    # straight through as the user message content.
    user = payload.get("user")
    if isinstance(user, str):
        user = user.strip()
        if not user:
            return JSONResponse({"error": "Missing 'user' prompt"}, status_code=400)
    elif isinstance(user, list):
        if not user:
            return JSONResponse({"error": "Missing 'user' prompt"}, status_code=400)
    else:
        return JSONResponse({"error": "Missing 'user' prompt"}, status_code=400)
    system = payload.get("system") or ""
    # The frontend sends a tier id ("fast"/"balanced"/"thinking"); map it to a
    # serving endpoint via the allowlist. Unknown values fall back to the default.
    model = _resolve_endpoint(payload.get("model"))

    # Bound the request so a single caller can't push an oversized prompt through
    # the shared service principal.
    prompt_size = (len(user) if isinstance(user, str) else len(str(user))) + len(system)
    if prompt_size > 200_000:
        return JSONResponse({"error": "Prompt too large"}, status_code=413)
    # Per-user audit: the proxy runs under the App SP (one identity for all users),
    # so attribute each call to the authenticated user for accountability. stdout
    # is collected as the app log.
    print("audit generate user=%s model=%s bytes=%d"
          % (req.headers.get("x-forwarded-email", "unknown"), model, prompt_size),
          flush=True)

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})

    try:
        client = _llm_client()
        # Note: some Databricks-hosted Claude endpoints (e.g. sonnet-5) reject the
        # `temperature` parameter, so it is deliberately omitted.
        # max_tokens must cover the model's internal reasoning AND the visible
        # JSON: sonnet-5 is a reasoning model, so a small cap can be spent almost
        # entirely on reasoning, leaving the JSON truncated mid-string (the
        # client then throws "unterminated string in JSON"). Give ample headroom.
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=16000,
        )
        choice = resp.choices[0]
        text = _content_text(choice.message.content)
        # A length-capped response is truncated (often mid-JSON) — fail cleanly
        # instead of returning unparseable text the UI would choke on.
        if getattr(choice, "finish_reason", None) == "length":
            return JSONResponse(
                {"error": "The model response was cut off (token limit). Try a shorter "
                          "description or fewer data sources, then retry."},
                status_code=502,
            )
        return {"text": text}
    except Exception as err:  # surfaces cleanly in the chat UI as an error bubble
        return JSONResponse({"error": str(err)}, status_code=502)


# Serve the composed page last so /health, /models and /generate win.
@app.get("/")
@app.get("/index.html")
def index():
    return HTMLResponse(_page())


# ---------------------------------------------------------------------------
# Shared assets from the PARENT app/ dir so <base href="../"> fetches resolve
# when this backend is the origin.  Mounts are added AFTER the explicit routes
# above so those always win.
# ---------------------------------------------------------------------------
from fastapi.staticfiles import StaticFiles  # noqa: E402

for _sub in ("architectures", "resources", "translations", "vendor", "assets", "share"):
    _p = os.path.join(PARENT, _sub)
    if os.path.isdir(_p):
        app.mount("/" + _sub, StaticFiles(directory=_p), name=_sub)


@app.get("/arch_schema.js")
def _arch_schema():
    return FileResponse(os.path.join(PARENT, "arch_schema.js"), media_type="application/javascript")


@app.get("/industry_icons.js")
def _industry_icons():
    return FileResponse(os.path.join(PARENT, "industry_icons.js"), media_type="application/javascript")
