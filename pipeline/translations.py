"""The translations the app offers: apps/web/public/data/translations.json, built from the two Quran APIs the app
already uses, and checked against them. Nothing here writes or changes translation text: it only lists editions.

  alquran.cloud     GET /v1/edition?format=text&type=translation          text through the Worker at /qapi/surah/<n>/<id>
  Quran Foundation  GET /content/api/v4/resources/translations (production) text through the Worker at
                                                                          /qapi/surah/<n>/<lang>.qf-<id> (routes/proxy.ts)

Every alquran.cloud translation is kept (designs and share links use their ids), except quran-buck: the Arabic in
Buckwalter transliteration, whose id a design cannot hold. A Quran Foundation translation is added when:
  - it is a translation (not the transliteration, not a tafsir shown in translation mode, not Arabic);
  - surahs 1 and 112 load in full with text in every ayah, through the same API call the Worker makes;
  - its script runs the way the app writes its language (the app picks direction and font by language: a Roman Urdu
    edition would be drawn right to left);
  - it is not one of the alquran.cloud translations again (same language and nearly the same text in surahs 1 and 112).
A sample also loads surah 2 (286 ayahs) in full. Downloads are cached under cache/translations/.

    cd pipeline && ../.venv/bin/python translations.py

QF_CLIENT_ID / QF_CLIENT_SECRET come from ../.env and are never printed.
"""
import difflib
import json
import os
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from dotenv import load_dotenv

PIPE = Path(__file__).parent
ROOT = PIPE.parent
RAW = PIPE / "cache" / "translations"
DEST = ROOT / "apps/web/public/data/translations.json"
load_dotenv(ROOT / ".env")

ALQURAN = "https://api.alquran.cloud/v1"
QF_TOKEN = "https://oauth2.quran.foundation/oauth2/token"
QF_BASE = "https://apis.quran.foundation"

# Quran Foundation language names → the ISO 639 code the app uses (alquran.cloud's code where both have the language).
QF_LANG = {
    "afar": "aa", "albanian": "sq", "amazigh": "ber", "amharic": "am", "arabic": "ar", "asante": "ak", "assamese": "as",
    "azeri": "az", "bambara": "bm", "bengali": "bn", "bosnian": "bs", "bulgarian": "bg", "central khmer": "km",
    "chechen": "ce", "chinese": "zh", "croatian": "hr", "czech": "cs", "dari": "prs", "divehi": "dv", "dutch": "nl",
    "english": "en", "filipino": "ceb", "finnish": "fi", "french": "fr", "fulah": "ff", "ganda": "lg", "german": "de",
    "gujarati": "gu", "hausa": "ha", "hebrew": "he", "hindi": "hi", "indonesian": "id", "italian": "it",
    "japanese": "ja", "kannada": "kn", "kazakh": "kk", "kinyarwanda": "rw", "korean": "ko", "kurdish": "ku",
    "kyrgyz, kirghiz": "ky", "lingala": "ln", "lithuanian": "lt", "macedonian": "mk", "malay": "ms", "malayalam": "ml",
    "maranao": "mrw", "marathi": "mr", "moore": "mos", "nepali": "ne", "norwegian": "no", "oromo": "om", "pashto": "ps",
    "persian": "fa", "polish": "pl", "portuguese": "pt", "punjabi": "pa", "romanian": "ro", "rundi": "rn",
    "russian": "ru", "serbian": "sr", "sindhi": "sd", "sinhala, sinhalese": "si", "somali": "so", "spanish": "es",
    "swahili": "sw", "swedish": "sv", "tagalog": "tl", "tajik": "tg", "tamil": "ta", "tatar": "tt", "telugu": "te",
    "thai": "th", "turkish": "tr", "uighur, uyghur": "ug", "ukrainian": "uk", "urdu": "ur", "uzbek": "uz",
    "vietnamese": "vi", "yau,yuw": "yao", "yoruba": "yo",
}
# Quran Foundation's "Filipino" translation is in Bisaya (its name says so): Cebuano, "ceb" (Tagalog is "tl").
# alquran.cloud lists Muhamed Mehanović's Bosnian translation under "ba" (the Bashkir code); its text is Bosnian.
LANGUAGE_FIX = {"ba.mehanovic": "bs"}
# Must match RTL in apps/web/src/config.ts: these languages are written right to left (Bambara's translations here are
# in N'Ko).
RTL = {"ar", "ur", "fa", "ps", "sd", "ku", "dv", "ug", "he", "prs", "bm"}
# The edition ids a design (Recipe.translation) can hold: apps/web/src/config.ts sanitizeRecipe, apps/api/src/lib/recipe.ts.
RECIPE_ID = re.compile(r"^[a-z]{2,3}\.[\w-]{1,40}$")
SAMPLE = (1, 112)
AYAHS = {1: 7, 2: 286, 36: 83, 112: 4}
FULL_EVERY = 5  # every 5th added translation also loads surah 2 in full
# A Quran Foundation translation is an alquran.cloud one again when their texts of surahs 1 and 112 are this similar
# (short, so close translations come near) and then their texts of surah 36 (83 ayahs) are at least SAME.
NEAR, SAME, LONG = 0.75, 0.93, 36

