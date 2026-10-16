"""More tafsirs for Reflect, from spa5k/tafsir_api (https://github.com/spa5k/tafsir_api, a JSON copy of tafsirs published
by the Tafsir Center for Quranic Studies, altafsir.com, QUL and others). We keep our own copy in R2, served by the Worker
(apps/api/src/lib/owntafsir.ts), like Thafheem (ml_thafheem.py). Editions that the Quran Foundation already gives us
(same work, same language: Ibn Kathir, Ma'arif, Tazkirul Quran, Fi Zilal, Bayan ul Quran, Al-Sa'di Russian, the Bengali
and Kurdish ones) and Arabic are not taken; owner's list of broken ones is skipped (SKIPPED_BY_OWNER).

  python spa5k_tafsirs.py fetch     per-surah JSON from GitHub, pinned to COMMIT, into out/spa5k/<id>/<n>.json
                                    {surah, ayahs: [{ayah, text}]}, one entry per ayah, text trimmed (cached under cache/spa5k/)
  python spa5k_tafsirs.py qa        the quality gate: prints a table of every candidate, writes out/spa5k/manifest.json
                                    ({id, name, author, lang, source, ayahs}) for the editions that pass, and
                                    apps/api/src/lib/owntafsir-editions.ts (the same list as a TypeScript constant)
  python spa5k_tafsirs.py upload    tafsir/<id>/v1/<n>.json -> R2 for the included editions (served at /media/<key>), packed
                                    as {surah, ayahs: [{ayah, text, to?}]} (see pack: Al-Sa'di's repeated passages stored once)

Downloads are data: they are parsed as JSON and never executed.
"""
import concurrent.futures as cf
import json
import random
import re
import sys
import time
import unicodedata
from collections import Counter

import requests

from common import CACHE, OUT, PUBLIC, ROOT, log, put_media, read_json, write_json

COMMIT = "eb82bb6294efe30ad5c135c03b1864afaa70e855"  # spa5k/tafsir_api main on 2026-09-30
# raw.githubusercontent.com, not jsDelivr: jsDelivr refuses files of this repo ("Package size exceeded the configured limit of 50 MB")
CDN = f"https://raw.githubusercontent.com/spa5k/tafsir_api/{COMMIT}/tafsir"
RAW = CACHE / "spa5k"
DEST = OUT / "spa5k"
TS_FILE = ROOT / "apps/api/src/lib/owntafsir-editions.ts"
TOTAL = 6236
MIN_COVERAGE = 0.97

TCCQS = "Tafsir Center for Quranic Studies"
MUKHTASAR = "Al-Mukhtasar"
SAADI = ("Tafsir al-Sa'di", "Abd al-Rahman al-Sa'di")
IBN_KATHIR = ("Tafsir Ibn Kathir", "Hafiz Ibn Kathir")
JALALAYN_AUTHOR = "Jalal al-Din al-Mahalli & Jalal al-Din al-Suyuti"

