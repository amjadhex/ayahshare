"""A4.4 publish: upload the encoded media to R2, write data/clips.json, upsert the clip vectors (poster image + caption,
gemini-embedding-2, see clip_vectors) into the "clips" Vectorize index and fill the D1 clips table.

D1 note: the 0001 clips table has one video_key / poster_key column each, so both store a JSON string
{"portrait": "clips/p/<id>.mp4", "landscape": "clips/l/<id>.mp4"}; thumb_key is a plain key. Status of rows that
already exist is left alone (an admin may have hidden or rejected a clip). Active clips that are no longer in the
library are set to 'rejected' and listed in out/retired.json; only clips on that list are set back to 'active' when
they return to the library, so an admin's decision is never undone. All steps are idempotent.

--subset only writes out/subset/ (for a5_suggest.py --subset): it never touches R2, D1, the clips index or
apps/web/public/data.
"""
import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from a4_encode import paths
from a4_screen import tag_blocked
import numpy as np

from common import WorkerError, embed_images, embed_remote, log, out_dir, publish, put_media, read_json, upsert_vectors, wrangler, \
    write_json

TYPES = {".mp4": "video/mp4", ".jpg": "image/jpeg", ".webp": "image/webp"}
HIDDEN_TAGS = {"ai", "ai generated"}  # Pixabay's label for generated footage: not something the UI should show


def keys(cid):
    return {"portrait": f"clips/p/{cid}.mp4", "landscape": f"clips/l/{cid}.mp4"}, {"portrait": f"posters/p/{cid}.jpg", "landscape": f"posters/l/{cid}.jpg"}, f"thumbs/{cid}.webp"


def files(cid):
    p = paths(cid)
    video, poster, thumb = keys(cid)
    return {video["portrait"]: p["p"], video["landscape"]: p["l"], poster["portrait"]: p["pp"], poster["landscape"]: p["pl"], thumb: p["thumb"]}


def upload(items, manifest_path):
    """Upload {key: path} not yet in the manifest (parallel, retried inside put_media); the manifest makes reruns cheap."""
    manifest = read_json(manifest_path, {})
    todo = [(k, p) for k, p in items.items() if manifest.get(k) != p.stat().st_size]

    def put(item):
        key, path = item
        put_media(key, path.read_bytes(), TYPES[path.suffix])
        return key, path.stat().st_size

    log(f"uploading {len(todo)} of {len(items)} files")
    with ThreadPoolExecutor(8) as ex:
        for i, (key, size) in enumerate(ex.map(put, todo), 1):
            manifest[key] = size
            if i % 200 == 0:
                write_json(manifest_path, manifest)
                log(f"  {i}/{len(todo)}")
    write_json(manifest_path, manifest)


