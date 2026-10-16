"""A4.3 encode: for the selected clips only, ffmpeg reads the first <= 12 s straight from the source URL (HTTP range
requests, the rest of the video is never fetched) and writes, per the contracts:

  clips/p/<id>.mp4   720x1280 centre crop      posters/p/<id>.jpg   frame at 1 s, 720x1280
  clips/l/<id>.mp4   1280x720                  posters/l/<id>.jpg   frame at 1 s, 1280x720
  thumbs/<id>.webp   240x426 (portrait)

H.264 CRF 28, no audio, faststart. The last second is cross-faded into the first, so the loop has no jump.
Then the real clip is checked again: a pixel test for green-screen assets on the poster, and Luna on three frames
(a preview frame cannot show what appears later). A clip encoded before a safety question was added is checked again
with the current questions.
Everything lands in cache/media/ and cache/encoded/<id>.json, so a rerun only does what is missing.

The published library (out/encoded.json) is always the start of the queue, so a rerun or a larger --keep only adds
clips: a library clip leaves only when it fails the safety checks or a person removes it (a4_screen.REMOVED).
"""
import argparse
import json
import re
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

from a4_screen import CONTEXT, QUESTIONS, REJECT_AT, tag_blocked
from common import BudgetExceeded, CACHE, LunaError, load_image, log, luna, out_dir, read_json, to_data_url, \
    write_costs, write_json

MEDIA = CACHE / "media"
LOOP_MAX = 12.0   # seconds read from the source
FADE = 1.0        # seconds of cross-fade at the loop point
VERIFY = {k: QUESTIONS[k] for k in REJECT_AT}
VERIFY_CONTEXT = "Three frames from one short stock video loop, considered as a background for a Quran verse."
FILES = ("p", "l", "pp", "pl", "thumb")


def paths(cid):
    return {
        "p": MEDIA / "clips/p" / f"{cid}.mp4", "l": MEDIA / "clips/l" / f"{cid}.mp4",
        "pp": MEDIA / "posters/p" / f"{cid}.jpg", "pl": MEDIA / "posters/l" / f"{cid}.jpg",
        "thumb": MEDIA / "thumbs" / f"{cid}.webp", "meta": CACHE / "encoded" / f"{cid}.json",
    }


def bytes_read(stderr):
    """ffmpeg/ffprobe (-v verbose) print 'Statistics: N bytes read, M seeks' when the HTTP connection closes."""
    return sum(int(n) for n in re.findall(r"Statistics: (\d+) bytes read", stderr))


def run_cdn(cmd, **kw):
    """subprocess.run that waits and retries when the Pixabay CDN answers 429 (too many requests)."""
    for attempt in range(4):
        r = subprocess.run(cmd, capture_output=True, text=True, **kw)
        if r.returncode == 0 or "429" not in r.stderr:
            return r
        time.sleep(30 * (attempt + 1))
    return r


