"""A4.1 candidates: list Pixabay videos (and Pexels when PEXELS_API_KEY is set) across ~60 calm themes.

Nothing is downloaded except the JSON lists. Each candidate gets the smallest source rendition that still
gives sharp output (see pick_rendition) and cleaned tags for captions. Output: out/candidates.json.
"""
import argparse
import hashlib
import os
import re
import time

import requests

from common import CACHE, log, out_dir, read_json, write_json

# theme -> search queries. Calm, text-friendly scenes; people and animals are filtered later by Luna.
THEMES = {
    "blue-sky": ["blue sky clouds"], "cloud-timelapse": ["clouds timelapse"], "sunrise": ["sunrise sky"],
    "sunset": ["sunset sky"], "dramatic-clouds": ["dramatic clouds"], "golden-hour": ["golden hour"],
    "twilight": ["twilight sky"], "storm-clouds": ["storm clouds"], "mist": ["morning mist"],
    "night-sky": ["night sky stars"], "milky-way": ["milky way"], "galaxy": ["galaxy space"],
    "moon": ["moon night"], "full-moon": ["full moon"], "aurora": ["aurora"], "nebula": ["nebula"],
    "calm-sea": ["calm sea"], "ocean-waves": ["ocean waves"], "beach-waves": ["waves beach sand"],
    "waterfall": ["waterfall"], "river": ["river stream"], "lake": ["lake reflection"],
    "water-ripples": ["water ripples"], "rain": ["rain drops"], "rain-window": ["rain window"],
    "water-sparkle": ["water sparkle sun"], "dew": ["dew drops"], "ice": ["ice crystals"],
    "snowfall": ["snow falling"], "winter-landscape": ["winter snow landscape"],
    "desert-dunes": ["desert dunes"], "desert-sunset": ["desert sunset"], "mountains": ["mountains mist"],
    "snow-mountains": ["snow mountains"], "mountain-sunrise": ["mountain peaks sunrise"],
    "valley-fog": ["valley fog"], "canyon": ["canyon rocks"], "sea-cliffs": ["cliffs sea"],
    "forest-sunlight": ["forest sunlight"], "forest-fog": ["forest fog"], "green-leaves": ["green leaves"],
    "autumn-leaves": ["autumn leaves"], "trees-wind": ["trees wind"], "grass-field": ["grass field wind"],
    "wheat-field": ["wheat field"], "flowers": ["flowers bloom"], "palm-leaves": ["palm leaves"],
    "bamboo": ["bamboo forest"], "light-rays": ["light rays"], "sun-through-trees": ["sun rays through trees"],
    "golden-particles": ["golden particles"], "bokeh": ["bokeh lights"], "lens-flare": ["lens flare"],
    "glitter": ["glitter sparkles"], "abstract": ["abstract background"], "gradient": ["abstract gradient"],
    "ink": ["ink in water"], "smoke": ["smoke slow motion"], "fluid": ["fluid motion"],
    "dark-abstract": ["dark abstract"], "silk": ["silk fabric"], "watercolor": ["watercolor"],
    "marble": ["marble texture"], "mosque": ["mosque"], "mosque-interior": ["mosque interior"],
    "dome-minaret": ["mosque dome minaret"], "islamic-pattern": ["islamic geometric pattern"],
    "arches": ["arches architecture"],
    # 2026-10-08 gap themes: Quran subjects the first library barely covered (gardens and rivers, fruit and crops,
    # shade, night and day, creation and the sky as science). Appended last so earlier clips keep their first theme.
    # "ai generated ..." queries reach Pixabay's AI-made clips for subjects with little real footage.
    "garden": ["garden", "flower garden", "botanical garden", "ai generated garden"],
    "garden-stream": ["stream garden", "forest stream", "brook", "ai generated stream"],
    "fountain": ["fountain water", "fountain", "ai generated fountain"], "spring-water": ["spring water", "clear water stream"],
    "date-palm": ["date palm", "palm trees", "oasis", "ai generated palm"], "dates-fruit": ["dates fruit", "dates", "ai generated dates"],
    "olive-tree": ["olive tree", "olives", "olive grove", "ai generated olive tree"],
    "grapes": ["grapes", "vineyard", "grapevine", "ai generated grapes"],
    "pomegranate": ["pomegranate", "pomegranate fruit", "ai generated pomegranate"], "figs": ["figs", "fig fruit", "ai generated figs"],
    "sprout": ["sprout", "seedling", "germination", "ai generated sprout"],
    "plant-growth": ["plant growth timelapse", "growing plant", "flower blooming timelapse"],
    "crops": ["crops field", "wheat", "rice field", "harvest"], "tree-shade": ["tree shade", "tree shadow"],
    "shadow-timelapse": ["shadow time lapse"], "day-night": ["day night timelapse", "day to night"],
    "cave": ["cave", "cavern", "ai generated cave"], "old-book": ["old book", "ai generated old book"],
    "earth-space": ["earth space", "earth from space", "earth orbit", "ai generated earth"],
    "planets": ["planet", "planets", "ai generated planet"], "sun-space": ["sun space", "solar flare", "sun surface"],
    "solar-eclipse": ["solar eclipse", "eclipse"],
    "universe": ["universe", "nebula space", "stars space", "cosmos", "ai generated galaxy"],
    "cells": ["cells", "cell microscope", "cell division", "ai generated cells"], "dna": ["dna"],
    "atom": ["atom", "atomic", "ai generated atom"], "molecules": ["molecules", "molecule", "ai generated molecules"],
    "underwater-light": ["underwater light", "underwater sun rays"], "lightning": ["lightning", "thunderstorm"],
}
# What a clip of each gap theme must visibly show: `a4_screen.py --themes` asks Luna this about the frame, because
# Pixabay's search also returns pretty clips that do not show the theme (a lake for "solar eclipse").
SHOWS = {
    "garden": "a lush green garden", "garden-stream": "a stream or brook flowing through greenery",
    "fountain": "a water fountain", "spring-water": "a natural spring or clear water flowing over rocks",
    "date-palm": "date palm trees", "dates-fruit": "dates (the fruit)", "olive-tree": "olive trees or olives",
    "grapes": "grapes or grapevines", "pomegranate": "pomegranates", "figs": "figs or a fig tree",
    "sprout": "a seed sprouting or a young seedling", "plant-growth": "a young plant growing",
    "crops": "a field of growing crops or grain", "tree-shade": "trees casting shade or clear shadows",
    "shadow-timelapse": "clear shadows on the ground or on a landscape", "day-night": "a landscape at dusk with the night sky coming in",
    "cave": "the inside or the mouth of a cave", "old-book": "an old closed book",
    "earth-space": "planet Earth seen from space", "planets": "a planet in space", "sun-space": "the Sun in space or its surface",
    "solar-eclipse": "a solar or lunar eclipse", "universe": "stars, galaxies or nebulae in deep space",
    "cells": "biological cells", "dna": "a DNA double helix", "atom": "a model of an atom",
    "molecules": "molecules or a molecular structure", "underwater-light": "light rays under water",
    "lightning": "lightning in the sky",
}
GAP_THEMES = list(SHOWS)
SUBSET_THEMES = ["night-sky", "calm-sea", "rain", "mountains", "forest-sunlight", "light-rays", "abstract",
                 "ink", "desert-dunes", "mosque"]