session = requests.Session()


def cached(name, fetch):
    path = RAW / name
    if path.exists():
        return json.loads(path.read_text())
    data = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False))
    return data


def get(url, headers=None, tries=4):
    for i in range(tries):
        try:
            r = session.get(url, headers=headers, timeout=60)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (404, 400):
                return None
        except requests.RequestException:
            pass
        time.sleep(2 * (i + 1))
    return None


_token = None


def qf_headers():
    global _token
    if not _token:
        cid, secret = os.getenv("QF_CLIENT_ID"), os.getenv("QF_CLIENT_SECRET")
        if not cid or not secret:
            sys.exit("QF_CLIENT_ID / QF_CLIENT_SECRET missing from .env")
        r = session.post(QF_TOKEN, auth=(cid, secret), data={"grant_type": "client_credentials", "scope": "content"}, timeout=30)
        r.raise_for_status()
        _token = r.json()["access_token"]
    return {"x-auth-token": _token, "x-client-id": os.getenv("QF_CLIENT_ID")}


def qf(path):
    return get(f"{QF_BASE}{path}", qf_headers())


def clean(text):
    """The Worker's cleaning (routes/proxy.ts qfText): footnote markers out, then any tag, then spaces."""
    text = re.sub(r"<sup\b[^>]*>.*?</sup>", "", text or "", flags=re.S | re.I)
    text = re.sub(r"<(?:/?p|br|/?div)\b[^>]*>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]*>", "", text)
    return re.sub(r"\s+", " ", text).strip()


def comparable(text):
    s = unicodedata.normalize("NFKD", text.lower())
    s = "".join(ch for ch in s if not unicodedata.category(ch).startswith(("M", "P", "S", "Z", "N", "C")))
    return s


def rtl_share(text):
    letters = [ch for ch in text if unicodedata.category(ch).startswith("L")]
    if not letters:
        return 0.0
    return sum(unicodedata.bidirectional(ch) in ("R", "AL") for ch in letters) / len(letters)


def alquran_surah(surah, ids):
    """Every alquran.cloud edition's text of one surah, in two requests' worth of batches."""
    out = {}
    for i in range(0, len(ids), 40):
        batch = ids[i:i + 40]
        data = cached(f"alquran/{surah}-{i}.json", lambda: get(f"{ALQURAN}/surah/{surah}/editions/{','.join(batch)}"))
        for ed in (data or {}).get("data", []):
            out[ed["edition"]["identifier"]] = [a["text"] for a in ed["ayahs"]]
    return out


def alquran_one(surah, edition):
    data = cached(f"alquran/{surah}-{edition}.json", lambda: get(f"{ALQURAN}/surah/{surah}/{edition}"))
    return [a["text"] for a in (data or {}).get("data", {}).get("ayahs", [])]


def similarity(a, b):
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def qf_surah(tid, surah):
    data = cached(f"qf/{tid}-{surah}.json", lambda: qf(f"/content/api/v4/quran/translations/{tid}?chapter_number={surah}"))
    return [clean(t.get("text", "")) for t in (data or {}).get("translations", [])]


def complete(texts, surah):
    return len(texts) == AYAHS[surah] and all(t.strip() for t in texts)


