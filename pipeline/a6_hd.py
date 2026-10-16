"""A6 HD: 1080p renditions of the library clips, next to the 720p ones (which stay as they are).

  clips/p1080/<id>.mp4   1080x1920 centre crop     clips/l1080/<id>.mp4   1920x1080

Same frames as the 720p clip: the same start (0), length (the 720p `read`), fps (read from the 720p file), centre crop
(a4_encode.graph with 1080p sizes, so the same scale/crop/cross-fade) from the Pixabay rendition of the same video.
H.264 High (libx264 veryfast, CRF 21; the first clips medium, CRF 23) capped at 3 Mbps, no audio, faststart.

An orientation gets a 1080p rendition only when a source rendition reaches it with <= 1.25x upscaling (the rule
a4_candidates uses for 720p); otherwise that clip keeps only its 720p for that orientation. Portrait 1080x1920 from a
1920x1080 source would be a 1.78x upscale, so portrait HD needs a 4K / 1440p+ landscape source or a portrait one.

Each clip: the first seconds of the chosen rendition are copied into cache/hd_src/ (ffmpeg range requests, no
re-encode), encoded into cache/media/clips/{p,l}1080/, checked against the 720p clip (frame count, and frame 0 compared
pixel by pixel at a small size: a different crop or start would show), uploaded to R2 through the ingest endpoint
(new keys only; nothing existing is ever overwritten or deleted), and the source copy is deleted. Outcomes land in
cache/hd/<id>.json (network failures are not saved, so a rerun retries them) and every event in out/hd_log.jsonl.
Then out/hd.json ({id: {portrait?, landscape?}}) is written, `hd` is set on the clips in out/clips.json, and that file is
published to apps/web/public/data/ (a4_publish.py adds the same field from out/hd.json on its next run).

  python a6_hd.py                         # everything still missing, 3 workers
  python a6_hd.py --ids pb1,pb2 --no-upload --no-publish   # dry run for a few clips
New clips (after a4_encode/a4_publish): run `python a6_hd.py` again; it only does the clips it has no outcome for.
Pixabay metadata comes from the cached search results in cache/pixabay/ (an API lookup by id only when missing).
"""
import argparse
import json
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests

from a4_encode import FADE, LOOP_MAX, graph, paths as paths720, probe, run_cdn
from common import CACHE, OUT, WORKER, WorkerError, log, publish, put_media, read_json, write_json

SIZES = {"p": (1080, 1920), "l": (1920, 1080)}
NAMES = {"p": "portrait", "l": "landscape"}
MAX_UP = 1.25
SRC = CACHE / "hd_src"
META = CACHE / "hd"
LOG = OUT / "hd_log.jsonl"
# veryfast/CRF 21 (from 2026-10-08 20:10; the first ~90 clips used medium/CRF 23): about half the CPU of medium at a
# similar size and look. h264_videotoolbox was 3x cheaper still but blocky on dark flat backgrounds, so not used.
ENC = ["-an", "-c:v", "libx264", "-threads", "3", "-preset", "veryfast", "-profile:v", "high", "-crf", "21", "-maxrate", "3000k",
       "-bufsize", "6000k", "-g", "60", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
MAX_FRAME0_DIFF = 8.0  # mean abs difference (0-255) of frame 0 at 160x90 vs the 720p clip
MAX_MEAN_DIFF = 4.0    # the same over every frame; re-encodes measure ~0.5-1.5, a one-frame shift in a moving clip ~7
_lock = threading.Lock()


def key(o, cid):
    return f"clips/{o}1080/{cid}.mp4"


def local(o, cid):
    return CACHE / "media" / key(o, cid)


def event(**kw):
    with _lock, LOG.open("a") as f:
        f.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), **kw}) + "\n")


def pixabay_videos():
    """id -> Pixabay `videos` (all renditions) from the cached search results."""
    out = {}
    for f in (CACHE / "pixabay").glob("*.json"):
        for h in read_json(f).get("hits", []):
            out[f"pb{h['id']}"] = h["videos"]
    return out


