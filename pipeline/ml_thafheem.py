"""Malayalam: Thafheemul Quran (Sayyid Abul A'la Maududi; Malayalam translation and notes), used with the publisher's
permission (owner, 8 Oct 2026). Collects the public API behind thafheem.net (thafheemapi.thafheem.net) into:

  out/thafheem/ml.thafheem.json         surahs → ayahs: text (the ayah's translation, no note markers), summary (a short
                                        explanation of the ayah), + the surah intro and the translation in Thafheem's
                                        own blocks ("(2-4) ...", with the note numbers in the text)
  out/thafheem/ml.thafheem.tafsir.json  "<surah>" → the numbered notes (the tafsir): {n, text, from, to, ayah}; from-to is the
                                        block whose text carries the note's number (else the API's wider range), ayah
                                        the one ayah it explains when that can be told (else null; see pin_ayah)

`python ml_thafheem.py upload` then puts one file per surah in R2, served by the Worker at /media/<key>:
  tafsir/ml.thafheem/v2/<n>.json   (v2: notes gained "ayah"; /media is cached as immutable, so a change needs a new path)
                                {surah, name, arabicName, intro, ayahs: [{numberInSurah, summary}], notes: [{n, text, from, to, ayah}]}

For the tafsir (owner: text only, no audio). Their server answers a missing path with 200 text/html, so responses are
checked to be JSON.
"""
import difflib
import json
import re
import sys
import time

import requests

from common import CACHE, OUT, put_media, read_json, write_json, log

API = "https://thafheemapi.thafheem.net/api"
RAW = CACHE / "thafheem"
DEST = OUT / "thafheem"
# A block starts on a new line with "(2-4)" or "(5)"; a dash before or after marks an ayah split between two blocks:
# "(286-)" then "(-286)", "(142-143-)" then "(-143 ...)".
HEADER = re.compile(r"^[ \t]*\(\s*(-?)\s*(\d+)\s*(?:-\s*(\d+)\s*)?(-?)\s*\)[ \t]+", re.M)


GAP = 0.55  # their API allows 120 requests a minute (ratelimit-policy: 120;w=60)
_last = [0.0]


def get(path, missing_ok=False):
    """One API response, cached under cache/thafheem/ (a 404 is cached as null when missing_ok). Requests are paced
    under their rate limit; a 429 waits for the window to reset, a dropped connection is retried."""
    local = RAW / (path.replace("/", "_") + ".json")
    if local.exists():
        return read_json(local)
    for attempt in range(8):
        time.sleep(max(0.0, _last[0] + GAP - time.time()))
        _last[0] = time.time()
        try:
            r = requests.get(f"{API}/{path}", timeout=60)
        except (requests.ConnectionError, requests.Timeout):
            if attempt == 7:
                raise
            time.sleep(3 * (attempt + 1))
            continue
        if r.status_code != 429:
            break
        time.sleep(int(r.headers.get("Retry-After") or r.headers.get("ratelimit-reset") or 60) + 1)
    if r.status_code == 404 and missing_ok:
        data = None
    else:
        r.raise_for_status()
        if "json" not in r.headers.get("Content-Type", ""):
            raise ValueError(f"{path}: not JSON ({r.headers.get('Content-Type')})")
        data = r.json()
    write_json(local, data)
    return data


def notes_of(surah):
    """Notes 1, 2, 3 ... until three numbers in a row are missing."""
    out, n, misses = [], 1, 0
    while misses < 3:
        d = get(f"malayalam/interpretation/{surah}/{n}", missing_ok=True)
        if d and d.get("interpretation"):
            text = re.sub(rf"^\s*{n}\s*\.\s*", "", d["interpretation"]).strip()  # drop the leading "8. "
            out.append({"n": n, "text": text, "from": d.get("fromAyah"), "to": d.get("toAyah")})
            misses = 0
        else:
            misses += 1
        n += 1
    return out


def blocks_of(surah):
    """Thafheem's own translation blocks for a surah, [{from, to, text}], in order. /malayalam/surah/<n> returns, for
    each ayah, the run of blocks around it (or just its own block, without a header), so the runs overlap; each block
    is kept once. Text before a run's first header is the tail of an earlier block and is skipped."""
    seen, bare = {}, {}
    for t in get(f"malayalam/surah/{surah}")["translations"]:
        parts = HEADER.split(t["translation_text"])
        if len(parts) == 1:
            bare[t["verse_number"]] = parts[0]
        for i in range(1, len(parts) - 4, 5):
            lead, a, b, trail, text = parts[i:i + 5]
            text = re.sub(r"\s+", " ", text).strip()
            if text:  # the second half of a split ayah sorts after the block holding its first half
                seen.setdefault((int(a), bool(lead), int(b or a), bool(trail)), text)
    covered = {v for f, _, e, _ in seen for v in range(f, e + 1)}
    for v, text in bare.items():  # an ayah only ever returned on its own (e.g. 2:1 "അലിഫ്-ലാം-മീം.1")
        if v not in covered and text.strip():
            seen[(v, False, v, False)] = re.sub(r"\s+", " ", text).strip()
    return [{"from": k[0], "to": k[2], "text": seen[k]} for k in sorted(seen)]


def letters(text):
    """Malayalam letters only, so the block text and the per-ayah text compare despite spacing, punctuation and joiners."""
    return re.sub(r"[^\u0D00-\u0D7F]", "", text.replace("\u200d", "").replace("\u200c", ""))


