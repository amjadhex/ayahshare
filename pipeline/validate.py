"""Check the published data files in apps/web/public/data/ against contracts/types.ts.

  python validate.py            all 114 surahs expected
  python validate.py --subset   the subset run's files in out/subset/ (subset runs never publish)
"""
import argparse
import re
import sys

from a4_screen import REMOVED
from common import PUBLIC, SUBSET_SURAHS, out_dir, read_json

errors = []


def check(ok, msg):
    if not ok:
        errors.append(msg)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--subset", action="store_true")
    args = ap.parse_args()
    data = out_dir(args.subset) if args.subset else PUBLIC  # topics, clips, bg; surahs and ayahs are the same in both

    surahs = read_json(PUBLIC / "surahs.json")
    check(isinstance(surahs, list) and len(surahs) == 114, "surahs.json: expected 114 entries")
    for i, s in enumerate(surahs, 1):
        check(list(s) == ["n", "name_ar", "name_en", "meaning", "ayahs"] and s["n"] == i, f"surahs.json: bad entry {i}")
    ayahs = read_json(PUBLIC / "ayahs-en.json")
    refs = {f"{s['n']}:{k}" for s in surahs for k in range(1, s["ayahs"] + 1)}
    check(set(ayahs) == refs and len(refs) == 6236, "ayahs-en.json: refs do not match surahs.json / 6236")
    check(all(isinstance(t, str) and t for t in ayahs.values()), "ayahs-en.json: empty text")

    groups = read_json(PUBLIC / "ayah-groups.json")
    check(isinstance(groups, dict) and groups, "ayah-groups.json missing")
    for ref, rng in (groups or {}).items():
        s, a = map(int, ref.split(":")) if re.fullmatch(r"\d+:\d+", ref) else (0, 0)
        check(ref in refs and isinstance(rng, list) and len(rng) == 2 and rng[0] <= a <= rng[1] and rng[0] < rng[1]
              and 1 <= rng[0] and rng[1] <= surahs[s - 1]["ayahs"] and rng[1] - rng[0] < 20, f"ayah-groups.json: {ref}")

    topics = read_json(data / "topics.json")
    check(list(topics) == ["version", "topics"], "topics.json: keys")
    topic_ids = [t["id"] for t in topics["topics"]]
    check(len(topic_ids) == len(set(topic_ids)) and len(topic_ids) >= (20 if args.subset else 250), f"topics.json: {len(topic_ids)} topics")
    for t in topics["topics"]:
        check(list(t) == ["id", "label", "refs"], f"topics.json: keys of {t.get('id')}")
        check(10 <= len(t["refs"]) <= 30 and len(set(t["refs"])) == len(t["refs"]) and set(t["refs"]) <= refs,
              f"topics.json: refs of {t['id']}")

    clips = read_json(data / "clips.json")
    by_id = {c["id"]: c for c in clips}
    check(len(by_id) == len(clips) and clips, "clips.json: empty or duplicate ids")
    check(not set(by_id) & set(REMOVED), f"clips.json: removed clips published: {sorted(set(by_id) & set(REMOVED))}")
    KEYS = ["id", "duration", "caption", "tags", "video", "poster", "thumb"]
    hd = {} if args.subset else read_json(out_dir(False) / "hd.json", {})  # optional 1080p renditions (a6_hd.py)
    for c in clips:
        i = c["id"]
        check(list(c) in (KEYS, KEYS + ["hd"]), f"clips.json: keys of {i}")
        check("hd" not in c or (c["hd"] and all(c["hd"].get(n) == f"clips/{n[0]}1080/{i}.mp4" for n in c["hd"])
                                and set(c["hd"]) <= {"portrait", "landscape"} and c["hd"] == hd.get(i)), f"clips.json: hd of {i}")
        check(re.fullmatch(r"p[bx]\d+", i) and 5 <= c["duration"] <= 12, f"clips.json: id/duration of {i}")
        check(c["video"] == {"portrait": f"clips/p/{i}.mp4", "landscape": f"clips/l/{i}.mp4"}, f"clips.json: video of {i}")
        check(c["poster"] == {"portrait": f"posters/p/{i}.jpg", "landscape": f"posters/l/{i}.jpg"}, f"clips.json: poster of {i}")
        check(c["thumb"] == f"thumbs/{i}.webp" and c["caption"] and c["tags"], f"clips.json: thumb/caption/tags of {i}")
    if not args.subset:  # subset runs upload nothing
        uploaded = read_json(out_dir(False) / "uploaded.json", {})
        missing = [k for c in clips for k in (*c["video"].values(), *c["poster"].values(), c["thumb"]) if k not in uploaded]
        check(not missing, f"clips.json: {len(missing)} media files not in uploaded.json, e.g. {missing[:2]}")

    screened = read_json(out_dir(args.subset) / "screened.json", {})
    wanted = SUBSET_SURAHS if args.subset else range(1, 115)
    n_ayahs = n_sens = 0
    for s in wanted:
        bg = read_json(data / "bg" / f"{s}.json")
        if bg is None:
            check(False, f"bg/{s}.json missing")
            continue
        count = surahs[s - 1]["ayahs"]
        check(list(bg) == ["surah", "ayahs", "sensitive"] and bg["surah"] == s, f"bg/{s}.json: keys")
        check(list(bg["ayahs"]) == [str(k) for k in range(1, count + 1)], f"bg/{s}.json: ayah keys")
        check(set(bg["sensitive"]) <= set(range(1, count + 1)), f"bg/{s}.json: sensitive")
        for k, ids in bg["ayahs"].items():
            n_ayahs += 1
            check(4 <= len(ids) <= 8 and len(set(ids)) == len(ids) and set(ids) <= set(by_id), f"bg/{s}.json:{k} clip ids")
            if int(k) in bg["sensitive"]:
                n_sens += 1
                check(all(screened.get(i, {}).get("abstract_dark", 0) >= 0.5 for i in ids), f"bg/{s}.json:{k} sensitive ayah has a non-abstract clip")

    print(f"{len(topic_ids)} topics, {len(clips)} clips, {n_ayahs} ayahs with suggestions ({n_sens} sensitive)")
    for e in errors[:40]:
        print("FAIL", e)
    print("OK" if not errors else f"{len(errors)} problems")
    sys.exit(bool(errors))


if __name__ == "__main__":
    main()
