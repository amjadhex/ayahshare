"""Measure google/gemini-embedding-2 (OpenRouter) for ayah search and the background library -> eval/embed_models.md.

  python eval/embed_models.py            ayah eval + clip comparison + latency, writes eval/embed_models.md
  python eval/embed_models.py --sheets   also writes contact sheets (top 8 thumbnails per variant) to out/eval_clips/

Ayahs: the indexed document (unit sum of the context document and the plain ayah, as in a2_index.py) at several
Matryoshka sizes, queries from eval/search_eval.json plus the owner's queries. hit@k = an expected ref in the top k
(Luna reranks the top 30-40, so hit@30 is the one that matters most), MRR over the full ranking.
Baseline: the Workers AI EmbeddingGemma 300m vectors (cache/remote_embed.sqlite) when the matching query vectors are
cached there; they are not when the Workers AI allocation was used up while measuring.
Clips: text query -> clip vectors built from the caption, the landscape poster image, image + caption in one input,
and the sum of image and caption vectors. tag p@8 = share of the top 8 whose caption/tags contain a word for the
query; it favours the caption variants (captions are tags), so the contact sheets are the real check.
Every embedding is cached (cache/openrouter_embed.sqlite); spend goes to out/embed_costs.jsonl.
"""
import argparse
import json
import os
import sqlite3
import statistics
import sys
import time
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from a4_encode import paths  # noqa: E402
from common import (CACHE, EMBED_DIM, EMBED_FORMATS, EMBED_MODEL, EMBED_URL, OUT, PIPE, PUBLIC, _embed_many, _sha,  # noqa: E402
                    embed_images, embed_prompt, embed_remote, embed_spent, read_json)


DIMS = [256, 384, 512, 768]
OWNER = [
    {"q": "spider web", "lang": "en", "expected": ["29:41"]},
    {"q": "honey as healing", "lang": "en", "expected": ["16:68", "16:69"]},
    {"q": "ജോലി നഷ്ടപ്പെട്ടപ്പോൾ ആശ്വാസം", "lang": "ml", "expected": ["94:5", "94:6", "65:2", "65:3"]},
    {"q": "ക്ഷമ", "lang": "ml", "expected": ["2:153", "2:155", "39:10", "3:200"]},
    {"q": "dealing with a difficult boss", "lang": "en", "expected": ["73:10", "16:127", "41:34"]},
]
LIBRARY = {  # query -> words that mark a fitting clip in its caption/tags
    "ocean": ["ocean", "sea", "wave", "beach", "coast", "surf"],
    "night sky": ["night", "star", "milky way", "galaxy", "moon", "cosmos"],
    "rain": ["rain", "drop", "storm", "wet"],
    "desert": ["desert", "sand", "dune"],
    "mountains": ["mountain", "peak", "alps", "hill", "summit"],
    "light": ["light", "sun", "ray", "glow", "bokeh", "shine"],
    "mosque": ["mosque", "islam", "minaret", "ramadan", "kaaba", "mecca", "masjid", "muslim"],
    "calm abstract": ["abstract", "pattern", "texture", "gradient", "background"],
    "forest": ["forest", "tree", "wood"],
    "clouds": ["cloud"],
    "sunset": ["sunset", "sunrise", "dusk", "dawn", "golden hour"],
    "flowers": ["flower", "blossom", "bloom", "petal"],
    "snow": ["snow", "winter", "ice", "frost"],
    "waterfall": ["waterfall", "falls", "cascade"],
}


