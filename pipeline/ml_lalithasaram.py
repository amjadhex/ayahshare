"""Malayalam: Quran Lalithasaram (Muhammad Karakunnu & Vanidas Elayavoor), used with the
publisher's permission (owner, 8 Oct 2026). Collects the public JSON behind lalithasaram.net into two files:

  out/lalithasaram/ml.lalithasaram.json        surahs → ayahs: text (footnote markers removed), audioText (what the
                                               recording says; differs in places), footnotes, + surah intro
  out/lalithasaram/ml.lalithasaram.words.json  word-by-word meanings, "s:a" → [[arabic, malayalam], ...]

Each ayah's "audio" is the id of its translation recording (AUDIO_URL). 21 pairs of ayahs share one sentence in this
translation, so both carry the same text and the same recording ("003_003,4" for 3:3–4).

`python ml_lalithasaram.py upload` then mirrors to R2 (resumable), served by the Worker at /media/<key>:
  voice/ml.lalithasaram/SSSAAA.mp3        the recording, one per ayah (EveryAyah naming); a pair's two keys hold the same
                                          recording, so a player plays it once, after the pair's last ayah in the range
  translations/ml.lalithasaram/<n>.json   the text the voice reads (audioText), in the Quran API's /surah/<n>/<edition>
                                          shape ({data: {ayahs: [{number, numberInSurah, text, audio}]}}), so what is
                                          read on screen is what is heard
Their server answers a missing file with 200 text/html, so every download is checked to be an MP3.
"""
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from common import CACHE, OUT, put_media, read_json, write_json, log

BASE = "https://d4dx-storage.blr1.cdn.digitaloceanspaces.com/Lalithasaram"
AUDIO_URL = "https://lalithasaram.net/audio/qtaud/transl/{audio}.mp3"  # the comma in a pair id is sent as-is
RAW = CACHE / "lalithasaram"
DEST = OUT / "lalithasaram"
R2_AUDIO = "voice/ml.lalithasaram/{s:03d}{a:03d}.mp3"
R2_TEXT = "translations/ml.lalithasaram/{s}.json"


def fetch(path):
    """One source file, cached under cache/lalithasaram/ so reruns do not hit their server."""
    local = RAW / path
    data = read_json(local)
    if data is None:
        r = requests.get(f"{BASE}/{path}", timeout=60)
        r.raise_for_status()
        data = r.json()
        write_json(local, data)
    return data


def strip_markers(text, numbers):
    """Remove the footnote numbers printed inside words ("മനുഷ്യരു2ണ്ട്") — only this ayah's footnote numbers, and only
    when glued to a letter, so real numbers in the text ("29 അധ്യായങ്ങള്‍") stay. A few markers have no footnote in their
    data (3:4, 50:18, 52:3, 90:3, 96:10); the second pass removes those when glued to a Malayalam letter or punctuation."""
    for n in sorted(numbers, key=lambda n: -len(str(n))):
        text = re.sub(rf"(?<=[^\d\s]){n}(?!\d)", "", text, count=1)
    return re.sub(r"(?<=[\u0D00-\u0D7F\u200c\u200d?!.])\d{1,3}(?!\d)", "", text)