# (our id, spa5k slug, language, name, author). Order = the order used to settle duplicates (the first one is kept).
# Our ids match /^[a-z]{2,3}\.[a-z0-9]{1,30}$/ (the web app validates remembered ids with it).
CANDIDATES = [
    ("en.mukhtasar", "en-tafsir-al-mukhtasar", "en", MUKHTASAR, TCCQS),
    # Two Jalalayn editions: tafsir-al-jalalayn keeps the punctuation that en-al-jalalayn lost ("Say ‘He is God One Allāhu…"
    # vs "Say: ‘He is God, One (Allāhu…)"), so it is the one kept; en-al-jalalayn is listed as a duplicate by the gate.
    ("en.jalalayn", "tafsir-al-jalalayn", "en", "Tafsir al-Jalalayn", JALALAYN_AUTHOR),
    ("en.jalalayn2", "en-al-jalalayn", "en", "Tafsir al-Jalalayn", JALALAYN_AUTHOR),
    ("en.ibnabbas", "en-tafsir-ibn-abbas", "en", "Tanwir al-Miqbas", "attributed to Ibn Abbas (al-Fayruzabadi)"),
    ("ml.mukhtasar", "malayalam-mokhtasar", "ml", MUKHTASAR, TCCQS),
    ("hi.mukhtasar", "hindi-mokhtasar", "hi", MUKHTASAR, TCCQS),
    ("ta.mukhtasar", "tamil-mokhtasar", "ta", MUKHTASAR, TCCQS),
    ("te.mukhtasar", "telugu-mokhtasar", "te", MUKHTASAR, TCCQS),
    ("as.mukhtasar", "assamese-mokhtasar", "as", MUKHTASAR, TCCQS),
    ("bn.mukhtasar", "bengali-mokhtasar", "bn", MUKHTASAR, TCCQS),
    ("si.mukhtasar", "sinhalese-mokhtasar", "si", MUKHTASAR, TCCQS),
    ("ja.mukhtasar", "japanese-mokhtasar", "ja", MUKHTASAR, TCCQS),
    ("zh.mukhtasar", "chinese-mokhtasar", "zh", MUKHTASAR, TCCQS),
    ("km.mukhtasar", "khmer-mokhtasar", "km", MUKHTASAR, TCCQS),
    ("th.mukhtasar", "thai-mokhtasar", "th", MUKHTASAR, TCCQS),
    ("vi.mukhtasar", "vietnamese-mokhtasar", "vi", MUKHTASAR, TCCQS),
    ("id.mukhtasar", "indonesian-mokhtasar", "id", MUKHTASAR, TCCQS),
    ("tl.mukhtasar", "tagalog-mokhtasar", "tl", MUKHTASAR, TCCQS),
    ("tr.mukhtasar", "turkish-mokhtasar", "tr", MUKHTASAR, TCCQS),
    ("az.mukhtasar", "azeri-mokhtasar", "az", MUKHTASAR, TCCQS),
    ("uz.mukhtasar", "uzbek-mokhtasar", "uz", MUKHTASAR, TCCQS),
    ("ky.mukhtasar", "kyrgyz-mokhtasar", "ky", MUKHTASAR, TCCQS),
    ("ug.mukhtasar", "uyghur-mokhtasar", "ug", MUKHTASAR, TCCQS),
    ("ru.mukhtasar", "russian-mokhtasar", "ru", MUKHTASAR, TCCQS),
    ("sr.mukhtasar", "serbian-mokhtasar", "sr", MUKHTASAR, TCCQS),
    ("bs.mukhtasar", "bosnian-mokhtasar", "bs", MUKHTASAR, TCCQS),
    ("fr.mukhtasar", "french-mokhtasar", "fr", MUKHTASAR, TCCQS),
    ("es.mukhtasar", "spanish-mokhtasar", "es", MUKHTASAR, TCCQS),
    ("it.mukhtasar", "italian-mokhtasar", "it", MUKHTASAR, TCCQS),
    ("fa.mukhtasar", "persian-mokhtasar", "fa", MUKHTASAR, TCCQS),
    ("ps.mukhtasar", "pashto-mokhtasar", "ps", MUKHTASAR, TCCQS),
    ("ku.mukhtasar", "kurdish-mokhtasar", "ku", MUKHTASAR, TCCQS),
    ("ff.mukhtasar", "fulani-mokhtasar", "ff", MUKHTASAR, TCCQS),
    # Other works in languages the Quran Foundation has no tafsir for, or a different work in one it has.
    ("sq.saadi", "sq-saadi", "sq", *SAADI),
    ("id.saadi", "id-tafsir-as-saadi", "id", *SAADI),
    ("tr.saadi", "turkish-tafsir-as-saadi-turkish", "tr", *SAADI),
    ("fa.saadi", "fr-tafsir-as-saadi", "fa", *SAADI),  # slug says "fr"; the language is checked below (Persian)
    ("ur.saadi", "ur-tafsir-as-saadi-urdu", "ur", *SAADI),
    ("tr.ibnkathir", "tr-tafsir-ibne-kathir", "tr", *IBN_KATHIR),
    ("ru.ibnkathir", "ru-tafsir-ibne-kahtir", "ru", *IBN_KATHIR),
    ("id.jalalayn", "in-tafsir-jalalayn", "id", "Tafsir al-Jalalayn", JALALAYN_AUTHOR),
]
SKIPPED_BY_OWNER = {
    "en-al-qushairi-tafsir": "owner: broken",
    "en-kashani-tafsir": "owner: broken",
    "en-tafsir-al-tustari": "owner: broken",
    "en-asbab-al-nuzul-by-al-wahidi": "owner: broken",
    "en-kashf-al-asrar-tafsir": "owner: broken",
}
# Letters of the expected script (share of the edition's letters that must be in it).
SCRIPTS = {
    "ml": "Malayalam", "hi": "Devanagari", "ta": "Tamil", "te": "Telugu", "as": "Bengali", "bn": "Bengali", "si": "Sinhala",
    "ja": "Han|Hiragana|Katakana", "zh": "Han", "km": "Khmer", "th": "Thai", "ru": "Cyrillic", "sr": "Cyrillic|Latin",
    "ky": "Cyrillic", "uz": "Cyrillic|Latin", "ug": "Arabic", "fa": "Arabic", "ps": "Arabic", "ur": "Arabic", "ku": "Arabic|Latin",
}
LATIN = {"en", "id", "tl", "tr", "az", "uz", "bs", "fr", "es", "it", "vi", "sq", "ff"}
# U+FFFD, and UTF-8 read as Latin-1 ("Ã©", "â€™", "Â ", "Ø§", "Ù„"). A bare "Â" or "Ã" is not one: "Âlem", "Ân Huệ" are real words.
MOJIBAKE = re.compile("\ufffd|Ã[\u0080-\u00bf]|â€|Â[\u00a0-\u00bf]|ï¿½|Ø[\u00a7-\u00b9]|Ù[\u0080-\u00bf]")
MIN_SCRIPT_SHARE = 0.7