def lookup(cid):
    """Pixabay API lookup by id (cached in cache/pixabay/id/), with backoff on 429. The key is never printed."""
    path = CACHE / "pixabay" / "id" / f"{cid}.json"
    data = read_json(path)
    while data is None:
        key_ = os.getenv("PIXABAY_API_KEY")
        try:
            r = requests.get("https://pixabay.com/api/videos/", timeout=30, params={"key": key_, "id": cid[2:]})
        except requests.RequestException as e:
            raise OSError(f"Pixabay lookup {cid}: {type(e).__name__}") from None
        if r.status_code == 429:
            time.sleep(int(r.headers.get("X-RateLimit-Reset", 30)) + 1)
            continue
        if not r.ok:
            raise OSError(f"Pixabay lookup {cid}: HTTP {r.status_code}")
        data = r.json()
        write_json(path, data)
        time.sleep(0.7)  # 100 requests/minute
    hits = data.get("hits") or []
    return hits[0]["videos"] if hits else {}


def upscale(r, o):
    w, h = SIZES[o]
    return max(w / r["width"], h / r["height"])


def plans(videos):
    """-> [(rendition, orientations)], best first: the smallest renditions that reach every orientation any rendition
    reaches, then the ones that reach fewer. Empty when no rendition reaches 1080p."""
    rends = [r for r in videos.values() if r.get("url") and r.get("width") and r.get("height")]
    out = []
    for r in sorted(rends, key=lambda r: r.get("size") or r["width"] * r["height"]):
        if reach := [o for o in SIZES if upscale(r, o) <= MAX_UP]:
            out.append((r, reach))
    return sorted(out, key=lambda x: -len(x[1]))  # stable: smallest first within the same reach


def largest(videos):
    r = max((r for r in videos.values() if r.get("width")), key=lambda r: r["width"] * r["height"], default=None)
    return f"{r['width']}x{r['height']}" if r else "none"


def stream(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                        "stream=width,height,r_frame_rate,nb_read_packets:format=duration,bit_rate", "-of", "json",
                        str(path)], capture_output=True, text=True, check=True)
    info = json.loads(r.stdout)
    s = info["streams"][0]
    num, _, den = s["r_frame_rate"].partition("/")
    return {"w": s["width"], "h": s["height"], "fps": float(num) / float(den or 1), "frames": int(s["nb_read_packets"]),
            "duration": float(info["format"]["duration"]), "kbps": round(int(info["format"]["bit_rate"]) / 1000)}


