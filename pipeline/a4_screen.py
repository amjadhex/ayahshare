"""A4.2 screen + select: embed each candidate's preview frame (EmbeddingGemma 2, image + tags), have Luna check
the frame for rejected content and score it, then keep the best N.

Only the small preview frame is downloaded (cache/frames/). One Luna request per candidate answers the safety
questions (people incl. silhouettes and hands, animals, text/logo/watermark, other-faith symbols, immodest, a book or
religious object being burned or disrespected, green/blue-screen overlays), an "abstract or dark" question (used to
route sensitive ayahs in A5) and a calm/beautiful/text-friendly score.
Output: out/screened.json (everything measured) and out/selected.json (the kept clips, best first).
"""
import argparse
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests

from common import BudgetExceeded, CACHE, LunaError, embed_image, load_image, log, luna, out_dir, read_json, \
    to_data_url, write_costs, write_json

MAX_READ = 25e6  # skip clips whose first 12 s would be more than ~25 MB to read
REJECT_AT = {"people": 0.3, "animals": 0.3, "other_religion": 0.3, "immodest": 0.3, "text_logo": 0.5,
             "desecration": 0.3, "key_colour": 0.5}
QUESTIONS = {
    "people": {"type": "noul", "instructions": "Does the image show any person or human body part, including silhouettes, hands, shadows of people or crowds?"},
    "animals": {"type": "noul", "instructions": "Does the image show any animal, bird, fish or insect?"},
    "text_logo": {"type": "noul", "instructions": "Does the image contain visible text, a watermark or a brand logo?"},
    "other_religion": {"type": "noul", "instructions": "Does the image show religious symbols of other faiths, such as crosses, idols, statues, temples or churches?"},
    "immodest": {"type": "noul", "instructions": "Is there anything immodest or inappropriate for a respectful Islamic setting?"},
    "desecration": {"type": "noul", "instructions": "Does the image show a book, pages, writing or a religious object being burned, torn, trampled or otherwise disrespected?"},
    "key_colour": {"type": "noul", "instructions": "Is this a green-screen or blue-screen asset, or an overlay element on a flat key colour, rather than a finished background scene?"},
    "abstract_dark": {"type": "noul", "instructions": "Is this an abstract, very dark or minimal image (smoke, ink, bokeh, gradient, night sky, fog) rather than a recognisable bright daytime scene?"},
    "quality": {"type": "score", "criteria": ["unsuitable", "poor", "acceptable", "good", "excellent"],
                "instructions": "How calm, beautiful and well suited is this as a background behind overlaid text? Calm, soft, uncluttered, with space for text is best."},
}
CONTEXT = "A frame from a stock video considered as a background for a Quran verse."
# Pixabay's own tags are a cheap second opinion on what the frame check can miss (a bird far away, a couple on a beach)
BLOCKED_TAG = re.compile(
    r"\b(birds?|seagulls?|wildlife|animals?|fish|sharks?|jellyfish|fireflies|firefly|kitten|cats?|dogs?|horses?|"
    r"butterfl(?:y|ies)|bees?|insects?|safari|couple|tourists?|swim(?:ming)?|hik(?:e|ing)|silhouettes?|child|person|"
    r"people|man|woman|girl|boy|human|christmas|xmas|easter|santa|church|cathedral|temple|buddha|hindu|"
    r"green ?screen|blue ?screen|chroma(?: ?key)?)\b")
# Clips a person removed after looking at them (id -> why). Never selected, encoded or published again.
REMOVED = {
    "pb14696": "an open book burning on water (reads as a burning Quran)",
    "pb111573": "green-screen 'love heart' overlay on flat key green",
    # gap-theme trial 2026-10-08, owner agreed: empty or unrelated thumbnails
    "pb17089": "blank white frame", "pb2291": "grey blur", "pb22761": "empty brown frame",
    "pb62083": "juice poured into a glass", "pb53127": "driftwood on a beach", "pb205422": "houses in a snowy village",
    "pb167569": "table, teapot and lantern on a porch",
    "pb118422": "nearly empty sky gradient", "pb37418": "blurred, unclear fountain", "pb190332": "generic clouds, off theme",
    "pb42894": "generic beach, off theme", "pb15023": "generic snowy mountains, off theme",
    "pb15351": "village rooftops", "pb55202": "news-intro style 3D globe graphic", "pb123075": "resort pool with sun loungers",
    "pb58186": "tomatoes in water", "pb45341": "unclear brown blur", "pb323165": "harvester with a city skyline",
    "pb223276": "aerial road", "pb13233": "new-year celebration streak", "pb147196": "unclear dark shapes",
    "pb2686": "unclear blurred water",
    "pb5102": "corporate globe graphic", "pb1236": "dotted tech globe graphic", "pb204340": "muddy brown river",
    "pb85897": "tractor mowing", "pb122761": "opium poppy seed heads",
}
SHOWS_AT = 0.5  # --themes: Luna's probability that the frame shows the theme