# ---------------------------------------------------------------------------
def surah_sizes():
    return [s["ayahs"] for s in read_json(PUBLIC / "surahs.json")]


def normalise(raw, surah):
    """The CDN's per-surah file ({ayahs: [...]} or a bare list, ayahs in text order of their numbers) → {surah, ayahs:
    [{ayah, text}]} in ayah order. Entries for other surahs or without a number are dropped."""
    items = raw.get("ayahs", []) if isinstance(raw, dict) else raw
    by = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        try:
            n = int(it.get("ayah"))
        except (TypeError, ValueError):
            continue
        if it.get("surah") not in (None, surah) and str(it.get("surah")) != str(surah):
            continue
        text = str(it.get("text") or "").replace("\u00ad", "").replace("\u200b", "").strip()  # soft hyphens (Azeri has 22,000) and zero-width spaces
        if n not in by or len(text) > len(by[n]):
            by[n] = text
    return {"surah": surah, "ayahs": [{"ayah": n, "text": by[n]} for n in sorted(by)]}


def get_surah(slug, surah):
    local = RAW / slug / f"{surah}.json"
    if local.exists():
        return read_json(local)
    for attempt in range(6):
        try:
            r = requests.get(f"{CDN}/{slug}/{surah}.json", timeout=60)
            if r.status_code == 200:
                data = r.json()
                write_json(local, data)
                return data
            if r.status_code == 404:
                raise FileNotFoundError(f"{slug}/{surah}")
        except (requests.ConnectionError, requests.Timeout, ValueError):
            pass
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{slug}/{surah}: download failed")