NOISE_TAGS = {"4k", "hd", "uhd", "video", "stock", "footage", "background", "backgrounds", "loop", "looping", "free",
              "royalty free", "stock footage", "4k video", "full hd", "ultra hd", "slow motion"}


def clean_tags(raw):
    seen, out = set(), []
    for t in raw.split(","):
        t = re.sub(r"[^a-z0-9 \-]", "", t.strip().lower()).strip()
        if t and t not in seen and t not in NOISE_TAGS and len(t) > 1:
            seen.add(t)
            out.append(t)
    return out[:12]


def pick_rendition(renditions, duration):
    """Smallest rendition whose crops stay sharp: cover-scaling to 720x1280 and 1280x720 may upscale by <= 1.25x.
    Landscape 1080p sources fit (portrait crop upscales 1.19x); 720p ones do not. Returns None when nothing fits."""
    ok = []
    for r in renditions:
        up = max(max(720 / r["w"], 1280 / r["h"]), max(1280 / r["w"], 720 / r["h"]))
        if up <= 1.25:
            ok.append(r)
    if not ok:
        return None
    best = min(ok, key=lambda r: r["size"])
    read = min(duration, 12.0)
    return {**best, "est_bytes": int(best["size"] * read / duration)}


def pixabay(query, key, per_page, page=1):
    path = CACHE / "pixabay" / (hashlib.sha1(f"{query}|{per_page}{f'|{page}' if page > 1 else ''}".encode()).hexdigest()[:16] + ".json")
    data = read_json(path)
    if data is None:
        while True:
            # the key travels in the URL, which requests puts into its error messages: never let them print
            try:
                r = requests.get("https://pixabay.com/api/videos/", timeout=30, params={
                    "key": key, "q": query, "per_page": per_page, "page": page, "safesearch": "true"})
            except requests.RequestException as e:
                raise SystemExit(f"Pixabay {query!r} page {page}: {type(e).__name__}") from None
            if r.status_code == 429:
                time.sleep(int(r.headers.get("X-RateLimit-Reset", 30)) + 1)
                continue
            if not r.ok:
                raise SystemExit(f"Pixabay {query!r} page {page}: HTTP {r.status_code} {r.text[:200].replace(key, '***')}")
            data = r.json()
            break
        write_json(path, data)
        time.sleep(0.7)  # 100 requests/minute
    for v in data["hits"]:
        renditions = [
            {"name": n, "url": f["url"], "w": f["width"], "h": f["height"], "size": f["size"]}
            for n, f in v["videos"].items() if f.get("url") and f["width"] and f["height"]
        ]
        thumbs = {n: f["thumbnail"] for n, f in v["videos"].items() if f.get("thumbnail")}
        yield {
            "id": f"pb{v['id']}", "source": "pixabay", "source_id": str(v["id"]), "author": v["user"],
            "author_url": v.get("userURL") or f"https://pixabay.com/users/{v['user_id']}/", "page_url": v["pageURL"],
            "tags": clean_tags(v["tags"]), "title": v.get("name", ""), "duration": v["duration"],
            "kind": v["type"], "g_rated": bool(v.get("isGRated")), "ai": bool(v.get("isAiGenerated")),
            "low_quality": bool(v.get("isLowQuality")), "no_ai_training": bool(v.get("noAiTraining")),
            "downloads": v["downloads"], "likes": v["likes"], "renditions": renditions,
            "frames": [thumbs.get("tiny") or thumbs.get("small") or next(iter(thumbs.values()), None)],
        }