def tag_blocked(c):
    """Never in the library: removed by a person, or Pixabay tags that name people, animals, other faiths or key colours."""
    if c["id"] in REMOVED:
        return True
    text = re.sub(r"\bbird'?s? ?eye\b", "", ", ".join(c["tags"]).lower())  # "bird's eye view" is an aerial shot
    return bool(BLOCKED_TAG.search(text))


def frame_path(c):
    return CACHE / "frames" / f"{c['id']}.jpg"


def fetch_frame(c):
    """The preview frame, cached. The Pixabay CDN answers 429 when hit hard, so back off and retry."""
    path = frame_path(c)
    if not path.exists():
        for attempt in range(8):
            try:
                r = requests.get(c["frames"][0], timeout=30)
                if r.status_code == 429:
                    time.sleep(float(r.headers.get("Retry-After", 5 * (attempt + 1))))
                    continue
                r.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 7:
                    raise
                time.sleep(2 * (attempt + 1))
        else:
            raise requests.RequestException("429 Too Many Requests")
        path.parent.mkdir(parents=True, exist_ok=True)
        load_image(r.content, 512).save(path, quality=85)
    return load_image(path, 512)


def screen_one(c):
    """Download the frame and ask Luna. Returns the measurements, or None when the frame/Luna failed."""
    try:
        img = fetch_frame(c)
        a = luna("a4_screen", [{"type": "image_url", "image_url": {"url": to_data_url(img)}}, CONTEXT], QUESTIONS,
                 timeouts=(8, 16, 30))
    except (requests.RequestException, LunaError, OSError) as e:
        log(f"{c['id']}: {type(e).__name__} {str(e)[:80]}")
        return None
    safety = {k: a[k]["noul"] for k in REJECT_AT}
    return {"safety": safety, "abstract_dark": a["abstract_dark"]["noul"], "quality": round(a["quality"]["score"] / 4, 3),
            "rejected": [k for k, v in safety.items() if v >= REJECT_AT[k]]}


def shows_theme(c, wanted, shows):
    """The wanted theme the frame shows best and Luna's probability for it, or (None, 0) when the request failed."""
    themes = [t for t in c["themes"] if t in wanted]
    qs = {t.replace("-", "_"): {"type": "noul", "instructions": f"Does the image clearly show {shows[t]}?"} for t in themes}
    try:
        a = luna("a4_theme", [{"type": "image_url", "image_url": {"url": to_data_url(fetch_frame(c))}}, CONTEXT], qs,
                 timeouts=(8, 16, 30))
    except (requests.RequestException, LunaError, OSError) as e:
        log(f"{c['id']}: {type(e).__name__} {str(e)[:80]}")
        return None, 0
    return max(((t, a[t.replace("-", "_")]["noul"]) for t in themes), key=lambda x: x[1])


def vector_path(c):
    return CACHE / "clipvec" / f"{c['id']}.npy"


def embed_all(cands):
    todo = [c for c in cands if not vector_path(c).exists()]
    log(f"embedding {len(todo)} frames locally")
    for i, c in enumerate(todo, 1):
        v = embed_image([fetch_frame(c)], ", ".join(c["tags"][:8]))
        vector_path(c).parent.mkdir(parents=True, exist_ok=True)
        np.save(vector_path(c), v.astype(np.float32))
        if i % 200 == 0:
            log(f"  {i}/{len(todo)}")


