"""A7 previews: small moving versions of the library clips, for the search result tiles.

  previews/<id>.mp4   360x640, from the 720p portrait clip (cache/media/clips/p/<id>.mp4), whole loop, 24 fps

Same frames and loop as the 720p clip (scaled, not re-cut, so the cross-faded loop stays seamless). H.264 Main
(libx264 slow, CRF 30, capped at 500 kbps), no audio, faststart: about 100-400 KB each (the 720p clip is 1-2.5 MB).
Uploaded to R2 through the ingest endpoint (new keys only; nothing existing is ever overwritten or deleted). Outcomes
land in cache/previews/<id>.json (failures are not saved, so a rerun retries them). Then out/previews.json
({id: key}) is written, `preview` is set on the clips in out/clips.json, and that file is published to
apps/web/public/data/ (a4_publish.py adds the same field from out/previews.json on its next run).

  python a7_previews.py                                   # everything still missing, 4 workers
  python a7_previews.py --ids pb1,pb2 --no-upload --no-publish   # dry run for a few clips
New clips (after a4_encode/a4_publish): run `python a7_previews.py` again; it only does the clips it has no outcome for.
"""
import argparse
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

from a4_encode import paths as paths720
from a6_hd import in_r2, save, stream
from common import CACHE, OUT, WorkerError, log, publish, put_media, read_json, write_json

W, H, FPS = 360, 640, 24
ENC = ["-an", "-c:v", "libx264", "-threads", "2", "-preset", "slow", "-profile:v", "main", "-crf", "30", "-maxrate", "500k",
       "-bufsize", "1000k", "-g", "48", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
META = CACHE / "previews"


def key(cid):
    return f"previews/{cid}.mp4"


def local(cid):
    return CACHE / "media" / key(cid)


def process(job):
    cid, upload = job
    mp = META / f"{cid}.json"
    meta = read_json(mp)
    if meta and (meta.get("uploaded") or not upload):
        return meta
    try:
        if not meta:
            src = paths720(cid)["p"]
            if not src.exists():
                raise OSError(f"no 720p portrait clip at {src}")
            local(cid).parent.mkdir(parents=True, exist_ok=True)
            r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vf", f"scale={W}:{H}:flags=lanczos,fps={FPS}",
                                *ENC, str(local(cid))], capture_output=True, text=True, timeout=600)
            if r.returncode:
                raise OSError("ffmpeg: " + r.stderr[-200:])
            info = stream(local(cid))
            if (info["w"], info["h"]) != (W, H):
                raise ValueError(f"size {info['w']}x{info['h']}")
            meta = save(mp, {"id": cid, "bytes": local(cid).stat().st_size, "kbps": info["kbps"], "duration": round(info["duration"], 3)})
        if upload:
            if not in_r2(key(cid)):  # never overwrite: an object already there (an earlier run) stays
                put_media(key(cid), local(cid).read_bytes(), "video/mp4")
            meta["uploaded"] = True
            save(mp, meta)
        return meta
    except (subprocess.SubprocessError, OSError, ValueError, KeyError, WorkerError) as e:
        return {"id": cid, "failed": f"{type(e).__name__} {str(e)[:200]}"}


def write_catalogue(ids):
    """out/previews.json from the uploaded previews, then `preview` on the clips in out/clips.json, published."""
    previews = {cid: key(cid) for cid in ids if (read_json(META / f"{cid}.json") or {}).get("uploaded")}
    write_json(OUT / "previews.json", previews)
    clips = read_json(OUT / "clips.json")
    for c in clips:
        c.pop("preview", None)
        if c["id"] in previews:
            c["preview"] = previews[c["id"]]
    write_json(OUT / "clips.json", clips)
    publish(OUT / "clips.json")
    log(f"previews.json: {len(previews)} of {len(clips)} clips")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ids", help="comma-separated clip ids (default: every clip in out/clips.json)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--no-upload", action="store_true", help="encode only")
    ap.add_argument("--no-publish", action="store_true", help="do not write out/previews.json or clips.json")
    args = ap.parse_args()
    library = [c["id"] for c in read_json(OUT / "clips.json")]
    ids = args.ids.split(",") if args.ids else library
    META.mkdir(parents=True, exist_ok=True)
    log(f"{len(ids)} clips, {args.workers} workers{', no upload' if args.no_upload else ''}")
    results, t0 = [], time.time()
    with ThreadPoolExecutor(args.workers) as ex:
        for i, m in enumerate(ex.map(process, [(cid, not args.no_upload) for cid in ids]), 1):
            results.append(m)
            if i % 50 == 0 or i == len(ids):
                log(f"  {i}/{len(ids)} ({(time.time() - t0) / 60:.1f} min)")
    failed = [m for m in results if "failed" in m]
    sizes = [m["bytes"] for m in results if "bytes" in m]
    log(f"done {len(sizes)}, failed {len(failed)}" + (f", avg {sum(sizes) / len(sizes) / 1024:.0f} KB, max {max(sizes) / 1024:.0f} KB" if sizes else ""))
    for m in failed[:10]:
        log("  failed", m["id"], m["failed"])
    if not args.no_publish:
        write_catalogue(library)


if __name__ == "__main__":
    main()