def frames(path, w, h):
    """Every frame, grey, at w x h."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"scale={w}:{h}:flags=area",
                        "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.uint8).reshape(-1, h, w).astype(np.float32)


def compare(hd_path, sd_path, o):
    """Frame-by-frame difference of the HD clip and the 720p clip, both at 160x90 (or 90x160)."""
    w, h = (90, 160) if o == "p" else (160, 90)
    a, b = frames(hd_path, w, h), frames(sd_path, w, h)
    n = min(len(a), len(b))
    d = np.abs(a[:n] - b[:n]).mean(axis=(1, 2))
    return {"frames": len(a), "frames_720": len(b), "frame0_diff": round(float(d[0]), 2),
            "mean_diff": round(float(d.mean()), 2), "max_diff": round(float(d.max()), 2)}


def fetch(cid, url, read):
    """Copy the first read + 1 s of the source (stream copy, range requests) into cache/hd_src/."""
    dest = SRC / f"{cid}.mp4"
    if dest.exists():
        return dest
    SRC.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part.mp4")
    r = run_cdn(["ffmpeg", "-y", "-v", "error", "-rw_timeout", "20000000", "-t", f"{read + 1:.3f}", "-i", url,
                 "-map", "0:v:0", "-c", "copy", "-an", str(tmp)], timeout=600)
    if r.returncode:
        tmp.unlink(missing_ok=True)
        raise OSError("download: " + r.stderr[-200:])
    tmp.replace(dest)
    return dest


def process(job):
    cid, c, videos, upload = job
    mp = META / f"{cid}.json"
    meta = read_json(mp) or {"id": cid}
    outs = meta.get("outs")
    if outs is not None and all(v["status"] != "ok" or v.get("uploaded") or not upload for v in outs.values()):
        return meta  # final
    try:
        if outs is None:
            enc = read_json(paths720(cid)["meta"])
            v720 = paths720(cid)["p"]
            videos = videos or lookup(cid)
            src = c["source_rendition"]
            # the 720p clip's `read` (a4_encode: min(source duration, 12)); stored as round(read - FADE, 2)
            read = min(round(enc["duration"] + FADE, 2), LOOP_MAX)
            same_aspect = [(r, reach) for r, reach in plans(videos)
                           if abs(r["width"] / r["height"] - src["w"] / src["h"]) <= 0.005 * src["w"] / src["h"]]
            rend, reach, why = None, [], f"largest Pixabay rendition {largest(videos)}: > {MAX_UP}x upscale"
            errors = []
            for r, rr in same_aspect:  # some renditions of a video are shorter cuts: take one that covers the 720p clip
                try:
                    dur = probe(r["url"])["duration"]
                except OSError as e:
                    errors.append(str(e)[-80:])
                    continue
                if dur >= read - 0.05:
                    rend, reach = r, rr
                    break
                why = f"the 1080p+ renditions are shorter ({dur:.1f}s) than the 720p clip ({read:.2f}s)"
            if not same_aspect and plans(videos):
                why = f"the 1080p+ renditions have another aspect than the 720p source {src['w']}x{src['h']}"
            if not reach and errors:  # not saved: a rerun tries again
                raise OSError("probe: " + errors[0])
            skips = {o: {"status": "skip", "reason": why} for o in SIZES if o not in reach}
            if not reach:
                event(id=cid, step="skip", reason=why)
                return save(mp, {"id": cid, "outs": skips})
            info720 = stream(v720)
            src_file = fetch(cid, rend["url"], read)
            fps = round(info720["fps"], 3)
            for o in reach:
                local(o, cid).parent.mkdir(parents=True, exist_ok=True)
            t0 = time.time()
            maps = [a for o in reach for a in ("-map", f"[{o}]", *ENC, str(local(o, cid)))]
            r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-filter_complex_threads", "2", "-threads", "2", "-hwaccel", "videotoolbox",
                                "-t", f"{read:.3f}", "-i", str(src_file),
                                "-filter_complex", graph(read, fps if fps % 1 else int(fps), [(o, *SIZES[o]) for o in reach]),
                                *maps], capture_output=True, text=True, timeout=1800)
            if r.returncode:
                raise OSError("ffmpeg: " + r.stderr[-200:])
            secs = round(time.time() - t0, 1)
            outs = dict(skips)
            for o in reach:
                hd, cmp = stream(local(o, cid)), compare(local(o, cid), paths720(cid)[o], o)
                # the 720p clips sometimes have one more frame at the end (same command, same frames otherwise)
                ok = ((hd["w"], hd["h"]) == SIZES[o] and abs(cmp["frames"] - cmp["frames_720"]) <= 1
                      and cmp["frame0_diff"] <= MAX_FRAME0_DIFF and cmp["mean_diff"] <= MAX_MEAN_DIFF)
                outs[o] = {"status": "ok" if ok else "mismatch", "bytes": local(o, cid).stat().st_size, "kbps": hd["kbps"],
                           **cmp, "fps": hd["fps"], "duration": round(hd["duration"], 3)}
                if not ok:
                    local(o, cid).unlink(missing_ok=True)
            meta = {"id": cid, "rendition": {"name": next((n for n, v in (videos or {}).items() if v.get("url") == rend["url"]), None),
                                              "w": rend["width"], "h": rend["height"]},
                    "read": read, "fps": fps, "encoder": "x264 veryfast crf21", "encode_s": secs, "src_bytes": src_file.stat().st_size, "outs": outs}
            event(id=cid, step="encoded", rendition=meta["rendition"], encode_s=secs,
                  outs={o: {k: v[k] for k in v if k in ("status", "bytes", "kbps", "frame0_diff", "mean_diff", "reason")} for o, v in outs.items()})
            save(mp, meta)
        if upload:
            for o, v in meta["outs"].items():
                if v["status"] == "ok" and not v.get("uploaded"):
                    if in_r2(key(o, cid)):  # never overwrite: an object already there (an earlier run) stays
                        event(id=cid, step="exists", key=key(o, cid))
                    else:
                        put_media(key(o, cid), local(o, cid).read_bytes(), "video/mp4")
                        event(id=cid, step="uploaded", key=key(o, cid), bytes=v["bytes"])
                    v["uploaded"] = True
            save(mp, meta)
            (SRC / f"{cid}.mp4").unlink(missing_ok=True)
        return meta
    except (subprocess.SubprocessError, OSError, ValueError, KeyError, WorkerError) as e:
        reason = f"{type(e).__name__} {str(e)[:200]}"
        event(id=cid, step="failed", reason=reason)
        return {"id": cid, "failed": reason}


def in_r2(k):
    """True when the bucket already has key k (a 1-byte range read through the Worker's public /media/ route)."""
    for attempt in range(4):
        try:
            r = requests.get(f"{WORKER}/media/{k}", headers={"Range": "bytes=0-0"}, timeout=30)
            if r.status_code in (200, 206):
                return True
            if r.status_code == 404:
                return False
        except requests.RequestException:
            pass
        time.sleep(5 * (attempt + 1))
    raise OSError(f"cannot tell whether {k} exists")


def save(path, meta):
    write_json(path, meta)
    return meta


def hd_field(meta):
    return {NAMES[o]: key(o, meta["id"]) for o in SIZES
            if meta.get("outs", {}).get(o, {}).get("status") == "ok" and meta["outs"][o].get("uploaded")}


def write_catalogue(ids):
    """out/hd.json from the uploaded renditions, then `hd` on the clips in out/clips.json, published."""
    hd = {}
    for cid in ids:
        if f := hd_field(read_json(META / f"{cid}.json", {"id": cid})):
            hd[cid] = f
    write_json(OUT / "hd.json", hd)
    clips = read_json(OUT / "clips.json")
    for c in clips:
        c.pop("hd", None)
        if c["id"] in hd:
            c["hd"] = hd[c["id"]]
    write_json(OUT / "clips.json", clips)
    publish(OUT / "clips.json")
    log(f"hd.json: {len(hd)} clips with HD ({sum('portrait' in v for v in hd.values())} portrait, "
        f"{sum('landscape' in v for v in hd.values())} landscape)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ids", help="comma-separated clip ids (default: every clip in out/clips.json)")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--no-upload", action="store_true", help="encode and check only (keeps cache/hd_src/)")
    ap.add_argument("--no-publish", action="store_true", help="do not write out/hd.json or clips.json")
    args = ap.parse_args()
    cands = {c["id"]: c for c in read_json(OUT / "candidates.json")}
    library = [c["id"] for c in read_json(OUT / "clips.json")]
    ids = args.ids.split(",") if args.ids else library
    videos = pixabay_videos()
    META.mkdir(parents=True, exist_ok=True)
    log(f"{len(ids)} clips, {args.workers} workers{'' if not args.no_upload else ', no upload'}")
    results, t0 = [], time.time()
    with ThreadPoolExecutor(args.workers) as ex:
        jobs = [(cid, cands[cid], videos.get(cid), not args.no_upload) for cid in ids]
        for i, m in enumerate(ex.map(process, jobs), 1):
            results.append(m)
            if i % 20 == 0 or i == len(ids):
                log(f"  {i}/{len(ids)} ({(time.time() - t0) / 60:.0f} min)")
    failed = [m for m in results if "failed" in m]
    count = {}
    for m in results:
        for o, v in m.get("outs", {}).items():
            count[(o, v["status"])] = count.get((o, v["status"]), 0) + 1
    log("outcomes:", {f"{o}:{s}": n for (o, s), n in sorted(count.items())}, f"failed {len(failed)}")
    for m in failed[:10]:
        log("  failed", m["id"], m["failed"])
    if not args.no_publish:
        write_catalogue(library)


if __name__ == "__main__":
    main()
