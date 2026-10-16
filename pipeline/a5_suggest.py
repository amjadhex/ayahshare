"""A5: per-ayah background suggestions -> data/bg/{surah}.json (top 8 clip ids per ayah) + sensitive ayah flags.

For every ayah: EmbeddingGemma 2 (local) matches a "background that fits this verse" query against the clip
vectors (hubness-corrected so a few generic clips do not win everywhere), the best 24 go to one Luna request with
their thumbnails (choice: best background) plus a "sensitive" question (punishment, Hellfire, war, death).
Sensitive ayahs only get abstract/dark clips. If Luna fails for an ayah, the abstract/dark clips closest in
meaning are used (never a cheerful scene by accident) and the ayah is listed in out/bg_report.json so a rerun
retries it.
"""
import argparse
import hashlib
import io
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

from common import BudgetExceeded, CACHE, LunaError, OUT, SUBSET_SURAHS, embed_queries, log, luna, luna_spent, out_dir, \
    parse_surahs, publish, read_json, to_data_url, write_costs, write_json

TOP = 8             # suggestions kept per ayah
GENERAL, SHORTLIST = 14, 24   # 14 by meaning + abstract/dark ones, filled up to 24
HUB_K = 10
SENSITIVE_AT = 0.5
THUMB_WIDTH = 160   # px; larger thumbnails cost more tokens and did not change the answer in tests
QUERY = "A calm, beautiful video background that fits the mood of this verse: {}"
PICK = ("Which background is best for a shareable video of this verse? It should match the verse's meaning and mood, "
        "feel respectful, and leave calm space for overlaid text.")
SENSITIVE = "Is this verse mainly about punishment, Hellfire, war or fighting, or death and destruction?"


class Library:
    def __init__(self, d):
        clips = {c["id"]: c for c in read_json(d / "clips.json")}
        screened = read_json(d / "screened.json")
        self.ids = list(clips)
        self.captions = [clips[i]["caption"] for i in self.ids]
        self.abstract = np.array([screened[i]["abstract_dark"] >= 0.5 for i in self.ids])
        self.vecs = np.stack([np.load(CACHE / "clipvec" / f"{i}.npy") for i in self.ids])
        self.thumbs = {}
        for i in self.ids:
            img = Image.open(CACHE / "media/thumbs" / f"{i}.webp").convert("RGB")
            self.thumbs[i] = to_data_url(img.resize((THUMB_WIDTH, round(THUMB_WIDTH * img.height / img.width))), 70)


def query_vectors(refs, texts, docs):
    queries = [QUERY.format(texts[r] if len(texts[r]) >= 40 else docs[r].replace("\n", " ")) for r in refs]
    path = CACHE / f"a5_queries_{hashlib.sha1(chr(10).join(queries).encode()).hexdigest()[:12]}.npy"
    if not path.exists():
        np.save(path, embed_queries(queries))
    return np.load(path)


def shortlists(qv, lib):
    sims = qv @ lib.vecs.T
    hub = np.sort(sims, axis=0)[-HUB_K:].mean(axis=0)  # how strongly each clip matches everything
    score = sims - 0.5 * hub
    out = []
    for row in score:
        order = np.argsort(-row)
        general = list(order[:GENERAL])
        calm = [i for i in order if lib.abstract[i] and i not in general][:SHORTLIST - GENERAL]
        out.append((general + calm + [i for i in order[GENERAL:] if i not in calm])[:SHORTLIST])
    return out, score


def suggest(ref, text, short, lib):
    """One Luna request -> (clip indexes best first, sensitive probability)."""
    state = [f"Quran verse {ref}: {text}"]
    for n, i in enumerate(short, 1):
        state += [f"Background {n}:", {"type": "image_url", "image_url": {"url": lib.thumbs[lib.ids[i]]}}]
    a = luna("a5_bg", state, {
        "pick": {"type": "choice", "instructions": PICK, "criteria": {str(n): lib.captions[i] for n, i in enumerate(short, 1)}},
        "sensitive": {"type": "noul", "instructions": SENSITIVE},
    }, timeouts=(4, 8, 15))
    probs = a["pick"].get("probabilities") or {a["pick"]["choice"]: 1.0}
    order = sorted(range(len(short)), key=lambda n: (-probs.get(str(n + 1), 0.0), n))
    return [short[n] for n in order], a["sensitive"]["noul"]