def pexels(query, key, per_page, page=1):
    """Same candidate shape from Pexels (portrait-oriented search). Untested: no PEXELS_API_KEY yet."""
    path = CACHE / "pexels" / (hashlib.sha1(f"{query}|{per_page}|{page}".encode()).hexdigest()[:16] + ".json")
    data = read_json(path)
    if data is None:
        r = requests.get("https://api.pexels.com/videos/search", timeout=30, headers={"Authorization": key},
                         params={"query": query, "orientation": "portrait", "per_page": min(per_page, 80), "page": page})
        r.raise_for_status()
        data = r.json()
        write_json(path, data)
        time.sleep(0.5)
    for v in data["videos"]:
        renditions = [
            {"name": f["quality"], "url": f["link"], "w": f["width"], "h": f["height"], "size": int(f["height"] * f["width"] * v["duration"] * 0.05)}
            for f in v["video_files"] if f["file_type"] == "video/mp4" and f.get("width") and f.get("height")
        ]  # Pexels gives no file size: estimate ~0.05 byte/pixel/second so the rendition order stays by resolution
        frames = [p["picture"] for p in v["video_pictures"]] or [v["image"]]
        slug = v["url"].rstrip("/").rsplit("/", 1)[-1].split("-")[:-1]
        yield {
            "id": f"px{v['id']}", "source": "pexels", "source_id": str(v["id"]), "author": v["user"]["name"],
            "author_url": v["user"]["url"], "page_url": v["url"], "tags": clean_tags(", ".join(slug)),
            "title": " ".join(slug), "duration": v["duration"], "kind": "film", "g_rated": False, "ai": False,
            "low_quality": False, "no_ai_training": False, "downloads": 0, "likes": 0, "renditions": renditions,
            "frames": [frames[len(frames) // 2]],
        }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--subset", action="store_true", help="10 themes, 25 results each (~150 candidates)")
    ap.add_argument("--per-query", type=int, help="results per query and page (default 100, subset 25)")
    ap.add_argument("--pages", type=int, help="result pages per query (default 2, subset 1)")
    args = ap.parse_args()
    per_query = args.per_query or (25 if args.subset else 100)
    pages = args.pages or (1 if args.subset else 2)
    themes = {t: THEMES[t] for t in SUBSET_THEMES} if args.subset else THEMES
    providers = []
    if os.getenv("PIXABAY_API_KEY"):
        providers.append((pixabay, os.getenv("PIXABAY_API_KEY")))
    if os.getenv("PEXELS_API_KEY"):
        providers.append((pexels, os.getenv("PEXELS_API_KEY")))
    if not providers:
        raise SystemExit("Add PIXABAY_API_KEY (and optionally PEXELS_API_KEY) to .env")

    found, seen, dropped = {}, set(), {"short": 0, "low_quality": 0, "no_ai_training": 0, "low_resolution": 0}
    for theme, queries in themes.items():
        for q in queries:
            for provider, key, page in [(p, k, n) for p, k in providers for n in range(1, pages + 1)]:
                for c in provider(q, key, per_query, page):
                    if c["id"] in seen:
                        if c["id"] in found and theme not in found[c["id"]]["themes"]:
                            found[c["id"]]["themes"].append(theme)
                        continue
                    seen.add(c["id"])
                    if c["duration"] < 6:
                        dropped["short"] += 1
                    elif c["low_quality"]:
                        dropped["low_quality"] += 1
                    elif c["no_ai_training"]:
                        dropped["no_ai_training"] += 1
                    elif not (rend := pick_rendition(c["renditions"], c["duration"])):
                        dropped["low_resolution"] += 1
                    else:
                        c["source_rendition"] = rend
                        c["themes"] = [theme]
                        del c["renditions"]
                        found[c["id"]] = c
        log(f"{theme}: {len(found)} candidates so far")
    out = list(found.values())
    write_json(out_dir(args.subset) / "candidates.json", out)
    portrait = sum(c["source_rendition"]["h"] > c["source_rendition"]["w"] for c in out)
    mb = sum(c["source_rendition"]["est_bytes"] for c in out) / 1e6
    log(f"{len(out)} candidates ({portrait} portrait-native); dropped {dropped}; ~{mb:.0f} MB if all were encoded")


if __name__ == "__main__":
    main()