def probe(url):
    r = run_cdn(
        ["ffprobe", "-v", "verbose", "-rw_timeout", "20000000", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,avg_frame_rate:format=duration", "-of", "json", url], timeout=90)
    if r.returncode:
        raise OSError("ffprobe: " + r.stderr[-150:])
    info = json.loads(r.stdout[r.stdout.index("{"):r.stdout.rindex("}") + 1])
    num, _, den = info["streams"][0]["avg_frame_rate"].partition("/")
    return {"fps": float(num) / float(den or 1), "duration": float(info["format"]["duration"]), "read": bytes_read(r.stderr)}


def graph(read, fps, outs=(("p", 720, 1280), ("l", 1280, 720))):
    """Scale/crop to each (label, w, h) in outs, then fold the last FADE seconds over the start (seamless loop).
    a6_hd.py calls it with 1080p sizes, so the HD renditions get the same crop, trim and loop."""
    loop = read - FADE

    def branch(src, w, h, tag):
        return (
            f"[{src}]scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h},setsar=1,split[{tag}m][{tag}t];"
            f"[{tag}m]trim=0:{loop:.3f},setpts=PTS-STARTPTS[{tag}main];"
            f"[{tag}t]trim={loop:.3f}:{read:.3f},setpts=PTS-STARTPTS,format=yuva420p,fade=t=out:st=0:d={FADE}:alpha=1[{tag}tail];"
            f"[{tag}main][{tag}tail]overlay=eof_action=pass,format=yuv420p[{tag}]"
        )
    splits = "".join(f"[s{i}]" for i in range(len(outs)))
    return (f"[0:v]setpts=PTS-STARTPTS,fps={fps},split={len(outs)}{splits};"
            + ";".join(branch(f"s{i}", w, h, tag) for i, (tag, w, h) in enumerate(outs)))


def encode(c):
    """Encode one clip. Returns the meta dict (also saved), status 'ok', 'rejected' or 'failed'."""
    p = paths(c["id"])
    meta = read_json(p["meta"])  # only final outcomes are saved: ok, rejected, too short
    if meta and meta["status"] != "ok":
        return meta
    if meta and all(p[k].exists() for k in FILES):
        return meta if set(VERIFY) <= set(meta.get("checked", ())) else check(p, meta)
    url = c["source_rendition"]["url"]
    try:
        info = probe(url)
        read = min(info["duration"], LOOP_MAX)
        if read < 6:
            return save(p, {"id": c["id"], "status": "failed", "reason": f"too short ({read:.1f}s)"})
        for k in FILES:
            p[k].parent.mkdir(parents=True, exist_ok=True)
        enc = ["-an", "-c:v", "libx264", "-preset", "medium", "-crf", "28", "-maxrate", "2200k", "-bufsize", "4400k",
               "-g", "60", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
        r = run_cdn(
            ["ffmpeg", "-y", "-v", "verbose", "-rw_timeout", "20000000", "-t", f"{read:.3f}", "-i", url,
             "-filter_complex", graph(read, min(round(info["fps"]), 30)), "-map", "[p]", *enc, str(p["p"]),
             "-map", "[l]", *enc, str(p["l"])], timeout=600)
        if r.returncode:  # not saved: usually a network hiccup, so a rerun tries again
            return {"id": c["id"], "status": "failed", "reason": "ffmpeg: " + r.stderr[-200:]}
        for o in ("p", "l"):
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "1", "-i", str(p[o]), "-frames:v", "1", "-q:v", "3",
                            str(p["pp" if o == "p" else "pl"])], check=True)
        Image.open(p["pp"]).convert("RGB").resize((240, 426), Image.LANCZOS).save(p["thumb"], quality=75)
        meta = {"id": c["id"], "status": "ok", "duration": round(read - FADE, 2), "src_bytes_read": info["read"] + bytes_read(r.stderr),
                "bytes": {k: p[k].stat().st_size for k in FILES}}
        return check(p, meta)
    except (subprocess.SubprocessError, OSError, ValueError, KeyError, LunaError) as e:
        return {"id": c["id"], "status": "failed", "reason": f"{type(e).__name__} {str(e)[:150]}"}


def check(p, meta):
    """Safety check of the encoded clip (green-screen pixels, then Luna on three frames); a failed clip is deleted."""
    flagged = ["key_green_pixels"] if key_green(p["pp"]) > 0.5 else verify(p["p"], meta["duration"])
    meta = meta | {"checked": sorted(VERIFY)}
    if flagged:
        meta |= {"status": "rejected", "reason": "frames: " + ",".join(flagged)}
        for k in FILES:
            p[k].unlink(missing_ok=True)
    return save(p, meta)


def key_green(poster):
    """Share of the poster in saturated chroma-key green (hue 90-150 degrees, saturation >= 85 %, value >= 35 %).
    On the 715 encoded clips: two green-screen assets 0.74 and 0.81, the greenest real scene (grass) 0.23."""
    h, s, v = np.moveaxis(np.asarray(Image.open(poster).convert("HSV").resize((90, 160)), dtype=int), -1, 0)
    return float(((h >= 64) & (h <= 106) & (s >= 217) & (v >= 89)).mean())


def verify(video, duration):
    """Luna safety questions over frames at 25/50/75 % of the encoded portrait clip -> names of the failed ones."""
    state = [VERIFY_CONTEXT]
    with tempfile.TemporaryDirectory() as d:
        for i, frac in enumerate((0.25, 0.5, 0.75)):
            f = Path(d) / f"{i}.jpg"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{duration * frac:.2f}", "-i", str(video),
                            "-frames:v", "1", "-vf", "scale=360:640", str(f)], check=True)
            state.insert(0, {"type": "image_url", "image_url": {"url": to_data_url(load_image(f, 640), 75)}})
    a = luna("a4_verify", state, VERIFY, timeouts=(10, 20, 40))
    return [k for k in VERIFY if a[k]["noul"] >= REJECT_AT[k]]


def save(path_map, meta):
    write_json(path_map["meta"], meta)
    return meta


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--subset", action="store_true")
    ap.add_argument("--keep", type=int,
                    help="library size to reach (default: the current library, or 1200 / subset 80 for a first run); "
                         "never fewer than the clips already in the library")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    d = out_dir(args.subset)
    cands = {c["id"]: c for c in read_json(d / "candidates.json")}
    library = [cands[i] for i in read_json(d / "encoded.json", []) if i in cands and not tag_blocked(cands[i])]
    known = {c["id"] for c in library}
    keep = max(args.keep or 0, len(library)) or (80 if args.subset else 1200)
    selected = [cands[s["id"]] for s in read_json(d / "selected.json")]
    queue = library + [c for c in selected if c["id"] not in known and not tag_blocked(c)]
    log(f"library {len(library)} clips, target {keep}")
    results, ok = {}, 0

    def kept(m):  # a library clip leaves only when a safety check rejects it, never on a network or Luna hiccup
        return m["status"] == "ok" or (m["id"] in known and m["status"] != "rejected")
    try:
        while ok < keep and queue:  # waves: clips rejected after encoding are replaced by the next best ones
            wave, queue = queue[:keep - ok], queue[keep - ok:]
            with ThreadPoolExecutor(args.workers) as ex:
                for i, m in enumerate(ex.map(encode, wave), 1):
                    results[m["id"]] = m
                    ok += kept(m)
                    if i % 20 == 0:
                        log(f"  {ok} ok so far ({len(results)} tried)")
    except BudgetExceeded as e:
        log("STOPPED:", e)
    finally:
        write_costs()
    good = [m for m in results.values() if m["status"] == "ok"]
    bad = {}
    for m in results.values():
        if m["status"] != "ok":
            bad.setdefault(m["status"], []).append(f"{m['id']}: {m['reason']}")
    log(f"{len(good)} clips encoded; avg {sum(sum(m['bytes'][k] for k in ('p', 'l')) for m in good) / max(1, len(good)) / 1e6:.2f} MB "
        f"for both videos; source bytes read {sum(m['src_bytes_read'] for m in good) / 1e6:.0f} MB")
    for status, items in bad.items():
        log(f"{status}: {len(items)}", *items[:5])
    write_json(d / "encoded.json", [c["id"] for c in library if c["id"] not in results or kept(results[c["id"]])]
               + [m["id"] for m in good if m["id"] not in known])


if __name__ == "__main__":
    main()