def fetch():
    jobs = [(c, n) for c in CANDIDATES for n in range(1, 115)]

    def one(job):
        c, n = job
        return c[0], n, normalise(get_surah(c[1], n), n)

    done = 0
    with cf.ThreadPoolExecutor(12) as ex:
        for eid, n, body in ex.map(one, jobs):
            write_json(DEST / eid / f"{n}.json", body)
            done += 1
    log(f"{len(CANDIDATES)} editions x 114 surahs = {done} files in {DEST}")


# ---------------------------------------------------------------------------
def load(eid):
    """{(surah, ayah): text} for an edition from out/spa5k/<id>/, only the ayahs that exist in the Quran."""
    sizes, out = surah_sizes(), {}
    for n in range(1, 115):
        d = read_json(DEST / eid / f"{n}.json")
        if not d:
            continue
        for a in d["ayahs"]:
            if 1 <= a["ayah"] <= sizes[n - 1]:
                out[(n, a["ayah"])] = a["text"]
    return out


def script_share(texts, pattern):
    import regex  # \p{Script=...} needs the third-party "regex" module
    rx = regex.compile("(?=\\p{L})[" + "".join(rf"\p{{Script={s}}}" for s in pattern.split("|")) + "]")
    joined = "\n".join(texts)
    total = len(regex.findall(r"\p{L}", joined))
    return len(rx.findall(joined)) / total if total else 0.0


def check(c, texts):
    eid, slug, lang = c[0], c[1], c[2]
    values = list(texts.values())
    nonempty = [t for t in values if t]
    row = {"id": eid, "slug": slug, "lang": lang, "ayahs": len(nonempty), "listed": len(values)}
    row["coverage"] = len(nonempty) / TOTAL
    row["fffd"] = sum(t.count("�") for t in nonempty)
    row["mojibake"] = sum(bool(MOJIBAKE.search(t)) for t in nonempty)
    row["script"] = script_share(nonempty, SCRIPTS.get(lang, "Latin"))
    row["chars"] = sum(len(t) for t in nonempty)
    row["punct"] = sum(len(re.findall(r"[,.;:()]", t)) for t in nonempty) / max(1, row["chars"]) * 100
    fails = []
    if row["coverage"] < MIN_COVERAGE:
        fails.append(f"coverage {row['coverage']:.1%}")
    if row["fffd"] or row["mojibake"]:
        fails.append(f"bad characters (U+FFFD {row['fffd']}, mojibake in {row['mojibake']} ayahs)")
    if row["script"] < MIN_SCRIPT_SHARE:
        fails.append(f"script {row['script']:.0%}")
    row["fails"] = fails
    return row


def norm_key(t):
    return hash(re.sub(r"\W+", "", unicodedata.normalize("NFKC", t).lower()))


