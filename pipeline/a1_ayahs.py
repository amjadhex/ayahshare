"""A1: surahs.json, ayahs-en.json (en.sahih) and the context documents used for embedding.

Quran text comes from the Quran API by ayah number; nothing is generated. Arabic is not stored here
(the app fetches it live), only the English used for search results and Luna rerank descriptions.
"""
import requests

from common import CACHE, OUT, publish, read_json, write_json, log

API = "https://api.alquran.cloud/v1"
EDITION = "en.sahih"
NEIGHBOUR_CHARS = 200  # how much of the previous / next ayah goes into a context document


def fetch(name, url):
    path = CACHE / "quran" / f"{name}.json"
    data = read_json(path)
    if data is None:
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        data = r.json()["data"]
        write_json(path, data)
    return data


def clip(text, n, tail):
    """First (or last) n chars, cut at a word boundary."""
    if len(text) <= n:
        return text
    if tail:
        cut = text[-n:]
        return "… " + cut[cut.find(" ") + 1:]
    cut = text[:n]
    return cut[:cut.rfind(" ")] + " …"


def context_doc(surah, k, texts):
    """Surah name + the ayah + its neighbours, so a very short ayah ("Ta, Ha.") carries its surroundings."""
    s = surah["n"]
    name = surah["name_en"] + (f" ({surah['meaning']})" if surah["meaning"] != surah["name_en"] else "")
    parts = [f"Surah {name}, verse {k}: {texts[f'{s}:{k}']}"]
    if k > 1:
        parts.append("Before: " + clip(texts[f"{s}:{k - 1}"], NEIGHBOUR_CHARS, tail=True))
    if k < surah["ayahs"]:
        parts.append("After: " + clip(texts[f"{s}:{k + 1}"], NEIGHBOUR_CHARS, tail=False))
    return "\n".join(parts)


def main():
    surahs = [
        {"n": s["number"], "name_ar": s["name"], "name_en": s["englishName"], "meaning": s["englishNameTranslation"],
         "ayahs": s["numberOfAyahs"]}
        for s in fetch("surahs", f"{API}/surah")
    ]
    texts = {
        f"{s['number']}:{a['numberInSurah']}": a["text"].strip()
        for s in fetch(EDITION, f"{API}/quran/{EDITION}")["surahs"] for a in s["ayahs"]
    }
    assert len(surahs) == 114 and len(texts) == 6236 == sum(s["ayahs"] for s in surahs), "unexpected Quran API data"
    docs = {f"{s['n']}:{k}": context_doc(s, k, texts) for s in surahs for k in range(1, s["ayahs"] + 1)}

    OUT.mkdir(parents=True, exist_ok=True)
    write_json(OUT / "surahs.json", surahs)
    write_json(OUT / "ayahs-en.json", texts)
    write_json(OUT / "ayah_docs.json", docs)  # not published: input for A2/A3/A5
    publish(OUT / "surahs.json")
    publish(OUT / "ayahs-en.json")
    log(f"{len(surahs)} surahs, {len(texts)} ayahs; example doc for 20:1:\n{docs['20:1']}")


if __name__ == "__main__":
    main()
