#!/usr/bin/env python3
import argparse, concurrent.futures as cf, json, re, sys, urllib.request
from html import unescape
import linkgate as lg

CHANNELS = {"Databricks": "UC3q8O3Bh2Le8Rj1-Q-_UUbA", "Databricks Events": "UCwIpYgnm52xKoQKYZwoRTug"}
FEED = "https://www.youtube.com/feeds/videos.xml?channel_id="
CAP = 8
GONE = re.compile(r"HTTP Error (401|404)|oembed http (401|404)")
DBX = re.compile(r"^https?://([a-z0-9-]+\.)*databricks\.com(/|$)")
GENERIC = {"Apps": "an everyday word in titles", "Bronze": "a medallion layer named in many titles",
           "Consumers": "an everyday word in titles", "Gold": "a medallion layer named in many titles",
           "Ingest": "an everyday word in titles", "Lakehouse": "names the architecture, not one box",
           "Serve": "an everyday word in titles", "Silver": "a medallion layer named in many titles",
           "Sources": "an everyday word in titles", "Streaming": "an everyday word in titles",
           "Teams": "an everyday word in titles"}
SKIP = {}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": lg.UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def parse_feed(xml):
    out = []
    for e in re.findall(r"<entry>(.*?)</entry>", xml, re.S):
        vid, t = re.search(r"<yt:videoId>([^<]+)</yt:videoId>", e), re.search(r"<title>([^<]*)</title>", e)
        if vid and t:
            out.append((vid.group(1).strip(), unescape(t.group(1)).strip()))
    return out


def boxes_named(title, names):
    hay = " " + lg._norm(title) + " "
    hit = [n for n in names if lg._norm(n) and " " + lg._norm(n) + " " in hay]
    return sorted(n for n in hit if not any(m != n and " " + lg._norm(n) + " " in " " + lg._norm(m) + " " for m in hit))


def box_names(links):
    return [k for k, L in links.items() if isinstance(L, dict) and k not in GENERIC
            and (L.get("doc") or DBX.match(str(L.get("blog") or "")) or DBX.match(str(L.get("site") or "")))]


def plan(links, feed, skip=SKIP, cap=CAP):
    linked = {v.get("id") for L in links.values() if isinstance(L, dict) for v in (L.get("videos") or []) if isinstance(v, dict)}
    names = box_names(links)
    add, full, seen = [], [], set()
    for vid, title in feed:
        if vid in linked or vid in skip or vid in seen:
            continue
        seen.add(vid)
        for n in boxes_named(title, names):
            have = len(links[n].get("videos") or []) + sum(1 for a in add if a[0] == n)
            (full if have >= cap else add).append((n, vid, title))
    return add, full


def unnamed(links, feed, skip=SKIP):
    linked = {v.get("id") for L in links.values() if isinstance(L, dict) for v in (L.get("videos") or []) if isinstance(v, dict)}
    names, out = box_names(links), []
    for vid, title in feed:
        if vid not in linked and vid not in skip and (vid, title) not in out and not boxes_named(title, names):
            out.append((vid, title))
    return out


def verify(links):
    jobs = [(n, v) for n, L in links.items() if isinstance(L, dict)
            for v in (L.get("videos") or []) if isinstance(v, dict) and v.get("id")]
    with cf.ThreadPoolExecutor(12) as ex:
        res = list(ex.map(lambda j: lg.check_video(j[1]["id"], j[0], j[1].get("a")), jobs))
    drift, gone, bad = [], [], []
    for (n, v), (ok, detail) in zip(jobs, res):
        if ok and lg._norm(detail) != lg._norm(v.get("t")):
            drift.append((n, v["id"], detail))
        elif not ok:
            (gone if GONE.search(detail) else bad).append((n, v["id"], detail))
    return drift, gone, bad


def apply(links, drift, gone, add):
    titles = {(n, vid): t for n, vid, t in drift}
    dead = {(n, vid) for n, vid, _ in gone}
    for n, L in links.items():
        if isinstance(L, dict) and L.get("videos"):
            kept = [dict(v, t=titles.get((n, v.get("id")), v.get("t"))) for v in L["videos"] if (n, v.get("id")) not in dead]
            if kept:
                L["videos"] = kept
            else:
                del L["videos"]
    for n, vid, t in add:
        links[n].setdefault("videos", []).append({"id": vid, "t": t})
    return links


def main():
    ap = argparse.ArgumentParser(description="Refresh the board's YouTube highlights: re-verify every linked video on the "
                                             "official Databricks channels, follow title changes, drop videos that are "
                                             "gone, and link new uploads whose title names a board box.")
    ap.add_argument("--check", action="store_true",
                    help="report without writing; exit 1 on a title change, a gone or failing video, or an unlinked new upload")
    args = ap.parse_args()
    links = json.load(open(lg.LINKS_FILE, encoding="utf-8"))
    drift, gone, bad = verify(links)
    feed, ferr = [], []
    for ch, cid in CHANNELS.items():
        try:
            feed += parse_feed(fetch(FEED + cid))
        except Exception as e:
            ferr.append(f"{ch} feed unreadable: {str(e)[:60]}")
    add, full = plan(links, feed)
    n_vid = sum(len(L.get("videos") or []) for L in links.values() if isinstance(L, dict))
    print(f"linked videos: {n_vid}, recent uploads read: {len(feed)} from {len(CHANNELS) - len(ferr)} channels")
    for label, rows in (("title changed", drift), ("gone", gone), ("failing the video rule", bad),
                        ("new upload names a box", add), ("box already holds %d videos" % CAP, full)):
        for n, vid, detail in rows:
            print(f"  {label}: {vid} -> {n}: {detail}")
    for vid, title in unnamed(links, feed):
        print(f"  names no box (link it with an alias 'a' if it belongs to one): {vid}: {title}")
    for e in ferr:
        print("  " + e)
    if args.check:
        sys.exit(1 if (drift or gone or bad or add or ferr) else 0)
    if drift or gone or add:
        lg.write_links(apply(links, drift, gone, add))
        print(f"wrote {lg.LINKS_FILE}: {len(drift)} titles followed, {len(gone)} gone videos dropped, {len(add)} uploads linked")
    sys.exit(1 if (bad or ferr) else 0)


if __name__ == "__main__":
    main()
