"""A1b ayah groups: for every ayah, can a video show it alone, or which neighbours must come with it?

-> out/ayah_groups.json (per ayah) and out/ayah_groups.csv (the same, one row per ayah, for review); the app's part,
ref -> [from, to] for the ayahs that need neighbours, is published as data/ayah-groups.json (contracts AyahGroups).

Nothing is generated; every join comes from public data:
  waqf       the IndoPak mushaf mark at the end of the ayah (quran.com text_indopak): "la" (U+06D9, do not stop)
             means the meaning runs on; taah/meem (U+0615, U+06D8) mean a full stop.
  sentence   en.sahih punctuation: an ayah that ends without . ! ? runs on into the next one. The video shows the
             translation, so a sentence cut in half is never shown alone (107:4 "So woe to those who pray").
  fragment   an ayah that opens with "who / which / except / lower case" also reads back to its subject (107:5).
  exception  the next ayah opens with "Except / Unless ..." and limits this one (24:4-5, 95:5-6).
  letters    Alif-Lam-Meem style openings are always shown with the ayah after them.
  curated    complete sentences that mislead when shared alone (fighting, punishment), RANGES below.
A join needs the sentence (or exception, letters, curated); the waqf mark only raises or lowers confidence. A
"la" mark on its own (the translation already ends the sentence) is listed as an optional pair, never forced.

Grouping flags (any flag -> confidence "review"):
  arabic_stop    the translation runs on but the mushaf marks a full stop here (often a translation quirk)
  no_la          the translation runs on, the mushaf has no "la" mark (joined, but weaker evidence)
  optional_pair  the mushaf says "do not stop" but the translation sentence is complete: a suggested pair
  long           the range is longer than MAX_AYAHS ayahs or MAX_WORDS English words (too long for one video)
  curated        hand-picked: misleading alone
tafsir_review is separate from the grouping: curated ayahs and those A5 marked as punishment / Hellfire / war /
death (out/sensitive_review.json) need a scholar's look before publishing, whatever the grouping says.
Tafsir context for the reviewer: Ibn Kathir's ayah group (quran.com tafsir 169), clipped to the ruku.

AI review (data/ayah_groups_ai.jsonl, when present): Claude read every ayah with its neighbours, Tafsir al-Muyassar
and the rule result above, and gave the smallest range that keeps the meaning intact (one rule: group only when the
ayah alone is cut off or misleads). Its range is the final video_range (curated ranges are kept inside it); the
rule result moves to rule_range / rule_reasons / rule_flags, and the final flags become:
  ai_unsure      the reviewer says a careful scholar could decide either way
  disagree       the AI range differs from the rule range
  long, curated  as above, on the final range
Second pass (data/ayah_groups_ai_pass2.jsonl, when present): the ~600 doubtful ayahs (AI unsure, or the AI kept alone
what the rule and a "la" mark joined) re-judged with Tafsir al-Jalalayn and al-Biqa'i's Nazm al-Durar from the quran.ai
MCP; its range, reason and unsure flag replace the first pass for those ayahs, and `evidence` names the tafsir used.
Third pass (data/ayah_groups_ai_pass3.jsonl): the same check, grouping only, for the punishment / Hellfire / war /
death ayahs (tafsir_review) that the second pass had not covered. Later passes win.
"""
import csv
import json
import re

import requests

from common import CACHE, OUT, PIPE, publish, read_json, write_json, log

MAX_AYAHS = 4
MAX_WORDS = 120
END = re.compile(r"[.!?][\"'”’)\]\s]*$")
EXCEPT = re.compile(r"^(Except|Excepting|Excluded|Save|Unless)\b")
LEAD = re.compile(r"^[^\w\[]*(\[(But|And|So|Then|Or|Yet)\]\s*)?\W*")  # quote marks and a bracketed "[But]"; "[He] who" stays whole
FRAGMENT = re.compile(r"^([a-z]|(And )?(Who|Whom|Whose|Which|As if|Until|Except|Excepting|Other than|Save)\b)")
LETTERS = re.compile(r"^(?:[A-Z][a-z']*(?:, |\. |\.?$))+$")  # "Alif, Lam, Meem." / "Ha, Meem." / "Ta, Ha."
LA, STOPS = "ۙ", ("ؕ", "ۘ")

