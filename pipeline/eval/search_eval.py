"""Evaluate search against eval/search_eval.json (hit = any expected ref in the top 3).

  python eval/search_eval.py topics [--subset]   Luna routes the query to a topic, results = that topic's list
  python eval/search_eval.py embedding           Worker query embedding vs the vectors uploaded in A2 (no Luna)

Prints hit@3 per language plus, for `topics`, how often the router picked the expected topic.
"""
import argparse
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from common import OUT, PIPE, embed_remote, luna, out_dir, read_json  # noqa: E402


MAX_CHOICES = 150  # Luna's choice question accepts at most 255 options, so 300 topics need two requests


def route(q, topics):
    """Luna picks one topic (any query language) or "other". The topics are split over parallel requests that
    each also offer "other"; the non-"other" answer with the highest probability wins."""
    def ask(group):
        criteria = {t["id"]: t["label"] for t in group} | {"other": "None of these topics"}
        a = luna("eval_router", f"Search query: {q}", {"pick": {
            "type": "choice", "criteria": criteria,
            "instructions": "Which topic is this Quran search query about? The query may be in any language."}},
            timeouts=(8, 16, 30))["pick"]
        probs = a.get("probabilities") or {a["choice"]: 1.0}
        return max(((p, k) for k, p in probs.items() if k != "other"), default=(0, "other"))

    groups = [topics[i:i + MAX_CHOICES] for i in range(0, len(topics), MAX_CHOICES)]
    with ThreadPoolExecutor(len(groups)) as ex:
        best = max(ex.map(ask, groups))
    return best[1] if best[0] >= 0.3 else "other"


def report(rows, router=False):
    langs = sorted({r["lang"] for r in rows})
    for lang in langs + ["all"]:
        sel = [r for r in rows if lang == "all" or r["lang"] == lang]
        line = f"{lang:>4}  hit@3 {sum(r['hit3'] for r in sel)}/{len(sel)}  hit@10 {sum(r['hit10'] for r in sel)}/{len(sel)}"
        if router:
            line += f"  router {sum(r['routed'] == r['topic'] for r in sel)}/{len(sel)}"
        print(line)
    for r in rows:
        if not r["hit3"]:
            print("  miss:", r["lang"], r["q"], "->", r.get("routed", ""), r["top"][:3], "expected", r["expected"][:4])
    print(f"hit@3 = {sum(r['hit3'] for r in rows) / len(rows):.0%}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("mode", choices=["topics", "embedding"])
    ap.add_argument("--subset", action="store_true")
    args = ap.parse_args()
    queries = read_json(PIPE / "eval/search_eval.json")["queries"]
    rows = []
    if args.mode == "topics":
        file = read_json(out_dir(args.subset) / "topics.json")
        by_id = {t["id"]: t for t in file["topics"]}
        for e in queries:
            topic = route(e["q"], file["topics"])
            top = by_id[topic]["refs"] if topic in by_id else []
            rows.append({**e, "routed": topic, "top": top, "hit3": bool(set(top[:3]) & set(e["expected"])),
                         "hit10": bool(set(top[:10]) & set(e["expected"]))})
    else:
        refs, vecs = list(read_json(OUT / "ayahs-en.json")), np.load(OUT / "ayah_index_vectors.npy")
        qv = embed_remote([e["q"] for e in queries], "query")
        for e, v in zip(queries, qv):
            top = [refs[i] for i in np.argsort(-(vecs @ v))[:10]]
            rows.append({**e, "top": top, "hit3": bool(set(top[:3]) & set(e["expected"])),
                         "hit10": bool(set(top) & set(e["expected"]))})
    report(rows, router=args.mode == "topics")


if __name__ == "__main__":
    main()
