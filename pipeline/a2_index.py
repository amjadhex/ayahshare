"""A2: search index. Embeds every ayah with google/gemini-embedding-2 through OpenRouter (the model the Worker uses
for runtime queries, apps/api/src/lib/embed.ts) and upserts the 384-d vectors into the "ayahs" Vectorize index
(quran-design-ayahs-v2; id = ref, metadata {ref}).

Each vector is the unit-length sum of two embeddings of the ayah: its context document (surah name + ayah + the
neighbouring ayahs, so very short ayahs carry their surroundings) and the plain ayah text (which keeps long,
well-known ayahs findable by their own words). Embeddings are cached in cache/openrouter_embed.sqlite, so a rerun
costs nothing; the first full pass is ~0.9 M tokens, about $0.19 (eval/embed_models.md).

  python a2_index.py            embed + upsert (idempotent)
  python a2_index.py --verify   query the live index (wrangler) and check that the Worker embeds queries the same way
"""
import argparse
import json

import numpy as np

from common import OUT, _admin, embed_remote, log, read_json, upsert_vectors, wrangler

INDEX = "quran-design-ayahs-v2"
VERIFY_QUERIES = ["patience", "being kind to parents", "hope after hardship", "Allah is near and answers prayers", "the light of Allah"]


def ayah_vectors():
    texts, docs = read_json(OUT / "ayahs-en.json"), read_json(OUT / "ayah_docs.json")
    refs = list(texts)
    plain = embed_remote([texts[r] for r in refs], "document")
    ctx = embed_remote([docs[r] for r in refs], "document")
    v = plain + ctx
    return refs, v / np.linalg.norm(v, axis=1, keepdims=True)


def index_info():
    r = wrangler("vectorize", "info", INDEX)
    return r.stdout.strip() or r.stderr.strip()[-300:]


def verify():
    refs, vecs = list(read_json(OUT / "ayahs-en.json")), np.load(OUT / "ayah_index_vectors.npy")
    texts = read_json(OUT / "ayahs-en.json")
    print(index_info())
    worker = np.array(_admin("POST", "/embed", json={"texts": VERIFY_QUERIES, "kind": "query"}).json()["vectors"])
    qv = embed_remote(VERIFY_QUERIES, "query")
    print("Worker vs pipeline query vectors, cosine:", [round(float(a @ b), 4) for a, b in zip(worker, qv)])
    for q, v in zip(VERIFY_QUERIES, qv):
        local = [refs[i] for i in np.argsort(-(vecs @ v))[:5]]
        r = wrangler("vectorize", "query", INDEX, "--vector", *[f"{x:.6f}" for x in v], "--top-k", "5",
                     "--return-metadata", "all")
        try:
            remote = [m["id"] for m in json.loads(r.stdout[r.stdout.find("{"):])["matches"]]  # after wrangler's banner
        except (ValueError, KeyError):
            remote = r.stdout[-300:] + r.stderr[-300:]
        print(f"\n{q!r}\n  local  {local}\n  remote {remote}")
        if isinstance(remote, list):
            for ref in remote[:3]:
                print("   ", ref, texts[ref][:100])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()
    if args.verify:
        return verify()
    refs, vecs = ayah_vectors()
    np.save(OUT / "ayah_index_vectors.npy", vecs.astype(np.float32))  # local copy for eval/search_eval.py
    log(f"upserting {len(refs)} vectors into {INDEX}")
    upsert_vectors("ayahs", [{"id": r, "values": [round(float(x), 6) for x in v], "metadata": {"ref": r}}
                             for r, v in zip(refs, vecs)])
    log("done; Vectorize applies mutations asynchronously, `--verify` shows the processed count")


if __name__ == "__main__":
    main()