def qa():
    rows, kept, texts_of, keys_of = [], [], {}, {}
    for c in CANDIDATES:
        texts = load(c[0])
        assert (DEST / c[0]).exists(), f"{c[0]}: run fetch first"
        texts_of[c[0]] = texts
        keys_of[c[0]] = {a: norm_key(t) for a, t in texts.items() if t}
        row = check(c, texts)
        row["cand"] = c
        # An obvious duplicate of an included edition: the same text for a third of the ayahs, or nearly the same for
        # most (the second Jalalayn differs from the first only in punctuation).
        for k in kept:
            both = [a for a in keys_of[c[0]] if a in keys_of[k["id"]]]
            same = sum(keys_of[c[0]][a] == keys_of[k["id"]][a] for a in both)
            if both and same / len(both) > 0.3:
                row["fails"].append(f"duplicate of {k['id']} ({same / len(both):.0%} identical)")
                break
        if not row["fails"]:
            kept.append(row)
        rows.append(row)
    for slug, why in SKIPPED_BY_OWNER.items():
        rows.append({"id": "-", "slug": slug, "lang": "-", "ayahs": 0, "coverage": 0, "script": 0, "fffd": 0, "mojibake": 0,
                     "punct": 0, "fails": [why], "cand": None})
    print(f"{'id':14} {'slug':36} {'ayahs':>6} {'cov':>6} {'script':>6} {'fffd':>4} {'moji':>4}  verdict")
    for r in rows:
        print(f"{r['id']:14} {r['slug']:36} {r['ayahs']:>6} {r['coverage']:>6.1%} {r['script']:>6.0%} {r['fffd']:>4} {r['mojibake']:>4}  "
              + ("INCLUDED" if not r["fails"] else "left out: " + "; ".join(r["fails"])))
    rnd = random.Random(7)
    print("\nspot check (3 random ayahs each, first 120 characters)")
    for r in kept:
        keys = rnd.sample([a for a, t in texts_of[r["id"]].items() if t], 3)
        for a in keys:
            print(f"  {r['id']:14} {a[0]}:{a[1]:<4} {texts_of[r['id']][a][:120]!r}")
    manifest = [{"id": r["id"], "name": r["cand"][3], "author": r["cand"][4], "lang": r["lang"],
                 "source": f"https://github.com/spa5k/tafsir_api/tree/{COMMIT}/tafsir/{r['slug']}", "ayahs": r["ayahs"]} for r in kept]
    write_json(DEST / "manifest.json", manifest, indent=1)
    ts = [f'  {{ id: {json.dumps(m["id"])}, name: {json.dumps(m["name"], ensure_ascii=False)}, author: {json.dumps(m["author"])}, lang: {json.dumps(m["lang"])} }},'
          for m in manifest]
    TS_FILE.write_text(
        "// GENERATED by pipeline/spa5k_tafsirs.py qa (the editions that passed its quality gate; data in R2 under tafsir/<id>/v1/).\n"
        "// Source: spa5k/tafsir_api @ " + COMMIT[:7] + ". Do not edit by hand.\n"
        'import type { TafsirInfo } from "../../../../contracts/types";\n\n'
        "export const SPA5K_EDITIONS: (TafsirInfo & { id: string })[] = [\n" + "\n".join(ts) + "\n];\n")
    log(f"{len(manifest)} of {len(CANDIDATES)} editions included → {DEST / 'manifest.json'}, {TS_FILE.name}")


PASSAGE_FROM = 600  # characters: a text this long, identical for consecutive ayahs, is one passage over all of them


def pack(body):
    """The surah file as stored in R2: {surah, ayahs: [{ayah, text, to?}]}. Ayahs without text are left out, and
    consecutive ayahs with one identical long text (Al-Sa'di's passages: the same 5,000-80,000 characters repeated for each
    ayah of the group, 80 MB per edition) are stored once, `to` = the last ayah it explains. Short repeats (a refrain
    explained the same way ayah after ayah) stay as they are."""
    out = []
    for a in body["ayahs"]:
        if not a["text"]:
            continue
        last = out[-1] if out else None
        if last and len(a["text"]) >= PASSAGE_FROM and a["text"] == last["text"] and last.get("to", last["ayah"]) == a["ayah"] - 1:
            last["to"] = a["ayah"]
        else:
            out.append({"ayah": a["ayah"], "text": a["text"]})
    return {"surah": body["surah"], "ayahs": out}


def upload():
    manifest = read_json(DEST / "manifest.json")
    assert manifest, "run qa first"
    puts = [(m["id"], n) for m in manifest for n in range(1, 115)]

    def one(job):
        eid, n = job
        body = json.dumps(pack(read_json(DEST / eid / f"{n}.json")), ensure_ascii=False, separators=(",", ":")).encode()
        put_media(f"tafsir/{eid}/v1/{n}.json", body, "application/json")

    with cf.ThreadPoolExecutor(6) as ex:
        list(ex.map(one, puts))
    log(f"{len(puts)} files in R2 under tafsir/<id>/v1/ ({len(manifest)} editions)")


if __name__ == "__main__":
    {"fetch": fetch, "qa": qa, "upload": upload}[sys.argv[1] if len(sys.argv) > 1 else "fetch"]()
