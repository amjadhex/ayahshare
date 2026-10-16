"""Compare ways to turn an ayah into one index vector (the evidence behind a2_index.py's choice).

Embedding-only search (no Luna): Worker query embedding vs the Worker's document embeddings of
  plain   the ayah text alone
  context surah name + ayah + neighbouring ayahs
  sum     unit-length sum of the two (what is indexed)
Reports hit@3, hit@10 and recall@40 (is an expected ref among the 40 candidates a Luna rerank would get?).
Document vectors come from cache/remote_embed.sqlite, so only the ~60 short queries cost Workers AI neurons.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from common import OUT, PIPE, embed_remote, read_json  # noqa: E402


def main():
    texts, docs = read_json(OUT / "ayahs-en.json"), read_json(OUT / "ayah_docs.json")
    refs = list(texts)
    plain = embed_remote([texts[r] for r in refs], "document")
    context = embed_remote([docs[r] for r in refs], "document")
    total = plain + context
    variants = {"plain": plain, "context": context, "sum": total / np.linalg.norm(total, axis=1, keepdims=True)}
    queries = read_json(PIPE / "eval/search_eval.json")["queries"]
    qv = embed_remote([q["q"] for q in queries], "query")
    for name, vecs in variants.items():
        hits = {3: 0, 10: 0, 40: 0}
        for q, v in zip(queries, qv):
            top = [refs[i] for i in np.argsort(-(vecs @ v))[:40]]
            for k in hits:
                hits[k] += bool(set(top[:k]) & set(q["expected"]))
        print(f"{name:8s} hit@3 {hits[3]}/{len(queries)}  hit@10 {hits[10]}/{len(queries)}  recall@40 {hits[40]}/{len(queries)}")


if __name__ == "__main__":
    main()
