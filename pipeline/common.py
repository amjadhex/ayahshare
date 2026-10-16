"""Shared helpers for the offline pipeline: paths, EmbeddingGemma 2 (local), Luna with cache + cost ledger,
and the Worker ingest client (embed / vectors / media). Secrets are read from ../.env, never printed."""
import base64
import hashlib
import io
import json
import os
import shutil
import sys
import threading
import time
from pathlib import Path

import numpy as np
import requests
from dotenv import load_dotenv
from PIL import Image

PIPE = Path(__file__).parent
ROOT = PIPE.parent
CACHE = PIPE / "cache"
OUT = PIPE / "out"
LOGS = OUT / "logs"
PUBLIC = ROOT / "apps/web/public/data"
load_dotenv(ROOT / ".env")

WORKER = os.getenv("QURAN_DESIGN_URL", "https://quran-design.rapid-sun-0190.workers.dev")
DIM = 256  # Matryoshka truncation, shared with the Vectorize indexes
SUBSET_SURAHS = [1, 2, 17, 31, 94, 103, 112, 113, 114]
LUNA_BUDGET_USD = float(os.getenv("LUNA_BUDGET_USD", "15"))


def out_dir(subset):
    """Subset runs write under out/subset/ so they never mix with the full run."""
    d = OUT / "subset" if subset else OUT
    d.mkdir(parents=True, exist_ok=True)
    return d