# Complete sentences that change meaning when shared alone; checked by hand against en.sahih and Ibn Kathir.
RANGES = {
    "2:190-193": "'kill them wherever you overtake them' is about those who fight you; if they cease, Allah forgives",
    "4:34-35": "marital discord: the steps, then arbitration from both families",
    "5:38-39": "the punishment for theft, then repentance",
    "8:12-13": "Badr: the order to the angels, then the reason",
    "8:60-61": "prepare strength, then 'if they incline to peace, incline to it'",
    "9:4-6": "treaty keepers excepted; 'kill the polytheists'; grant protection to whoever asks",
    "98:6-7": "worst of creatures, then best of creatures",
}
IK_API = "https://api.quran.com/api/v4/tafsirs/169/by_chapter"


def get_json(path, url, **params):
    data = read_json(path)
    if data is None:
        r = requests.get(url, params=params, timeout=120)
        r.raise_for_status()
        data = r.json()
        write_json(path, data)
    return data


def ibn_kathir_starts():
    """Refs where an Ibn Kathir group starts (the other ayahs of a group come back with empty text)."""
    path = CACHE / "passages" / "tafsir_169.json"
    lens = read_json(path)
    if lens is None:
        lens = {}
        for ch in range(1, 115):
            page = 1
            while page:
                r = requests.get(f"{IK_API}/{ch}", params={"per_page": 50, "page": page}, timeout=60)
                r.raise_for_status()
                d = r.json()
                lens.update({t["verse_key"]: len(t["text"] or "") for t in d["tafsirs"]})
                page = d["pagination"]["next_page"]
        write_json(path, lens)
    return {k for k, n in lens.items() if n}


def span(s, a, b):
    return f"{s}:{a}" if a == b else f"{s}:{a}-{b}"


def end_mark(text):
    last = text.split()[-1]
    if LA in last:
        return "la"
    if any(m in last for m in STOPS):
        return "stop"
    return "none"