def main():
    info = fetch("surah_info.json")
    notes = {}
    for f in fetch("footnotes.json"):
        notes.setdefault((f["SuraID"], f["AyaNo"]), []).append({"n": f["fnnumber"], "text": f["foottext"].strip()})
    with ThreadPoolExecutor(8) as pool:
        surahs = list(pool.map(lambda n: fetch(f"surahs/surah_{n}.json"), range(1, 115)))
        words = list(pool.map(lambda n: fetch(f"qwm/surah_{n}.json"), range(1, 115)))

    out, number, left_digits, differ, pairs = [], 0, [], 0, 0
    for meta, s in zip(info, surahs):
        n = meta["id"]
        assert s["surah"]["id"] == n and len(s["ayahs"]) == meta["totalAyahs"], f"surah {n}: unexpected data"
        ayahs = []
        for k, a in enumerate(s["ayahs"], 1):
            m = re.fullmatch(rf"{n:03d}_(\d{{3}})(?:,(\d+))?", a["audioUrl"])
            assert a["ayahNumber"] == k and m and k in (int(m[1]), int(m[2] or m[1])), f"{n}:{k}: unexpected ayah"
            pairs += k == int(m[1]) and m[2] is not None
            number += 1
            fns = sorted(notes.get((n, k), []), key=lambda f: f["n"])
            text = strip_markers(a["translation"].strip(), [f["n"] for f in fns]).replace("''", '"')
            audio_text = (a["audioTranslation"] or "").strip()
            if re.search(r"\d", text) and not re.search(r"\d", audio_text):
                left_digits.append(f"{n}:{k}")
            differ += text != audio_text
            ayahs.append({"number": number, "numberInSurah": k, "text": text, "audioText": audio_text, "audio": a["audioUrl"],
                          **({"footnotes": fns} if fns else {})})
        out.append({"number": n, "name": meta["name"], "arabicName": meta["arabicName"], "revelation": meta["revelation"],
                    "numberOfAyahs": meta["totalAyahs"], "intro": meta["intro"].strip(), "ayahs": ayahs})
    assert number == 6236, f"expected 6236 ayahs, got {number}"

    meanings = {}
    for w in (w for surah in words for w in surah):
        if w["MalMeaning"].strip():
            meanings.setdefault(f"{w['SuraId']}:{w['AyaId']}", []).append([w["WordPhrase"].strip(), w["MalMeaning"].strip()])

    write_json(DEST / "ml.lalithasaram.json", {
        "edition": {"identifier": "ml.lalithasaram", "language": "ml", "name": "ഖുര്‍ആന്‍ ലളിതസാരം",
                    "englishName": "Quran Lalithasaram (Muhammad Karakunnu & Vanidas Elayavoor)",
                    "audio": AUDIO_URL,
                    "source": "https://lalithasaram.net"},
        "surahs": out,
    })
    write_json(DEST / "ml.lalithasaram.words.json", meanings)
    log(f"{len(out)} surahs, {number} ayahs, {sum(len(v) for v in notes.values())} footnotes, "
        f"{sum(len(v) for v in meanings.values())} word meanings, {pairs} joined pairs; text ≠ audioText in {differ} ayahs; "
        f"digits left in text (check by hand): {left_digits[:20]}{' …' if len(left_digits) > 20 else ''} ({len(left_digits)})")


def recording(audio_id):
    """One recording's bytes, cached under cache/lalithasaram/audio/; refuses anything that is not an MP3."""
    local = RAW / "audio" / f"{audio_id}.mp3"
    if not local.exists():
        for attempt in range(5):  # their server drops a connection now and then
            try:
                r = requests.get(AUDIO_URL.format(audio=audio_id), timeout=60)
                break
            except (requests.ConnectionError, requests.Timeout):
                if attempt == 4:
                    raise
                time.sleep(3 * (attempt + 1))
        r.raise_for_status()
        if not r.headers.get("Content-Type", "").startswith("audio/") or not (r.content[:3] == b"ID3" or r.content[:1] == b"\xff"):
            raise ValueError(f"{audio_id}: not an MP3 ({r.headers.get('Content-Type')}, {len(r.content)} bytes)")
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(r.content)
    return local.read_bytes()


def upload():
    d = read_json(DEST / "ml.lalithasaram.json")
    assert d, "run without arguments first"
    done_path = RAW / "uploaded.json"
    done = set(read_json(done_path, []))
    lock = threading.Lock()

    def put(key, data, content_type):
        if key in done:
            return
        put_media(key, data, content_type)
        with lock:
            done.add(key)
            if len(done) % 200 == 0:
                write_json(done_path, sorted(done))
                log(f"{len(done)} uploaded")

    jobs = [(R2_AUDIO.format(s=s["number"], a=a["numberInSurah"]), a["audio"]) for s in d["surahs"] for a in s["ayahs"]]
    try:
        with ThreadPoolExecutor(8) as pool:
            list(pool.map(lambda j: put(j[0], recording(j[1]), "audio/mpeg"), jobs))
        edition = {"identifier": "ml.lalithasaram", "language": "ml", "name": d["edition"]["name"],
                   "englishName": d["edition"]["englishName"], "format": "text", "type": "translation", "direction": "ltr"}
        for s in d["surahs"]:
            body = {"code": 200, "status": "OK", "data": {
                "number": s["number"], "name": s["name"], "numberOfAyahs": s["numberOfAyahs"], "edition": edition,
                "ayahs": [{"number": a["number"], "numberInSurah": a["numberInSurah"], "text": a["audioText"], "audio": a["audio"]}
                          for a in s["ayahs"]]}}
            put(R2_TEXT.format(s=s["number"]), json.dumps(body, ensure_ascii=False).encode(), "application/json")
    finally:
        write_json(done_path, sorted(done))
    mb = sum(f.stat().st_size for f in (RAW / "audio").glob("*.mp3")) / 1e6
    log(f"{len(done)} objects in R2 ({len(jobs)} recordings + 114 surah texts); {mb:.0f} MB of unique recordings")


if __name__ == "__main__":
    upload() if sys.argv[1:] == ["upload"] else main()