def pick(ranked, sens, rank, lib, usage, cap):
    """Top 8 for one ayah: Luna's order, then by meaning. Sensitive ayahs keep only abstract/dark clips. Clips already
    suggested for `cap` ayahs go last, so a few favourites do not appear everywhere."""
    pool = ranked + [i for i in rank if i not in ranked]
    if sens >= SENSITIVE_AT:
        pool = [i for i in pool if lib.abstract[i]]
    fresh = [i for i in pool if usage.get(i, 0) < cap]
    chosen = (fresh + [i for i in pool if i not in fresh])[:TOP]
    for i in chosen:
        usage[i] = usage.get(i, 0) + 1
    return chosen


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--subset", action="store_true")
    ap.add_argument("--surahs", help="e.g. 1,2,112-114 (default: all, subset: the subset surahs)")
    ap.add_argument("--limit", type=int, help="only the first N ayahs (testing)")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    d = out_dir(args.subset)
    texts, docs = read_json(OUT / "ayahs-en.json"), read_json(OUT / "ayah_docs.json")
    wanted = set(parse_surahs(args.surahs)) if args.surahs else set(SUBSET_SURAHS) if args.subset else set(range(1, 115))
    refs = [r for r in texts if int(r.split(":")[0]) in wanted][:args.limit]
    lib = Library(d)
    log(f"{len(refs)} ayahs, {len(lib.ids)} clips ({lib.abstract.sum()} abstract/dark)")
    qv = query_vectors(refs, texts, docs)
    shorts, score = shortlists(qv, lib)
    ranks = [list(np.argsort(-row)) for row in score]

    fallback, results = [], {}

    def work(k):
        ref = refs[k]
        try:
            ranked, sens = suggest(ref, texts[ref], shorts[k], lib)
            return ref, ranked, sens, True
        except (LunaError, KeyError) as e:
            log(f"{ref}: Luna failed ({str(e)[:80]}), using abstract/dark clips by meaning")
            return ref, [], None, False

    try:
        with ThreadPoolExecutor(args.workers) as ex:
            for n, (ref, ranked, sens, ok) in enumerate(ex.map(work, range(len(refs))), 1):
                results[ref] = (ranked, sens)
                if not ok:
                    fallback.append(ref)
                if n % 250 == 0:
                    log(f"  {n}/{len(refs)}  Luna spend ${luna_spent():.2f}")
    except BudgetExceeded as e:
        log("STOPPED:", e)
        write_costs()
        raise SystemExit(1)
    write_costs()

    # balance usage in a fixed random order, so no surah gets first pick of the favourites
    usage, picks = {}, {}
    cap = max(20, 4 * len(refs) * TOP // len(lib.ids))
    for k in np.random.default_rng(0).permutation(len(refs)):
        ranked, sens = results[refs[k]]
        picks[refs[k]] = pick(ranked, 1.0 if sens is None else sens, ranks[k], lib, usage, cap)
    results = {r: (picks[r], results[r][1]) for r in refs}

    sensitive_review, used = [], {}
    for s in sorted(wanted):
        mine = [r for r in refs if int(r.split(":")[0]) == s]
        if not mine:
            continue
        data = {"surah": s, "ayahs": {}, "sensitive": []}
        for r in mine:
            picks, sens = results[r]
            data["ayahs"][r.split(":")[1]] = [lib.ids[i] for i in picks]
            for i in picks:
                used[lib.ids[i]] = used.get(lib.ids[i], 0) + 1
            if sens is None or sens >= SENSITIVE_AT:
                data["sensitive"].append(int(r.split(":")[1]))
                sensitive_review.append({"ref": r, "p": sens, "text": texts[r][:160]})
        write_json(d / "bg" / f"{s}.json", data)
        if not args.limit and not args.subset:  # test runs stay in out/subset/ or out/bg/
            publish(d / "bg" / f"{s}.json", f"bg/{s}.json")
    sensitive_review.sort(key=lambda x: -(x["p"] if x["p"] is not None else 2))
    write_json(d / "sensitive_review.json", sensitive_review, indent=1)
    most = sorted(used.items(), key=lambda kv: -kv[1])[:5]
    write_json(d / "bg_report.json", {
        "ayahs": len(refs), "clips_used": len(used), "of_clips": len(lib.ids), "sensitive": len(sensitive_review),
        "luna_failed_refs": fallback, "most_used": most,
        "fewer_than_4": [r for r in refs if len(results[r][0]) < 4]}, indent=1)
    log(f"{len(refs)} ayahs; {len(used)}/{len(lib.ids)} clips used (most used {most[:3]}); "
        f"{len(sensitive_review)} sensitive; {len(fallback)} Luna failures; spend ${luna_spent():.2f}")


if __name__ == "__main__":
    main()