def main():
    en = read_json(CACHE / "quran" / "en.sahih.json")["surahs"]
    ar = get_json(CACHE / "passages" / "uthmani.json", "https://api.alquran.cloud/v1/quran/quran-uthmani")["data"]["surahs"]
    ip = get_json(CACHE / "passages" / "indopak.json", "https://api.quran.com/api/v4/quran/verses/indopak")
    ip = {v["verse_key"]: v["text_indopak"].strip() for v in ip["verses"]}
    meta = get_json(CACHE / "passages" / "meta.json", "https://api.alquran.cloud/v1/meta")["data"]
    starts = ibn_kathir_starts() | {f"{x['surah']}:{x['ayah']}" for x in meta["rukus"]["references"]}
    sensitive = {x["ref"] for x in read_json(OUT / "sensitive_review.json", []) if (x["p"] or 0) >= 0.5}
    curated = {}
    for r, why in RANGES.items():
        s, ab = r.split(":")
        a, b = map(int, ab.split("-"))
        for x in range(a, b + 1):
            curated[f"{s}:{x}"] = (a, b, why)

    ai_path = PIPE / "data" / "ayah_groups_ai.jsonl"
    ai = {}
    if ai_path.exists():
        for line in ai_path.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            ai[r["ref"]] = r
    for later in sorted((PIPE / "data").glob("ayah_groups_ai_pass*.jsonl")):
        for line in later.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            ai[r["ref"]] = r
    rows = []
    for su_en, su_ar in zip(en, ar):
        s = su_en["number"]
        E = [x["text"].strip() for x in su_en["ayahs"]]
        n = len(E)
        marks = [end_mark(ip[f"{s}:{i + 1}"]) for i in range(n)]
        # join[i]: why ayah i+1 must be shown with ayah i+2 (None = it need not)
        join = [None] * (n - 1)
        for i in range(n - 1):
            if LETTERS.match(E[i]):
                join[i] = "letters"
            elif EXCEPT.match(re.sub(LEAD, "", E[i + 1])):
                join[i] = "exception"
            elif not END.search(E[i]):
                join[i] = "sentence"
        frag = [bool(FRAGMENT.match(re.sub(LEAD, "", t))) for t in E]
        ctx = [0] * (n + 1)  # Ibn Kathir / ruku group number per ayah
        for x in range(2, n + 1):
            ctx[x] = ctx[x - 1] + (f"{s}:{x}" in starts)
        for x in range(1, n + 1):
            ref = f"{s}:{x}"
            a = b = x
            while b < n and join[b - 1]:  # read on to the end of the sentence
                b += 1
            while a > 1 and join[a - 2] and (frag[a - 1] or join[a - 2] in ("exception", "letters")):
                a -= 1  # an opening fragment, an "except" or the ayah after the letters reads back
            reasons, flags = sorted({join[i] for i in range(a - 1, b - 1)}), []
            if ref in curated:
                ca, cb, why = curated[ref]
                a, b = min(a, ca), max(b, cb)
                reasons.append("curated")
                flags.append("curated")
            inner = range(a - 1, b - 1)
            if any(join[i] == "sentence" and marks[i] == "stop" for i in inner):
                flags.append("arabic_stop")
            elif any(join[i] == "sentence" and marks[i] != "la" for i in inner):
                flags.append("no_la")
            pair = None
            if a == b == x and x < n and marks[x - 1] == "la":
                pair = span(s, x, x + 1)
                flags.append("optional_pair")
            words = sum(len(E[i - 1].split()) for i in range(a, b + 1))
            if b - a + 1 > MAX_AYAHS or words > MAX_WORDS:
                flags.append("long")
            rule = {"rule_range": span(s, a, b), "rule_reasons": reasons, "rule_flags": flags}
            why = evidence = None
            if ai:
                r = ai[ref]
                why, evidence = r["why"], r.get("evidence")
                (a, b) = ((int(v) for v in r["range"].split(":")[1].split("-")) if "-" in r["range"] else (x, x))
                if ref in curated:
                    a, b = min(a, curated[ref][0]), max(b, curated[ref][1])
                flags = [f for f in ("curated",) if ref in curated]
                flags += ["ai_unsure"] if r.get("unsure") else []
                flags += ["disagree"] if span(s, a, b) != rule["rule_range"] else []
                words = sum(len(E[i - 1].split()) for i in range(a, b + 1))
                if b - a + 1 > MAX_AYAHS or words > MAX_WORDS:
                    flags.append("long")
            lo = min(i for i in range(1, n + 1) if ctx[i] == ctx[x])
            hi = max(i for i in range(1, n + 1) if ctx[i] == ctx[x])
            rows.append({
                "ref": ref,
                "standalone": a == b,
                "video_range": span(s, a, b),
                "confidence": "review" if flags else "high",
                "why": why,
                "evidence": evidence,
                "flags": flags,
                **rule,
                "tafsir_review": ref in curated or ref in sensitive,
                "optional_pair": pair,
                "waqf_end": marks[x - 1],
                "tafsir_context": span(s, min(lo, a), max(hi, b)),
                "curated_note": curated[ref][2] if ref in curated else None,
                "arabic": su_ar["ayahs"][x - 1]["text"],
                "english": E[x - 1],
            })

    write_json(OUT / "ayah_groups.json", rows, indent=1)
    with open(OUT / "ayah_groups.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        for r in rows:
            w.writerow({**r, **{k: " ".join(r[k]) for k in ("flags", "rule_reasons", "rule_flags")}})
    groups = {r["ref"]: [int(v) for v in r["video_range"].split(":")[1].split("-")] for r in rows if not r["standalone"]}
    write_json(OUT / "ayah-groups.json", groups)
    publish(OUT / "ayah-groups.json")
    alone = sum(r["standalone"] for r in rows)
    count = {}
    for r in rows:
        for f in r["flags"]:
            count[f] = count.get(f, 0) + 1
    log(f"ayah groups: {alone} ayahs can stand alone, {len(rows) - alone} need neighbours "
        f"({len({r['video_range'] for r in rows if not r['standalone']})} ranges); "
        f"{sum(r['confidence'] == 'high' for r in rows)} high confidence; flags {count}; "
        f"{sum(r['tafsir_review'] for r in rows)} for tafsir review")


if __name__ == "__main__":
    main()