def sql_quote(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def clips_sql(clips, back, retire):
    """Upsert the library rows; reactivate the clips this pipeline retired earlier (`back`), retire `retire`."""
    now = int(time.time() * 1000)
    cols = ["id", "source", "source_id", "author", "author_url", "page_url", "caption", "tags", "duration", "width",
            "height", "bytes", "video_key", "thumb_key", "poster_key", "safety", "quality", "status", "created_at"]
    lines = []
    for c in clips:
        video, poster, thumb = keys(c["id"])
        row = [c["id"], c["source"], c["source_id"], c["author"], c["author_url"], c["page_url"], c["caption"],
               ",".join(c["tags"]), c["duration"], 720, 1280, c["bytes"], json.dumps(video), thumb, json.dumps(poster),
               json.dumps(c["safety"]), c["quality"], "active", now]
        update = ", ".join(f"{k}=excluded.{k}" for k in cols if k not in ("id", "status", "created_at"))
        lines.append(f"INSERT INTO clips ({', '.join(cols)}) VALUES ({', '.join(sql_quote(v) for v in row)}) "
                     f"ON CONFLICT(id) DO UPDATE SET {update};")
    if back:
        lines.append(f"UPDATE clips SET status = 'active' WHERE id IN ({', '.join(map(sql_quote, back))}) AND status = 'rejected';")
    if retire:
        lines.append(f"UPDATE clips SET status = 'rejected' WHERE id IN ({', '.join(map(sql_quote, retire))}) AND status = 'active';")
    return "\n".join(lines) + "\n"


def d1_status():
    """id -> status of every clip row in the remote D1."""
    r = wrangler("d1", "execute", "quran-design", "--remote", "--json", "--command", "SELECT id, status FROM clips")
    if r.returncode:
        raise SystemExit(f"d1 read failed: {(r.stderr or r.stdout)[-500:]}")
    return {row["id"]: row["status"] for row in json.loads(r.stdout)[0]["results"]}


def clip_vectors(meta, cands):
    """Library search vector per clip (gemini-embedding-2, searched with text queries): the unit sum of the landscape
    poster's image embedding and the caption + theme words' text embedding. Measured best in eval/embed_models.md:
    the image alone misses e.g. mosques, the caption alone e.g. "calm abstract"."""
    texts = [f"{m['caption']}. {', '.join(t.replace('-', ' ') for t in cands[m['id']]['themes'])}" for m in meta]
    v = embed_images([paths(m["id"])["pl"] for m in meta]) + embed_remote(texts, "document")
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--subset", action="store_true")
    ap.add_argument("--skip-upload", action="store_true", help="only rebuild clips.json / vectors / SQL")
    ap.add_argument("--vectors-only", action="store_true",
                    help="only embed the clips and upsert the clips index (rerun this after an embedding error)")
    args = ap.parse_args()
    d = out_dir(args.subset)
    cands = {c["id"]: c for c in read_json(d / "candidates.json")}
    screened = read_json(d / "screened.json")
    ids = read_json(d / "encoded.json")  # best first: the order in which the encoder worked through the selection
    blocked = [i for i in ids if tag_blocked(cands[i])]
    ids = [i for i in ids if i not in blocked]
    log(f"{len(ids)} clips ({len(blocked)} dropped: removed by a person, or tags that mention people, animals, other faiths)")

    clips, meta = [], []
    hd = read_json(d / "hd.json", {})  # 1080p renditions uploaded by a6_hd.py
    previews = read_json(d / "previews.json", {})  # search tile previews uploaded by a7_previews.py
    for cid in ids:
        c, enc = cands[cid], read_json(paths(cid)["meta"])
        video, poster, thumb = keys(cid)
        tags = [t for t in c["tags"] if t not in HIDDEN_TAGS]
        caption = ", ".join(tags[:6])
        clips.append({"id": cid, "duration": enc["duration"], "caption": caption, "tags": tags,
                      "video": video, "poster": poster, "thumb": thumb, **({"hd": hd[cid]} if cid in hd else {}),
                      **({"preview": previews[cid]} if cid in previews else {})})
        meta.append({**c, "tags": tags, "caption": caption, "bytes": enc["bytes"]["p"] + enc["bytes"]["l"],
                     "duration": enc["duration"], "quality": screened[cid]["quality"],
                     "safety": screened[cid]["safety"] | {"abstract_dark": screened[cid]["abstract_dark"]}})

    if args.subset:
        write_json(d / "clips.json", clips)
        write_json(d / "clips_meta.json", meta)
        log("subset: written to out/subset/ only (R2, D1, the clips index and apps/web/public/data are left alone)")
        return

    if not args.vectors_only:
        if not args.skip_upload:
            upload({k: p for cid in ids for k, p in files(cid).items()}, d / "uploaded.json")
        write_json(d / "clips.json", clips)
        write_json(d / "clips_meta.json", meta)  # source, author, safety...: not part of the public contract
        publish(d / "clips.json")

        status, retired = d1_status(), set(read_json(d / "retired.json", []))  # retired: set to 'rejected' by this script
        back = [i for i in ids if status.get(i) == "rejected" and i in retired]
        retire = sorted(i for i, s in status.items() if s == "active" and i not in set(ids))
        sql = d / "clips.sql"
        sql.write_text(clips_sql(meta, back, retire))
        r = wrangler("d1", "execute", "quran-design", "--remote", "--file", str(sql), "--yes")
        if r.returncode:
            raise SystemExit(f"d1 execute failed: {(r.stderr or r.stdout)[-500:]}")
        write_json(d / "retired.json", sorted((retired - set(back)) | set(retire)))
        log(f"D1: {len(ids)} clips written, {len(back)} back in the library, {len(retire)} retired ({sql.name})")

    # last and separate, because it needs the embeddings API (OpenRouter) and the Worker's clips index
    log(f"embedding {len(meta)} clips (poster image + caption) and upserting into the clips index")
    try:
        vecs = clip_vectors(meta, cands)
        upsert_vectors("clips", [{"id": m["id"], "values": [round(float(x), 6) for x in v], "metadata": {"id": m["id"]}}
                                 for m, v in zip(meta, vecs)])
    except WorkerError as e:
        print(f"clips index NOT updated ({e}); everything else is published. Rerun: python a4_publish.py --vectors-only "
              f"(or ./retry_vectors.sh)", file=sys.stderr)
        sys.exit(2)  # run_all.sh carries on with exit code 2: nothing else depends on the clips index
    log("done")


if __name__ == "__main__":
    main()
