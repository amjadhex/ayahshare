"""A3: topics.json — for each topic in taxonomy.py, EmbeddingGemma 2 (local) shortlists 100 ayahs and Luna scores
them; the best 30 are kept, best first.

Shortlist = reciprocal-rank fusion of the topic's two phrasings against the context documents and the plain ayah
text (the plain text alone finds more of the well-known ayahs, the context documents fix very short ayahs) and,
when available, the vectors of the search index (a different model, so it finds other ayahs).
Luna gets one request per topic: a 5-level "how directly is this verse about the topic" score question per
shortlisted ayah, which ranks all 100 (a single 100-way choice question returns ~20 non-zero probabilities only).
A second round looks for 100 more ayahs close to the best-scoring ones of round 1 (many well-known ayahs use
other words than the topic label, e.g. "invocation" for dua) and scores those too.
"""
import argparse
import hashlib
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import taxonomy
from common import BudgetExceeded, CACHE, OUT, PIPE, LunaError, WorkerError, embed_docs, embed_queries, embed_remote, log, \
    luna, out_dir, publish, read_json, write_costs, write_json

SHORTLIST = 100
SEEDS = 8
KEEP = 30
LEVELS = ["not about it", "mentioned in passing", "related to it", "clearly about it", "one of the best verses on it"]
PHRASINGS = ["{}", "Quran verses about {}"]


def local_vectors(name, texts):
    """Local EmbeddingGemma 2 document vectors, cached on the content hash."""
    h = hashlib.sha1("\n".join(texts).encode()).hexdigest()[:12]
    path = CACHE / f"local_{name}_{h}.npy"
    if not path.exists():
        for old in CACHE.glob(f"local_{name}_*.npy"):
            old.unlink()
        np.save(path, embed_docs(texts))
    return np.load(path)


def rrf(rankings, n):
    score = {}
    for ranking in rankings:
        for rank, ref in enumerate(ranking):
            score[ref] = score.get(ref, 0) + 1 / (60 + rank)
    return [r for r, _ in sorted(score.items(), key=lambda kv: -kv[1])][:n]


def shortlist(matrices, refs, query_vectors, n=SHORTLIST):
    """RRF over every (matrix, query vector) ranking."""
    return rrf([[refs[i] for i in np.argsort(-(M @ v))[:n]] for M, v in zip(matrices, query_vectors)], n)


def first_round(topics, refs, spaces):
    """spaces: [(ayah vectors, query vectors of shape (topics, phrasings, dim))] -> {topic id: 100 refs}"""
    return {
        tid: shortlist([M for M, Q in spaces for _ in Q[i]], refs, [v for M, Q in spaces for v in Q[i]])
        for i, (tid, _) in enumerate(topics)
    }


def second_round(scores, refs, spaces):
    """100 ayahs nearest to the centroid of the best-scoring ones (in each space), minus those already scored."""
    index = {r: i for i, r in enumerate(refs)}
    best = [index[r] for r in sorted(scores, key=lambda r: -scores[r])[:SEEDS]]
    matrices = [M for M, _ in spaces]
    centroids = [M[best].mean(axis=0) for M in matrices]
    centroids = [c / np.linalg.norm(c) for c in centroids]
    return [r for r in shortlist(matrices, refs, centroids, SHORTLIST + len(scores)) if r not in scores][:SHORTLIST]


def build_spaces(topics, texts, docs, refs, remote):
    """Local EmbeddingGemma 2 over context documents and plain texts and, when A2 has run and the Worker still has
    Workers AI neurons for ~600 short queries, the Worker's 300m model over the vectors that went into Vectorize."""
    queries = [p.format(label) for _, label in topics for p in PHRASINGS]
    local_q = embed_queries(queries).reshape(len(topics), len(PHRASINGS), -1)
    spaces = [(local_vectors("ayah", [docs[r] for r in refs]), local_q), (local_vectors("plain", [texts[r] for r in refs]), local_q)]
    index_file = OUT / "ayah_index_vectors.npy"
    if remote and index_file.exists():
        try:
            spaces.append((np.load(index_file), embed_remote(queries, "query").reshape(len(topics), len(PHRASINGS), -1)))
        except WorkerError as e:
            log("Worker embeddings unavailable, shortlisting with the local model only:", str(e)[:100])
    return spaces


def score_ayahs(label, short, texts):
    """Luna: how directly is each shortlisted ayah about the topic? -> {ref: score 0..4}"""
    questions = {
        r: {"type": "score", "criteria": LEVELS,
            "instructions": f"Verse {r}: {texts[r][:300]}\nHow well does this verse speak about the search topic? Verses that state the topic directly, clearly and memorably rank highest."}
        for r in short
    }
    answers = luna("a3_topics", f"Search topic: {label}", questions, timeouts=(15, 30, 60))
    return {r: answers[r]["score"] for r in short}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--subset", action="store_true", help="only the topics used by eval/search_eval.json")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--local-only", action="store_true", help="do not use the Worker's embedding model for the shortlist")
    ap.add_argument("--rounds", type=int, default=2, choices=[1, 2], help="2 = also score ayahs near the best ones")
    args = ap.parse_args()

    texts = read_json(OUT / "ayahs-en.json")
    docs = read_json(OUT / "ayah_docs.json")
    refs = list(texts)
    topics = taxonomy.TOPICS
    if args.subset:
        wanted = {q["topic"] for q in read_json(PIPE / "eval/search_eval.json")["queries"]}
        topics = [t for t in topics if t[0] in wanted]
    log(f"{len(topics)} topics")

    spaces = build_spaces(topics, texts, docs, refs, remote=not args.local_only)
    log(f"retrieval spaces: {len(spaces)}")
    short = first_round(topics, refs, spaces)
    path = out_dir(args.subset) / "topics.json"
    done, todo = {}, topics  # a rerun repeats the (cached, free) Luna answers, so it resumes where it stopped

    def work(t):
        tid, label = t
        order = {r: i for i, r in enumerate(short[tid])}
        scores = score_ayahs(label, short[tid], texts)
        if args.rounds > 1:
            more = second_round(scores, refs, spaces)
            order |= {r: SHORTLIST + i for i, r in enumerate(more)}
            scores |= score_ayahs(label, more, texts)
        best = sorted(scores, key=lambda r: (-scores[r], order[r]))[:KEEP]  # ties keep the embedding order
        return {"id": tid, "label": label, "refs": best}

    started = time.time()
    try:
        with ThreadPoolExecutor(args.workers) as ex:
            for i, topic in enumerate(ex.map(work, todo), 1):
                done[topic["id"]] = topic
                if i % 20 == 0 or i == len(todo):
                    write_json(path, {"version": time.strftime("%Y-%m-%d"), "topics": [done[t[0]] for t in topics if t[0] in done]})
                    log(f"{i}/{len(todo)} ranked ({time.time() - started:.0f}s)")
    except (BudgetExceeded, LunaError) as e:
        log("STOPPED:", e)
    finally:
        write_costs()
    result = {"version": time.strftime("%Y-%m-%d"), "topics": [done[t[0]] for t in topics if t[0] in done]}
    write_json(path, result)
    if not args.subset and len(result["topics"]) == len(topics):
        publish(path)
    log(f"wrote {path} with {len(result['topics'])} topics")


if __name__ == "__main__":
    main()