def unit(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def ranks(qv, docs, refs, expected):
    """1-based rank of the first expected ref for each query."""
    order = np.argsort(-(qv @ docs.T), axis=1)
    pos = {r: i for i, r in enumerate(refs)}
    out = []
    for row, exp in zip(order, expected):
        where = np.empty(len(refs), dtype=int)
        where[row] = np.arange(1, len(refs) + 1)
        out.append(int(min(where[pos[r]] for r in exp if r in pos)))
    return out


def metrics(rk):
    n = len(rk)
    return {"hit@3": sum(r <= 3 for r in rk) / n, "hit@10": sum(r <= 10 for r in rk) / n,
            "hit@30": sum(r <= 30 for r in rk) / n, "MRR": sum(1 / r for r in rk) / n}


def baseline(refs, texts, docs, queries):
    """Workers AI EmbeddingGemma 300m (256-d) index + query vectors from cache/remote_embed.sqlite, or None."""
    db = sqlite3.connect(CACHE / "remote_embed.sqlite")

    def get(kind, items):
        shas = [_sha(t) for t in items]
        found = {}
        for i in range(0, len(shas), 500):
            part = shas[i:i + 500]
            found |= dict(db.execute(f"SELECT sha, vec FROM v WHERE kind = ? AND sha IN ({','.join('?' * len(part))})", (kind, *part)))
        return None if len(found) < len(set(shas)) else np.stack([np.frombuffer(found[s], dtype=np.float32) for s in shas])

    qv = get("query", [q["q"] for q in queries])
    if qv is None:
        return None
    d = get("document", [texts[r] for r in refs]) + get("document", [docs[r] for r in refs])
    return qv, unit(d)


def ayah_eval():
    texts, docs = read_json(OUT / "ayahs-en.json"), read_json(OUT / "ayah_docs.json")
    refs = list(texts)
    queries = read_json(PIPE / "eval/search_eval.json")["queries"]
    allq = queries + OWNER
    plain = embed_remote([texts[r] for r in refs], "document", dim=768)
    ctx = embed_remote([docs[r] for r in refs], "document", dim=768)
    formats = {f"`{EMBED_FORMATS['query'].format('...')}` (deployed)": embed_remote([q["q"] for q in allq], "query", dim=768)}
    for name, fmt in (("`task: search result | query: ...` (Google's template)", "task: search result | query: {}"), ("raw query", "{}")):
        inputs = [fmt.format(q["q"]) for q in allq]
        formats[name] = _embed_many("raw", [(_sha(x), x, len(x)) for x in inputs], batch=100, dim=768)
    exp = [q["expected"] for q in allq]
    n = len(queries)
    rows, owner_rows, by_lang = [], {}, {}
    for dim in DIMS:
        index = unit(unit(plain[:, :dim]) + unit(ctx[:, :dim]))
        for i, (fmt, qv) in enumerate(formats.items()):
            rk = ranks(unit(qv[:, :dim]), index, refs, exp)
            rows.append({"variant": f"gemini-embedding-2 {dim}-d, {fmt}", "eval": metrics(rk[:n]), "owner": metrics(rk[n:])})
            if i == 0:
                owner_rows[dim] = rk[n:]
                if dim == EMBED_DIM:
                    for lang in sorted({q["lang"] for q in queries}):
                        by_lang[lang] = metrics([r for r, q in zip(rk[:n], queries) if q["lang"] == lang]) | {
                            "n": sum(q["lang"] == lang for q in queries)}
                    top5 = {q["q"]: [refs[i] for i in np.argsort(-(index @ unit(v[:EMBED_DIM])))[:5]]
                            for q, v in zip(OWNER, qv[n:])}
    base = baseline(refs, texts, docs, allq)
    if base:
        rk = ranks(base[0], base[1], refs, exp)
        rows.insert(0, {"variant": "Workers AI embeddinggemma-300m 256-d (baseline)", "eval": metrics(rk[:n]), "owner": metrics(rk[n:])})
    return rows, owner_rows, by_lang, top5, base is not None


def latency():
    """Single-query requests from this machine at the deployed size (not cached)."""
    out = []
    for q in [x["q"] for x in OWNER] * 2:
        t = time.time()
        r = requests.post(EMBED_URL, headers={"Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY')}"},
                          json={"model": EMBED_MODEL, "input": [embed_prompt(q, "query")], "dimensions": EMBED_DIM}, timeout=30)
        r.raise_for_status()
        out.append(time.time() - t)
    out.sort()
    return statistics.median(out), out[int(len(out) * 0.9) - 1], out[0], out[-1]


def clip_eval(sheets):
    clips = read_json(PUBLIC / "clips.json")
    cands = {c["id"]: c for c in read_json(OUT / "candidates.json")}
    ids = [c["id"] for c in clips]
    words = {c["id"]: f"{c['caption']} {' '.join(c['tags'])}".lower() for c in clips}
    captions = [f"{c['caption']}. {', '.join(t.replace('-', ' ') for t in cands[c['id']]['themes'])}" for c in clips]
    posters = [paths(i)["pl"] for i in ids]
    cap = embed_remote(captions, "document")
    img = embed_images(posters)
    mixed = embed_images(posters, [c["caption"] for c in clips])
    variants = {"caption (text)": cap, "poster image": img, "image + caption (one input)": mixed, "image vec + caption vec": unit(img + cap)}
    qs = list(LIBRARY)
    q_task, q_raw = embed_remote(qs, "clip_query"), _embed_many("raw", [(_sha(q), q, len(q)) for q in qs], batch=100)
    table, tops = [], {}
    for name, vecs in variants.items():
        for fmt, qv in (("task", q_task), ("raw", q_raw)):
            if fmt == "raw" and name != "poster image":
                continue
            p8 = []
            for q, v in zip(qs, qv):
                top = [ids[i] for i in np.argsort(-(vecs @ v))[:8]]
                p8.append(sum(any(w in words[t] for w in LIBRARY[q]) for t in top) / 8)
                if fmt == "task":
                    tops.setdefault(q, {})[name] = top
            table.append({"variant": f"{name}, {fmt} query", "p8": dict(zip(qs, p8)), "mean": sum(p8) / len(p8)})
    if sheets:
        contact_sheets(tops)
    return table, tops, {c["id"]: c["caption"] for c in clips}


def contact_sheets(tops):
    from PIL import Image, ImageDraw

    out = OUT / "eval_clips"
    out.mkdir(parents=True, exist_ok=True)
    for q, by_variant in tops.items():
        sheet = Image.new("RGB", (8 * 120, len(by_variant) * 226), "white")
        draw = ImageDraw.Draw(sheet)
        for row, (name, top) in enumerate(by_variant.items()):
            for col, cid in enumerate(top):
                thumb = Image.open(paths(cid)["thumb"]).convert("RGB").resize((120, 213))
                sheet.paste(thumb, (col * 120, row * 226 + 13))
            draw.text((2, row * 226), name, fill="black")
        sheet.save(out / f"{q.replace(' ', '_')}.jpg", quality=80)


def pct(x):
    return f"{x * 100:.0f}%"


def write_md(rows, owner_rows, by_lang, top5, has_base, lat, clip_table, tops, captions, spent):
    L = ["# Embedding model eval: google/gemini-embedding-2", "",
         f"Written by `eval/embed_models.py` ({time.strftime('%Y-%m-%d')}). Owner decision: gemini-embedding-2 (OpenRouter) "
         "is the one embedding model for ayah search and the background library (text queries vs ayah text and clip "
         "poster images), replacing Workers AI EmbeddingGemma 300m, whose 10,000 neurons/day free allocation kept "
         "running out. The other OpenRouter candidates were not run.", "",
         "## Decision", "",
         f"- Size: **{EMBED_DIM}-d** (Matryoshka; OpenRouter passes `dimensions` through and the result equals the "
         "re-normalised prefix of the 3072-d vector). It matches 512-d and 768-d on hit@10/hit@30, beats 256-d, and "
         "6,236 ayahs + ~690 clips = 2.66 M stored dimensions fit the Vectorize free 5 M next to the old 256-d indexes.",
         f"- Ayah query format: `{EMBED_FORMATS['query'].format('<q>')}`; documents `{EMBED_FORMATS['document'].format('<text>')}`. "
         "Google's plain `task: search result | query: <q>` template ranked famous ayahs much lower, especially for "
         "one-word and non-English queries (table below).",
         f"- Clips: vector = unit sum of the landscape poster's image embedding and the caption + theme words' text "
         f"embedding; library queries are `{EMBED_FORMATS['clip_query'].format('<q>')}`. The image alone was weakest "
         "(mosque, mountains, waterfall), the caption alone missed \"calm abstract\", one combined image + caption input "
         "too; the sum was best on the tag check and by eye.",
         "- OpenRouter routing: a request with more than one input can only go to Google AI Studio, whose shared quota "
         "answered HTTP 429 during the bulk run; single inputs also go to Vertex. Both return the same vectors (cosine "
         "1.0000), so the pipeline retries a 429 batch one input at a time and the Worker sends one query per request. "
         "`input_type: search_query` gives the same vector as the `task: search result | query:` prefix.", "",
         "## Ayah search", "",
         "61 queries from `search_eval.json` (en 26, ml/ar/ur/hi/id 7 each) and the owner's 5 queries. Index vector = "
         "unit sum of the context document and the plain ayah, each `title: none | text: ...`. "
         "hit@k = an expected ref in the top k; Luna reranks the top 30-40, so hit@30 matters most.", "",
         "| Variant | hit@3 | hit@10 | hit@30 | MRR | owner hit@10 | owner hit@30 |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        e, o = r["eval"], r["owner"]
        L.append(f"| {r['variant'].replace('|', '\\|')} | {pct(e['hit@3'])} | {pct(e['hit@10'])} | {pct(e['hit@30'])} | {e['MRR']:.2f} | "
                 f"{pct(o['hit@10'])} | {pct(o['hit@30'])} |")
    if not has_base:
        L += ["", "Baseline (Workers AI EmbeddingGemma 300m): not measurable on the day of the switch. The query "
              "vectors were never cached and the account's Workers AI allocation was used up (AiError 4006) when "
              "this ran, which is the outage being fixed: live, fast search returned no results for every query."]
    L += ["", f"Per language at the deployed size ({EMBED_DIM}-d, deployed query format):", "",
          "| Lang | n | hit@3 | hit@10 | hit@30 | MRR |", "|---|---|---|---|---|---|"]
    for lang, m in by_lang.items():
        L.append(f"| {lang} | {m['n']} | {pct(m['hit@3'])} | {pct(m['hit@10'])} | {pct(m['hit@30'])} | {m['MRR']:.2f} |")
    L += ["", "Owner queries: rank of the first expected ayah by index size, and the top 5 at the deployed size.", "",
          "| Query | expected | " + " | ".join(f"{d}-d" for d in DIMS) + f" | top 5 ({EMBED_DIM}-d) |",
          "|---|---|" + "---|" * len(DIMS) + "---|"]
    for i, q in enumerate(OWNER):
        L.append(f"| {q['q']} | {', '.join(q['expected'])} | " + " | ".join(str(owner_rows[d][i]) for d in DIMS)
                 + f" | {', '.join(top5[q['q']])} |")
    L += ["", "## Query latency and cost", "",
          f"Single query from this Mac (India) to OpenRouter at {EMBED_DIM}-d, 10 requests: median {lat[0]:.2f} s, "
          f"p90 {lat[1]:.2f} s, min {lat[2]:.2f} s, max {lat[3]:.2f} s. Live on 2026-10-08 (30 new queries, fast "
          "mode, from India): the Worker's wall time was median ~1.2 s, max 2.3 s with the embedding at most ~2 s (its "
          "timeout), the rest the Vectorize query (~0.25 s); a query whose vector is already in the colo's cache "
          "answers in ~0.3 s.", "",
          "Price: $0.20 per million text tokens, images 258 tokens each at $0.45 per million (about $0.0001 per "
          "image). The ayah corpus (both documents per ayah) is about 0.9 M tokens, about $0.19 once; a search query "
          "is about 10 tokens ($0.000002).",
          f"Embedding spend recorded for this work (out/embed_costs.jsonl, tokens x list price; OpenRouter reported "
          f"a cost of 0 for every request): ${spent:.3f}.", "",
          "Dimensions: Vectorize free tier = 5 M stored dimensions across all indexes. 6,236 ayahs + 686 clips = "
          "6,922 vectors: 256-d = 1.77 M, 384-d = 2.66 M, 512-d = 3.54 M. The old 256-d indexes (1.77 M) stay until "
          "they are deleted, so 512-d would not fit next to them.", "",
          "## Background clips (text query -> clip vectors)", "",
          "| Variant | " + " | ".join(LIBRARY) + " | mean |", "|---|" + "---|" * (len(LIBRARY) + 1)]
    for r in clip_table:
        L.append(f"| {r['variant']} | " + " | ".join(pct(r['p8'][q]) for q in LIBRARY) + f" | {pct(r['mean'])} |")
    L += ["", "tag p@8 counts a clip as fitting when its Pixabay tags contain a word for the query, so it favours "
          "the caption variants and misses fitting clips with poor tags; the contact sheets "
          "(`--sheets`, out/eval_clips/) were checked by eye.", "",
          "Top 8 per library query (caption | poster image):", ""]
    for q, by in tops.items():
        L.append(f"- **{q}**")
        for name in ("caption (text)", "poster image", "image vec + caption vec"):
            L.append(f"  - {name}: " + "; ".join(f"{c} ({captions[c][:40]})" for c in by[name][:8]))
    (PIPE / "eval/embed_models.md").write_text("\n".join(L) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sheets", action="store_true")
    args = ap.parse_args()
    rows, owner_rows, by_lang, top5, has_base = ayah_eval()
    for r in rows:
        print(f"{r['variant']:55s}", {k: round(v, 3) for k, v in r["eval"].items()}, "owner", {k: round(v, 2) for k, v in r["owner"].items()})
    print(by_lang)
    print({d: v for d, v in owner_rows.items()}, top5)
    clip_table, tops, captions = clip_eval(args.sheets)
    for r in clip_table:
        print(f"{r['variant']:45s} mean p@8 {r['mean']:.2f}", {k: round(v, 2) for k, v in r["p8"].items()})
    lat = latency()
    print("latency", lat)
    write_md(rows, owner_rows, by_lang, top5, has_base, lat, clip_table, tops, captions, embed_spent())
    print(f"spent ${embed_spent():.4f}")


if __name__ == "__main__":
    main()