def ayah_starts(block, ayah_text):
    """Where each ayah of the block begins in its letters-only text: the ayah's own translation (its first 18 letters)
    found in order; -1 when the wording differs too much to find it."""
    flat, pos, starts = letters(block["text"]), 0, {}
    for a in range(block["from"], block["to"] + 1):
        head = letters(ayah_text.get(a, ""))[:18]
        k = flat.find(head, pos) if head else -1
        if k < 0 and head:
            best = max(((difflib.SequenceMatcher(None, head, flat[j:j + len(head)]).ratio(), j)
                        for j in range(pos, max(pos + 1, len(flat) - len(head) + 1), 3)), default=(0, -1))
            k = best[1] if best[0] > 0.7 else -1
        starts[a] = k
        if k >= 0:
            pos = k + 1
    return starts


def pin_ayah(block, offset, starts):
    """The ayah a note explains. Its number follows the phrase it explains, so it belongs to the last ayah that starts
    before it; kept only when the next ayah's start is found after it too (or there is none), else None."""
    if block["from"] == block["to"]:
        return block["from"]
    before = [a for a, k in starts.items() if 0 <= k < offset]
    if not before:
        first = starts[block["from"]]
        return block["from"] if first == -1 or offset <= first + 2 else None
    a = before[-1]
    return a if a == block["to"] or starts.get(a + 1, -1) >= offset else None


def place_notes(notes, blocks, ayah_text):
    """Give each note the block whose text carries its number, and the ayah within it. Note numbers run 1, 2, 3 ...
    through the surah, so they are looked for in order, each after the previous one: the number on its own
    ("ആരുമില്ല6", "പറയുക:1", "മാര്‍ഗത്തിലല്ല 10 ."), not part of a reference like 2:229. Returns (block found, ayah found)."""
    i, pos, placed, pinned, starts = 0, 0, 0, 0, {}
    for note in notes:
        note["ayah"] = None
        pat = re.compile(rf"(?<!\d)(?<!\d:){note['n']}(?!\d)(?!:\d)")
        for j in range(i, len(blocks)):
            m = pat.search(blocks[j]["text"], pos if j == i else 0)
            if m:
                i, pos, b = j, m.end(), blocks[j]
                note["from"], note["to"] = b["from"], b["to"]
                if j not in starts:
                    starts[j] = ayah_starts(b, ayah_text)
                note["ayah"] = pin_ayah(b, len(letters(b["text"][:m.start()])), starts[j])
                placed += 1
                pinned += note["ayah"] is not None
                break
    return placed, pinned


def surah_data(meta):
    n = meta["SuraID"]
    ayahs = get(f"malayalam/quranaya/{n}")
    assert [a["ayaid"] for a in ayahs] == list(range(1, meta["TotalAyas"] + 1)), f"surah {n}: unexpected ayahs"
    intro = get(f"malayalam/surah-intro/{n}", missing_ok=True) or {}
    blocks = blocks_of(n)
    notes = notes_of(n)
    placed = place_notes(notes, blocks, {a["ayaid"]: a["AudioText"] or "" for a in ayahs})
    return {
        "number": n, "name": meta["ESuraName"], "arabicName": meta["ASuraName"], "numberOfAyahs": meta["TotalAyas"],
        "intro": [{"title": (s.get("subtitle") or "").strip(), "text": (s.get("text") or "").strip()} for s in intro.get("sections", [])],
        "ayahs": [{"numberInSurah": a["ayaid"], "text": (a["AudioText"] or "").strip(), "summary": (a["AudioIntrerptn"] or "").strip()}
                  for a in ayahs],
        "blocks": blocks,
    }, notes, placed


def main():
    surahs = get("suranames/all")
    assert len(surahs) == 114
    results = [surah_data(m) for m in surahs]  # one at a time: the rate limit, not threads, sets the pace

    number, empty = 0, []
    for s, _, _ in results:
        for a in s["ayahs"]:
            number += 1
            a["number"] = number
            if not a["text"]:
                empty.append(f"{s['number']}:{a['numberInSurah']}")
    assert number == 6236, f"expected 6236 ayahs, got {number}"

    write_json(DEST / "ml.thafheem.json", {
        "edition": {"identifier": "ml.thafheem", "language": "ml", "name": "തഫ്ഹീമുല്‍ ഖുര്‍ആന്‍",
                    "englishName": "Thafheemul Quran (Sayyid Abul A'la Maududi)",
                    "source": "https://thafheem.net"},
        "surahs": [s for s, _, _ in results],
    })
    write_json(DEST / "ml.thafheem.tafsir.json", {str(s["number"]): notes for s, notes, _ in results})
    total = sum(len(r[1]) for r in results)
    placed, pinned = sum(r[2][0] for r in results), sum(r[2][1] for r in results)
    log(f"114 surahs, {number} ayahs ({len(empty)} without text: {empty[:10]}), "
        f"{sum(len(s['blocks']) for s, _, _ in results)} translation blocks, {total} notes "
        f"({placed} placed on their block, the rest keep the API's range; {pinned} pinned to one ayah)")


def upload():
    d, tafsir = read_json(DEST / "ml.thafheem.json"), read_json(DEST / "ml.thafheem.tafsir.json")
    assert d and tafsir, "run without arguments first"
    for s in d["surahs"]:
        body = {"surah": s["number"], "name": s["name"], "arabicName": s["arabicName"], "intro": s["intro"],
                "ayahs": [{"numberInSurah": a["numberInSurah"], "summary": a["summary"]} for a in s["ayahs"]],
                "notes": tafsir[str(s["number"])]}
        put_media(f"tafsir/ml.thafheem/v2/{s["number"]}.json", json.dumps(body, ensure_ascii=False).encode(), "application/json")
    log("114 surah files in R2 under tafsir/ml.thafheem/v2/")


if __name__ == "__main__":
    upload() if sys.argv[1:] == ["upload"] else main()