def select(cands, screened, keep, reserve=0.12, existing=()):
    """Best `keep` clips: no rejected content, high quality, portrait-native and G-rated slightly preferred, a cap per
    theme for variety, near-duplicates (frame similarity >= 0.92) skipped, and a reserved share of abstract/dark clips
    (the only backgrounds sensitive ayahs may use)."""
    def score(c):
        s = screened[c["id"]]
        r = c["source_rendition"]
        return (s["quality"] + (0.10 if r["h"] > r["w"] else 0) + (0.05 if c["g_rated"] else 0)
                + 0.05 * min(1, math.log10(1 + c["downloads"]) / 5) - 0.08 * min(1, r["est_bytes"] / 20e6))

    pool = [c for c in cands if c["id"] in screened and not screened[c["id"]]["rejected"] and screened[c["id"]]["quality"] >= 0.4
            and c["source_rendition"]["est_bytes"] <= MAX_READ and not tag_blocked(c)]
    pool.sort(key=score, reverse=True)
    vec = {c["id"]: np.load(vector_path(c)) for c in pool}
    themes = {t for c in pool for t in c["themes"][:1]}
    cap = math.ceil(1.5 * keep / max(1, len(themes)))
    # clips already in the library (`existing`) count for the near-duplicate check, so an addition never repeats one
    chosen, per_theme, kept_vecs = [], {}, [np.load(vector_path({"id": i})) for i in existing]

    def take(c):
        v = vec[c["id"]]
        if kept_vecs and np.max(np.stack(kept_vecs) @ v) >= 0.92:
            return False
        chosen.append(c)
        kept_vecs.append(v)
        per_theme[c["themes"][0]] = per_theme.get(c["themes"][0], 0) + 1
        return True

    reserved = math.ceil(reserve * keep)
    for c in [c for c in pool if screened[c["id"]]["abstract_dark"] >= 0.5]:
        if len(chosen) >= reserved:
            break
        take(c)
    for c in pool:
        if len(chosen) >= keep:
            break
        if c not in chosen and per_theme.get(c["themes"][0], 0) < cap:
            take(c)
    for c in pool:  # themes with few clips left room under the cap: fill up without it
        if len(chosen) >= keep:
            break
        if c not in chosen:
            take(c)
    return [{"id": c["id"], "score": round(score(c), 3)} for c in sorted(chosen, key=score, reverse=True)]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--subset", action="store_true")
    ap.add_argument("--keep", type=int, help="clips to keep (default 1200, subset 80)")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--themes", help="comma-separated themes, or 'gap' for a4_candidates.GAP_THEMES: select only clips "
                                     "from these that are not in the library yet; --keep is then how many to add")
    args = ap.parse_args()
    keep = args.keep or (80 if args.subset else 1200)
    d = out_dir(args.subset)
    cands = read_json(d / "candidates.json")
    path = d / "screened.json"
    screened = read_json(path, {})
    todo = [c for c in cands if c["id"] not in screened]
    log(f"{len(cands)} candidates, {len(todo)} to screen")
    try:
        with ThreadPoolExecutor(args.workers) as ex:
            for i, (c, s) in enumerate(zip(todo, ex.map(screen_one, todo)), 1):
                if s:
                    screened[c["id"]] = s
                if i % 100 == 0 or i == len(todo):
                    write_json(path, screened)
                    log(f"  screened {i}/{len(todo)}")
    except BudgetExceeded as e:
        log("STOPPED:", e)
    finally:
        write_json(path, screened)
        write_costs()
    cands = [c for c in cands if c["id"] in screened]
    embed_all(cands)
    if args.themes:  # add to the library: then a4_encode.py --keep <library + N> encodes only these
        from a4_candidates import GAP_THEMES, SHOWS
        wanted = set(GAP_THEMES if args.themes == "gap" else args.themes.split(",")) & set(SHOWS)
        library = set(read_json(d / "encoded.json", []))
        cands = [c for c in cands if c["id"] not in library and wanted & set(c["themes"]) and not tag_blocked(c)
                 and not screened[c["id"]]["rejected"] and screened[c["id"]]["quality"] >= 0.4]
        with ThreadPoolExecutor(args.workers) as ex:
            found = list(ex.map(lambda c: shows_theme(c, wanted, SHOWS), cands))
        write_costs()
        # only clips that show their theme, filed under it so the per-theme cap spreads the picks over the themes
        cands = [{**c, "themes": [t]} for c, (t, p) in zip(cands, found) if p >= SHOWS_AT]
        per = {}
        for c in cands:
            per[c["themes"][0]] = per.get(c["themes"][0], 0) + 1
        log(f"{len(cands)} clips show their theme: {dict(sorted(per.items()))}")
    # spare clips for ones rejected after encoding
    chosen = select(cands, screened, keep + math.ceil(0.15 * keep), reserve=0 if args.themes else 0.12,
                    existing=library if args.themes else ())
    write_json(d / "selected.json", chosen)
    rej = {}
    for s in screened.values():
        for k in s["rejected"]:
            rej[k] = rej.get(k, 0) + 1
    log(f"screened {len(screened)}; rejected {sum(bool(s['rejected']) for s in screened.values())} {rej}; selected {len(chosen)}")


if __name__ == "__main__":
    main()