def main():
    alq = cached("alquran-editions.json", lambda: get(f"{ALQURAN}/edition?format=text&type=translation"))["data"]
    qfl = cached("qf-translations.json", lambda: qf("/content/api/v4/resources/translations"))["translations"]
    print(f"upstream: alquran.cloud {len(alq)} translations in {len({e['language'] for e in alq})} languages; "
          f"Quran Foundation {len(qfl)} in {len({e['language_name'].lower() for e in qfl})}")

    ids = [e["identifier"] for e in alq]
    alq_text = {s: alquran_surah(s, ids) for s in SAMPLE}
    kept, dropped = [], []
    for e in alq:
        i = e["identifier"]
        if not RECIPE_ID.match(i):
            dropped.append((i, f"alquran.cloud {i} ({e['englishName']}): not an id a design can hold (Buckwalter transliteration)"))
            continue
        ok = all(complete(alq_text[s].get(i, []), s) for s in SAMPLE)
        if not ok:
            dropped.append((i, "alquran.cloud text did not load"))
            continue
        kept.append({"identifier": i, "language": LANGUAGE_FIX.get(i, e["language"]), "englishName": e["englishName"].strip(), "name": e["name"].strip()})
    by_lang = {}
    for e in kept:
        by_lang.setdefault(e["language"], []).append(e["identifier"])

    def check(e):
        tid, lname = e["id"], e["language_name"].strip().lower()
        title = (e.get("translated_name") or {}).get("name") or e["name"]
        if lname not in QF_LANG:
            return None, f"qf {tid} {lname}: language not mapped"
        lang = QF_LANG[lname]
        if lang == "ar":
            return None, f"qf {tid} {title}: Arabic (a tafsir in translation mode)"
        if re.search(r"translitera", f"{e['name']} {title}", re.I):
            return None, f"qf {tid} {title}: transliteration"
        texts = {s: qf_surah(tid, s) for s in SAMPLE}
        if not all(complete(texts[s], s) for s in SAMPLE):
            return None, f"qf {tid} {title}: text missing or empty"
        sample = " ".join(texts[1] + texts[112])
        rtl = rtl_share(sample) > 0.5
        if rtl != (lang in RTL):
            return None, f"qf {tid} {title}: written {'right to left' if rtl else 'left to right'}, the app writes {lang} the other way"
        mine = comparable(sample)
        for other in by_lang.get(lang, []):
            theirs = comparable(" ".join(alq_text[1][other] + alq_text[112][other]))
            if similarity(mine, theirs) < NEAR:
                continue
            ratio = similarity(comparable(" ".join(qf_surah(tid, LONG))), comparable(" ".join(alquran_one(LONG, other))))
            if ratio >= SAME:
                return None, f"qf {tid} {title}: the same as {other} ({ratio:.2f} in surah {LONG})"
        author = (e.get("author_name") or "").strip()
        name = author if author and author.lower() != "unknown" and author != title else e["name"].strip()
        return {"identifier": f"{lang}.qf-{tid}", "language": lang, "englishName": title.strip(), "name": name}, None

    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(check, sorted(qfl, key=lambda e: e["id"])))
    added = [r for r, _ in results if r]
    dropped += [(None, why) for _, why in results if why]

    # A sample of the added translations loads the longest surah in full too.
    for e in added[::FULL_EVERY]:
        tid = e["identifier"].split(".qf-")[1]
        if not complete(qf_surah(tid, 2), 2):
            added.remove(e)
            dropped.append((e["identifier"], "surah 2 incomplete"))
    full_checked = len(added[::FULL_EVERY])

    editions = kept + added
    order = {e["identifier"]: n for n, e in enumerate(editions)}
    editions.sort(key=lambda e: (e["language"], ".qf-" in e["identifier"], order[e["identifier"]]))
    DEST.write_text(json.dumps({
        "source": "pipeline/translations.py: alquran.cloud text translations and the Quran Foundation translations that "
                  "are not among them; every one was loaded and checked. Not edited by hand.",
        "editions": editions,
    }, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"offered: {len(editions)} translations in {len({e['language'] for e in editions})} languages "
          f"({len(kept)} alquran.cloud, {len(added)} Quran Foundation; surah 2 loaded in full for {full_checked})")
    for _, why in dropped:
        print("  left out:", why)


if __name__ == "__main__":
    main()