def read_json(path, default=None):
    path = Path(path)
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path, data, indent=None):
    """Atomic write, so an interrupted run never leaves a half-written file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":")))
    tmp.replace(path)


def publish(src, name=None):
    """Copy an output file into apps/web/public/data/ (atomic)."""
    src = Path(src)
    dest = PUBLIC / (name or src.name)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".tmp")
    shutil.copyfile(src, tmp)
    tmp.replace(dest)
    print("published", dest.relative_to(ROOT))


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def parse_surahs(arg):
    """'1,2,112-114' -> [1, 2, 112, 113, 114]"""
    out = []
    for part in arg.split(","):
        lo, _, hi = part.partition("-")
        out += range(int(lo), int(hi or lo) + 1)
    return out


# ---------------------------------------------------------------------------
# EmbeddingGemma 2 (local, MPS) — same prompts as the MVP
# ---------------------------------------------------------------------------
_model = None
_model_lock = threading.Lock()


def model():
    global _model
    if _model is None:
        import torch
        from sentence_transformers import SentenceTransformer

        device = "mps" if torch.backends.mps.is_available() else "cpu"
        _model = SentenceTransformer("google/embeddinggemma-2", device=device, config_kwargs={"audio_config": None})
    return _model


def embed_docs(texts, batch_size=32):
    with _model_lock:
        return model().encode(texts, prompt_name="Document", truncate_dim=DIM, normalize_embeddings=True,
                              batch_size=batch_size, show_progress_bar=len(texts) > 200)


def embed_queries(texts, batch_size=64):
    with _model_lock:
        return model().encode(texts, prompt_name="SearchQuery", truncate_dim=DIM, normalize_embeddings=True,
                              batch_size=batch_size, show_progress_bar=len(texts) > 200)


def embed_image(images, text=""):
    """One embedding for the frame(s) of a clip plus its tags."""
    with _model_lock:
        return model().encode(
            {"text": "<|image|>" * len(images) + (f" {text}" if text else ""), "image": images},
            truncate_dim=DIM, normalize_embeddings=True,
        )


def load_image(path_or_bytes, max_side=512):
    src = io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, bytes) else path_or_bytes
    img = Image.open(src).convert("RGB")
    img.thumbnail((max_side, max_side))
    return img


def to_data_url(img, quality=80):
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


# ---------------------------------------------------------------------------
# Luna (OpenRouter Decisions endpoint): disk cache + cost ledger + budget guard
# ---------------------------------------------------------------------------
LUNA_URL = "https://openrouter.ai/api/alpha/decisions"
LUNA_MODEL = "openai/gpt-6-luna-decisions"
COST_LOG = OUT / "costs.jsonl"
_cost_lock = threading.Lock()
_spent = None


class BudgetExceeded(RuntimeError):
    pass


class LunaError(RuntimeError):
    pass


def costs_summary():
    """Aggregate costs.jsonl (one line per billed call) into the shape written to costs.json."""
    by_step, total, calls, tokens = {}, 0.0, 0, 0
    if COST_LOG.exists():
        for line in COST_LOG.read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            s = by_step.setdefault(r["step"], {"calls": 0, "usd": 0.0, "input_tokens": 0})
            s["calls"] += 1
            s["usd"] += r["usd"]
            s["input_tokens"] += r["tokens"]
            total += r["usd"]
            calls += 1
            tokens += r["tokens"]
    for s in by_step.values():
        s["usd"] = round(s["usd"], 5)
    return {"budget_usd": LUNA_BUDGET_USD, "total_usd": round(total, 5), "calls": calls, "input_tokens": tokens,
            "by_step": by_step}


def write_costs():
    write_json(OUT / "costs.json", costs_summary(), indent=1)


def _record_cost(step, usage):
    global _spent
    usd = float(usage.get("cost") or 0)
    with _cost_lock:
        if _spent is None:
            _spent = costs_summary()["total_usd"]
        _spent += usd
        with COST_LOG.open("a") as f:
            f.write(json.dumps({"ts": int(time.time()), "step": step, "usd": usd, "tokens": usage.get("input_tokens", 0)}) + "\n")


def luna_spent():
    global _spent
    with _cost_lock:
        if _spent is None:
            _spent = costs_summary()["total_usd"]
        return _spent


def luna(step, state, questions, timeouts=(4, 8, 16), cache=True):
    """POST one Decisions request and return `answers`. Identical requests are served from cache/luna/.
    Retries with a longer timeout each attempt; raises LunaError when all attempts fail and BudgetExceeded
    when the next call would pass the budget. Billed cost (usage.cost, USD) goes to out/costs.jsonl."""
    key = hashlib.sha1(json.dumps([state, questions], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    path = CACHE / "luna" / step / key[:2] / f"{key}.json"
    if cache and path.exists():
        return json.loads(path.read_text())["answers"]
    if luna_spent() >= LUNA_BUDGET_USD:
        raise BudgetExceeded(f"Luna spend ${luna_spent():.2f} reached the ${LUNA_BUDGET_USD:.2f} budget (step {step})")
    last = None
    for attempt, timeout in enumerate(timeouts):
        try:
            r = requests.post(
                LUNA_URL, headers={"Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY')}"},
                json={"model": LUNA_MODEL, "state": state, "questions": questions}, timeout=timeout,
            )
        except (requests.Timeout, requests.ConnectionError) as e:
            last = type(e).__name__
            continue
        if r.status_code in (408, 429, 500, 502, 503, 504):
            last = f"HTTP {r.status_code}"
            time.sleep(1 + attempt * 2)
            continue
        if not r.ok:
            raise LunaError(f"HTTP {r.status_code} {r.text[:300]}")
        data = r.json()
        _record_cost(step, data.get("usage") or {})
        if cache:
            write_json(path, {"answers": data["answers"], "usage": data.get("usage")})
        return data["answers"]
    raise LunaError(f"{step}: gave up after {len(timeouts)} attempts ({last})")


def ranked(answer, values):
    """Choice answer -> values best-first by probability (ties keep the given order)."""
    probs = answer.get("probabilities") or {answer["choice"]: 1.0}
    return sorted(values, key=lambda v: (-probs.get(v, 0.0), values.index(v)))


# ---------------------------------------------------------------------------
# Worker ingest client (Bearer ADMIN_TOKEN)
# ---------------------------------------------------------------------------
class WorkerError(RuntimeError):
    def __init__(self, msg, status=None):
        super().__init__(msg)
        self.status = status


def _admin(method, path, retries=6, **kw):
    """Call the ingest API. 502/503/504/429 and network errors are retried; any other failure (e.g. HTTP 500
    when the Workers AI daily allocation is used up) raises WorkerError immediately."""
    headers = {"Authorization": f"Bearer {os.getenv('ADMIN_TOKEN')}", **kw.pop("headers", {})}
    timeout = kw.pop("timeout", 120)
    last = None
    for attempt in range(retries):
        try:
            r = requests.request(method, WORKER + "/admin/api/ingest" + path, headers=headers, timeout=timeout, **kw)
            if r.ok:
                return r
            if r.status_code not in (429, 502, 503, 504):
                raise WorkerError(f"{method} {path}: HTTP {r.status_code} {r.text[:200]}", r.status_code)
            last = f"HTTP {r.status_code}"
        except (requests.Timeout, requests.ConnectionError) as e:
            last = type(e).__name__
        time.sleep(2 * (attempt + 1))
    raise WorkerError(f"{method} {path}: failed after {retries} attempts ({last})", 503)


# ---------------------------------------------------------------------------
# Index embeddings: google/gemini-embedding-2 through OpenRouter, the model the Worker uses for runtime queries
# (apps/api/src/lib/embed.ts, same prompt formats and size). Ayahs and captions are text, clips are poster images.
# ---------------------------------------------------------------------------
EMBED_URL = "https://openrouter.ai/api/v1/embeddings"
EMBED_MODEL = "google/gemini-embedding-2"
EMBED_DIM = 384  # Matryoshka size of the Vectorize indexes (wrangler.jsonc EMBED_DIM)
EMBED_CACHE_DIM = 768  # cached size; a smaller EMBED_DIM is its prefix, re-normalised (identical to asking the API)
EMBED_PRICE = {"text": 0.20e-6, "image": 0.45e-6}  # USD per token, OpenRouter list price
IMAGE_TOKENS = 258  # Gemini bills every image as 258 tokens, whatever its size
EMBED_COSTS = OUT / "embed_costs.jsonl"


class EmbedError(WorkerError):
    """An embedding request failed. A WorkerError, so steps that carry on without remote embeddings still do."""


EMBED_FORMATS = {
    # Gemini Embedding 2 search formats (Gemini API embeddings guide). "Quran verses about" in the ayah query took
    # hit@3 on eval/search_eval.json from 74 % to 93 % (eval/embed_models.md).
    "query": "task: search result | query: Quran verses about {}",  # ayah search
    "clip_query": "task: search result | query: {}",  # background library search (against poster images)
    "document": "title: none | text: {}",
}


def embed_prompt(text, kind):
    return EMBED_FORMATS[kind].format(text)


_embed_db = None
_embed_lock = threading.Lock()


def _embed_cache():
    """Every input is embedded at most once: vectors (EMBED_CACHE_DIM) are kept in cache/openrouter_embed.sqlite
    keyed by (model, kind, sha1 of the input). cache/remote_embed.sqlite holds the old Workers AI vectors."""
    global _embed_db
    if _embed_db is None:
        import sqlite3

        CACHE.mkdir(parents=True, exist_ok=True)
        _embed_db = sqlite3.connect(CACHE / "openrouter_embed.sqlite", check_same_thread=False)
        _embed_db.execute("CREATE TABLE IF NOT EXISTS v (model TEXT, kind TEXT, sha TEXT, vec BLOB, PRIMARY KEY (model, kind, sha))")
    return _embed_db


def _sha(text):
    return hashlib.sha1(text.encode()).hexdigest()


def _record_embed_cost(usage, images):
    """usage.cost when OpenRouter reports it, else tokens x list price -> out/embed_costs.jsonl."""
    tokens = int(usage.get("prompt_tokens") or 0)
    image_tokens = int((usage.get("prompt_tokens_details") or {}).get("image_tokens") or min(tokens, images * IMAGE_TOKENS))
    usd = float(usage.get("cost") or 0) or (tokens - image_tokens) * EMBED_PRICE["text"] + image_tokens * EMBED_PRICE["image"]
    with _embed_lock, EMBED_COSTS.open("a") as f:
        f.write(json.dumps({"ts": int(time.time()), "model": EMBED_MODEL, "tokens": tokens, "image_tokens": image_tokens,
                            "usd": usd, "reported": float(usage.get("cost") or 0)}) + "\n")


def embed_spent():
    """Total embedding spend in out/embed_costs.jsonl (USD)."""
    if not EMBED_COSTS.exists():
        return 0.0
    return sum(json.loads(line)["usd"] for line in EMBED_COSTS.read_text().splitlines() if line.strip())


def _embed_request(inputs, images=0, retries=4):
    """One OpenRouter embeddings request. A batch (> 1 input) can only go to Google AI Studio, whose shared quota
    answers HTTP 429 under load; a single input can also go to Vertex (same vectors), so callers retry 429 batches
    one input at a time."""
    last, status = None, 503
    for attempt in range(retries):
        try:
            r = requests.post(EMBED_URL, headers={"Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY')}"},
                              json={"model": EMBED_MODEL, "input": inputs, "dimensions": EMBED_CACHE_DIM}, timeout=120)
            if r.ok and "data" in (d := r.json()):
                _record_embed_cost(d.get("usage") or {}, images)
                return [x["embedding"] for x in sorted(d["data"], key=lambda x: x["index"])]
            if r.ok or r.status_code in (408, 429, 500, 502, 503, 504):
                last, status = f"HTTP {r.status_code} {r.text[:200]}", r.status_code
                if status == 429 and len(inputs) > 1:
                    break
            else:
                raise EmbedError(f"embeddings: HTTP {r.status_code} {r.text[:300]}", r.status_code)
        except (requests.Timeout, requests.ConnectionError) as e:
            last = type(e).__name__
        time.sleep(2 * (attempt + 1))
    raise EmbedError(f"embeddings: failed after {attempt + 1} attempts ({last})", status)


def _embed_many(kind, items, batch, max_chars=40000, dim=EMBED_DIM, workers=4):
    """items: [(sha, api input or a function that makes it, size)] -> (n, dim) unit vectors, cached. Uncached ones go
    out in parallel requests of <= `batch` inputs and <= `max_chars` characters (one by one after an HTTP 429)."""
    from concurrent.futures import ThreadPoolExecutor

    db, have = _embed_cache(), {}
    shas = [sha for sha, _, _ in items]
    with _embed_lock:
        for i in range(0, len(shas), 500):
            part = shas[i:i + 500]
            for sha, blob in db.execute(f"SELECT sha, vec FROM v WHERE model = ? AND kind = ? AND sha IN "
                                        f"({','.join('?' * len(part))})", (EMBED_MODEL, kind, *part)):
                have[sha] = np.frombuffer(blob, dtype=np.float32)
    todo = list({sha: (sha, x, n) for sha, x, n in items if sha not in have}.values())
    chunks, chunk, size = [], [], 0
    for item in todo:
        if chunk and (len(chunk) >= batch or size + item[2] > max_chars):
            chunks.append(chunk)
            chunk, size = [], 0
        chunk.append(item)
        size += item[2]
    if chunk:
        chunks.append(chunk)

    def run(chunk):
        inputs = [x() if callable(x) else x for _, x, _ in chunk]  # image inputs are built only when sent
        images = len(chunk) if kind.startswith("image") else 0
        try:
            vecs = _embed_request(inputs, images)
        except EmbedError as e:
            if e.status != 429 or len(chunk) == 1:
                raise
            with ThreadPoolExecutor(4) as ex:
                vecs = [v for vs in ex.map(lambda x: _embed_request([x], 1 if images else 0), inputs) for v in vs]
        with _embed_lock:
            for (sha, _, _), v in zip(chunk, vecs):
                a = np.array(v, dtype=np.float32)
                have[sha] = a
                db.execute("INSERT OR REPLACE INTO v VALUES (?, ?, ?, ?)", (EMBED_MODEL, kind, sha, a.tobytes()))
            db.commit()

    if chunks:
        log(f"embedding {len(todo)} new {kind} inputs in {len(chunks)} requests ({EMBED_MODEL})")
        with ThreadPoolExecutor(workers) as ex:
            list(ex.map(run, chunks))
    if not items:
        return np.zeros((0, dim), dtype=np.float32)
    v = np.stack([have[sha][:dim] for sha in shas])
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def embed_remote(texts, kind, dim=EMBED_DIM):
    """gemini-embedding-2 text embeddings (kind "query" | "document", see embed_prompt) -> (n, dim) unit vectors."""
    inputs = [embed_prompt(t, kind) for t in texts]
    return _embed_many(kind, [(_sha(x), x, len(x)) for x in inputs], batch=100, dim=dim)


def image_input(path, caption=None, max_side=768):
    """One multimodal input: the image (JPEG, <= max_side; Gemini bills 258 tokens per image at any size), plus
    the caption as a text part when given."""
    img = load_image(path, max_side)
    parts = [{"type": "image_url", "image_url": {"url": to_data_url(img, quality=85)}}]
    return {"content": ([{"type": "text", "text": caption}] if caption else []) + parts}


def embed_images(paths, captions=None, dim=EMBED_DIM):
    """gemini-embedding-2 image embeddings (one vector per image, optionally with its caption in the same input) ->
    (n, dim) unit vectors. Cached by sha1(file bytes + caption)."""
    captions = captions or [None] * len(paths)
    items = []
    for path, caption in zip(paths, captions):
        sha = hashlib.sha1(Path(path).read_bytes() + (caption or "").encode()).hexdigest()
        items.append((sha, lambda p=path, c=caption: image_input(p, c), 1))
    kind = "image+text" if any(captions) else "image"
    return _embed_many(kind, items, batch=16, max_chars=10 ** 9, dim=dim)


def upsert_vectors(index, vectors, batch=500):
    """vectors: [{id, values, metadata}] -> Vectorize 'ayahs' | 'clips' (idempotent: same id overwrites)."""
    for i in range(0, len(vectors), batch):
        _admin("POST", f"/vectors/{index}", json={"vectors": vectors[i:i + batch]})


def put_media(key, data, content_type):
    _admin("PUT", f"/media/{key}", data=data, headers={"Content-Type": content_type})


def wrangler(*args, timeout=600):
    """Run wrangler from apps/api. CLOUDFLARE_ACCOUNT_ID must be set (env, or the id file below), otherwise
    wrangler waits on an account picker."""
    import subprocess

    env = dict(os.environ)
    if "CLOUDFLARE_ACCOUNT_ID" not in env and CF_ACCOUNT_ID.exists():
        env["CLOUDFLARE_ACCOUNT_ID"] = CF_ACCOUNT_ID.read_text().strip()
    return subprocess.run(
        ["npx", "--prefix", str(ROOT / "apps/api"), "wrangler", *args], env=env, cwd=ROOT / "apps/api",
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout,
    )


CF_ACCOUNT_ID = Path(os.getenv("CF_ACCOUNT_ID_FILE", str(Path(__file__).parent / "cache" / "cf_account")))
