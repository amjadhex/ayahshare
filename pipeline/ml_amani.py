"""Malayalam: Amani Thafseer ("Vishudha Quran Vivaranam" by Muhammad Amani Moulavi, KNM), from the public pages of
amanithafseer.com (a WordPress site; robots.txt allows everything but /wp-admin/; no terms of use or licence is
published there); taken with the owner's approval (12 Oct 2026). Nothing here uploads yet.

The site has no JSON of its own for this (the WP REST API returns the posts with empty content); each page of the
sitemap is one "vibhagam" (section) of a surah, server-rendered. Its slugs are unreliable (080_059-075 is surah 8),
so the surah and ayahs of every block come from the anchors in the page itself: <a name="2:153-153"> opens a block of
ayahs 153..153 holding, in order, sectionPrefixText (commentary before), one panel per ayah (Arabic, Amani's own
translation, word by word), sectionPostText (the commentary on those ayahs). "<n>:Annex" pages are a surah's
closing notes ("vyakyanakurippu").

  python ml_amani.py fetch            sample only: surahs 1, 2, 112 (cache/amani/)
  python ml_amani.py fetch 5 18       these surahs (page slugs are matched by their number; pages whose slug is
                                      odd are only found by `fetch all`)
  python ml_amani.py fetch all        every page of the sitemap (~325 requests, about 6 minutes)
  python ml_amani.py build            cache/amani/ -> out/amani/<surah>.json
                                      {surah, ayahs: [{ayah, translation}],
                                       passages: [{from, to, text}] (one per block, text "" when the site has no
                                       commentary for it), annex: "text" | null}
  python ml_amani.py qa               coverage (translation, commentary), U+FFFD / mojibake, script

Paced at one request every 1.2 s, resumable (a page already in the cache is not asked for again), identified by its
User-Agent.
"""
import html
import json
import re
import sys
import time
from html.parser import HTMLParser

import requests

from common import CACHE, OUT, read_json, write_json, log

SITE = "https://amanithafseer.com"
RAW = CACHE / "amani"
DEST = OUT / "amani"
UA = "AyahShare-pipeline/1.0 (+https://ayahshare.com; reads public pages politely, 1 request per 1.2 s)"
GAP = 1.2
SAMPLE = [1, 2, 112]
_last = [0.0]


def get(url, retries=6):
    for attempt in range(retries):
        time.sleep(max(0.0, _last[0] + GAP - time.time()))
        _last[0] = time.time()
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=60)
        except (requests.ConnectionError, requests.Timeout):
            if attempt == retries - 1:
                raise
            time.sleep(5 * (attempt + 1))
            continue
        if r.status_code in (429, 500, 502, 503, 504):  # be gentle: back off, then try again
            time.sleep(int(r.headers.get("Retry-After") or 30) + 5 * attempt)
            continue
        return r
    raise RuntimeError(f"{url}: gave up after {retries} tries")


def slug_of(url):
    return url.removeprefix(SITE + "/").strip("/")


def sitemap():
    """The post URLs of the site's own sitemap (cached)."""
    local = RAW / "sitemap-posts.json"
    if local.exists():
        return read_json(local)
    r = get(f"{SITE}/wp-sitemap-posts-post-1.xml")
    r.raise_for_status()
    urls = re.findall(r"<loc>([^<]+)</loc>", r.text)
    assert len(urls) > 300, f"sitemap: only {len(urls)} urls"
    write_json(local, urls)
    return urls


def slug_surah(slug):
    m = re.match(r"0*(\d+)[_-]", slug)
    return int(m[1]) if m else None


def fetch(args):
    wanted = None if args == ["all"] else {int(a) for a in args} or set(SAMPLE)
    urls = [u for u in sitemap() if wanted is None or slug_surah(slug_of(u)) in wanted]
    log(f"{len(urls)} pages to fetch (cached ones are skipped)")
    done = 0
    for u in urls:
        local = RAW / "pages" / (slug_of(u) + ".json")
        if local.exists():
            continue
        r = get(u)
        r.raise_for_status()
        r.encoding = "utf-8"
        h = r.text
        i = h.find('<section class="translations')
        j = h.find("</section>", i)
        title = re.search(r"<h1[^>]*>(.*?)</h1>", h, re.S)
        if i < 0 or j < 0 or not title:
            raise ValueError(f"{u}: not the expected page (no translations section)")
        write_json(local, {"url": u, "title": html.unescape(re.sub(r"<[^>]+>", "", title[1])).strip(), "html": h[i:j]})
        done += 1
        if done % 20 == 0:
            log(f"  {done} fetched")
    log(f"fetched {done} new pages")
    if not (RAW / "quran-uthmani.json").exists():  # the Quran's own ayah texts, to place the site's panels by their Arabic
        r = get("https://api.alquran.cloud/v1/quran/quran-uthmani")
        r.raise_for_status()
        write_json(RAW / "quran-uthmani.json", r.json())


# ---- parsing --------------------------------------------------------------------------------------------------

BLOCK = re.compile(r'<div class="row-fluid clearfix mal-text"><a name="(\d+):([^"]+)" class="ayath-link"></a>')
PANEL = re.compile(r'<div class="panel panel-default"><a name="(\d+):(\d+)" class="ayath-link"></a>')
ARABIC = re.compile(r'<span class=aya>(.*?)</span> <span class="aya-number">', re.S)


class Text(HTMLParser):
    """HTML -> plain text: a paragraph or heading per line; <hr> and <br> are line breaks; scripts/styles dropped."""
    BLOCKS = {"p", "h1", "h2", "h3", "h4", "h5", "div", "li", "ul", "ol", "tr", "table", "blockquote", "hr", "br"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        if tag in self.BLOCKS:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1
        if tag in self.BLOCKS:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def plain(fragment):
    p = Text()
    p.feed(fragment)
    p.close()
    text = "".join(p.out).replace(" ", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{2,}", "\n", text).strip()
    return clean(text)


def clean(text):
    """Reference markers go: footnote stars "(*)", "(**)" and the "(*)" that opens a footnote line."""
    text = re.sub(r"\.[ ]?\(\*+\)\.", ".", text)  # "word. (*). Next" -> "word. Next"
    text = re.sub(r"[ ]?\(\*+\)", "", text)
    return re.sub(r"[ \t]+\n", "\n", text).strip()


def div_content(block, cls):
    """The inner HTML of <div class="cls">, up to its own closing tag (it can hold nested <div>s)."""
    m = re.search(rf'<div class="{cls}">', block)
    if not m:
        return ""
    depth = 1
    for t in re.finditer(r"<(/?)div\b", block[m.end():]):
        depth += -1 if t[1] else 1
        if depth == 0:
            return block[m.end(): m.end() + t.start()]
    return block[m.end():]


def parse_page(page):
    """The blocks of a cached page: [{surah, annex, prefix, post, panels: [(site ayah number, translation, arabic)]}].
    The block's own range in its anchor is not trusted (34:34-35 holds the panels of 34, 35 and 36); its panels are."""
    sec = page["html"]
    marks = list(BLOCK.finditer(sec))
    out = []
    for k, m in enumerate(marks):
        block = sec[m.end(): marks[k + 1].start() if k + 1 < len(marks) else len(sec)]
        panels = list(PANEL.finditer(block))
        parsed = []
        for pm, pn in zip(panels, panels[1:] + [None]):
            panel = block[pm.end(): pn.start() if pn else len(block)]
            li = re.search(r'<li class="list-group-item mal-text translation-list-group-item">(.*?)</li>', panel, re.S)
            ar = ARABIC.search(panel)
            parsed.append((int(pm[2]), plain(li[1]) if li else "", ar[1] if ar else ""))
        out.append({"surah": int(m[1]), "annex": m[2].lower() == "annex", "panels": parsed,
                    "prefix": plain(div_content(block, "sectionPrefixText")), "post": plain(div_content(block, "sectionPostText"))})
    return out


def skeleton(arabic):
    """The Arabic letters only (no vowel signs, signs of pause or numbers), with the letter shapes that differ between
    editions unified, so the site's ayah text and the canonical one compare."""
    t = "".join(c for c in re.sub(r"<[^>]+>", "", arabic) if "ء" <= c <= "ي" and c != "ـ" or c == "ٱ")
    for a, b in (("آ", "ا"), ("أ", "ا"), ("إ", "ا"), ("ٱ", "ا"), ("ى", "ي"), ("ة", "ه"), ("ؤ", "و"), ("ئ", "ي"), ("ء", "")):
        t = t.replace(a, b)
    return t


def canonical():
    """{surah: [skeleton of each ayah]} of the Quran (api.alquran.cloud quran-uthmani, cached by `fetch`)."""
    data = read_json(RAW / "quran-uthmani.json")
    assert data, "run fetch first"
    basmala = skeleton("بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ")
    out = {}
    for s in data["data"]["surahs"]:
        ays = [skeleton(a["text"]) for a in s["ayahs"]]
        if s["number"] not in (1, 9) and ays[0].startswith(basmala):  # the API puts the basmala in front of ayah 1
            ays[0] = ays[0][len(basmala):]
        out[s["number"]] = ays
    return out


def align(panels, ayahs):
    """The site numbers some surahs differently from the Quran (it splits an ayah in two panels, or joins two: surah 5
    runs to 123, 26:49 is split), so each panel is placed by its Arabic: the panels, read in order, are the ayah
    texts end to end. Returns [(from, to)] canonical ayahs for each panel, None where its text is not found."""
    whole = "".join(ayahs)
    ends, total = [], 0
    for t in ayahs:
        total += len(t)
        ends.append(total)
    out, pos = [], 0
    for _, _, arabic in panels:
        t = skeleton(arabic)
        if not t:
            out.append(None)
            continue
        # Where it starts: right at the end of the last panel, or (spelling differs by a letter here and there, so the
        # running position drifts) the nearest place within 60 letters where its first letters are found.
        k = pos if whole.startswith(t, pos) else -1
        for size in (20, 12, 6):
            if k >= 0:
                break
            head, near = t[:size], []
            at = whole.find(head, max(0, pos - 60))
            while 0 <= at <= pos + 60:
                near.append(at)
                at = whole.find(head, at + 1)
            if near:
                k = min(near, key=lambda a: abs(a - pos))
        if k < 0:
            out.append(None)
            pos += len(t)
            continue
        end = k + len(t)
        first = next(i for i, e in enumerate(ends) if e > k)
        last = next(i for i, e in enumerate(ends) if e >= max(k + 1, end - 3))  # 3 letters of leeway at the end
        pos = end
        out.append((first + 1, last + 1))
    return out


def build(args):
    pages = sorted((RAW / "pages").glob("*.json"))
    assert pages, "nothing cached: run fetch first"
    quran = canonical()
    by_surah = {}
    for f in pages:
        for b in parse_page(read_json(f)):
            by_surah.setdefault(b["surah"], []).append(b)
    want = {int(a) for a in args} if args else None
    for surah, blocks in sorted(by_surah.items()):
        if want and surah not in want:
            continue
        # Blocks in the site's reading order; one that two pages both carry (30:24) is kept once, the copy with commentary.
        annex, seen = None, {}
        for b in blocks:
            if b["annex"]:
                annex = "\n".join(x for x in (annex, b["prefix"], b["post"]) if x) or None
            elif b["panels"]:
                key = b["panels"][0][0]
                if key not in seen or ((b["prefix"] or b["post"]) and not (seen[key]["prefix"] or seen[key]["post"])):
                    seen[key] = b
        ordered = [seen[k] for k in sorted(seen)]
        mapping = align([p for b in ordered for p in b["panels"]], quran[surah])
        passages, unplaced, i = [], 0, 0
        for b in ordered:
            spans_, entries = [], []
            for n, tr, _ in b["panels"]:
                span = mapping[i]
                i += 1
                if span is None:  # not found in the Quran's text: keep the site's own number
                    span = (n, n) if n <= len(quran[surah]) else None
                    unplaced += 1
                if span:
                    entries.append({"from": span[0], "to": span[1], "text": tr})
            if not entries:
                continue
            text = "\n".join(x for x in (b["prefix"], b["post"]) if x)
            lo, hi = min(e["from"] for e in entries), max(e["to"] for e in entries)
            prev = passages[-1] if passages else None
            if prev and lo <= prev["to"]:  # an ayah the site splits between two blocks stays with the first
                carried = [e for e in entries if e["to"] <= prev["to"]]
                prev["translations"] += carried
                entries = [e for e in entries if e not in carried]
                if not entries:
                    prev["text"] = "\n".join(x for x in (prev["text"], text) if x)
                    continue
                lo = prev["to"] + 1
            passages.append({"from": lo, "to": hi, "text": text, "translations": entries})
        for p in passages:  # one paragraph per ayah, a split ayah's pieces together
            merged = {}
            for e in p["translations"]:
                k = (e["from"], e["to"])
                merged[k] = " ".join(x for x in (merged.get(k), e["text"]) if x)
            p["translations"] = [{"from": a, "to": b, "text": t} for (a, b), t in sorted(merged.items())]
        write_json(DEST / f"{surah}.json", {"surah": surah, "passages": passages, "annex": annex})
        log(f"surah {surah}: {len(passages)} blocks" + (", annex" if annex else "") + (f", {unplaced} panels not placed by text" if unplaced else ""))


# ---- QA -------------------------------------------------------------------------------------------------------

MOJIBAKE = re.compile("\ufffd|à[´µ¦¥]|â€|Ã[\x80-\xbf]|Â[\x80-\xbf]")


def spans(nums):
    """[1, 2, 3, 7] -> "1-3, 7"."""
    out = []
    for n in sorted(nums):
        if out and n == out[-1][1] + 1:
            out[-1][1] = n
        else:
            out.append([n, n])
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in out)


def qa(args):
    ayah_counts = {s["number"]: s["numberOfAyahs"] for s in read_json(OUT / "thafheem" / "ml.thafheem.json")["surahs"]}
    files = sorted(DEST.glob("*.json"), key=lambda p: int(p.stem))
    assert files, "run build first"
    tot = {"ayahs": 0, "translated": 0, "commented": 0, "bad": 0}
    missing, problems = [], []
    log("surah | ayahs | translated | with commentary | blocks | annex | chars | Malayalam % | mojibake/markers")
    for f in files:
        d = read_json(f)
        s, n = d["surah"], ayah_counts[d["surah"]]
        every = set(range(1, n + 1))
        have = {i for p in d["passages"] for t in p["translations"] if t["text"] for i in range(t["from"], t["to"] + 1)}
        in_block = [i for p in d["passages"] for i in range(p["from"], p["to"] + 1)]
        commented = {i for p in d["passages"] if p["text"] for i in range(p["from"], p["to"] + 1)}
        if len(in_block) != len(set(in_block)) or set(in_block) != every:
            problems.append(f"{s}: blocks overlap or leave ayahs out (missing {spans(every - set(in_block))}; "
                            f"in two blocks {spans({i for i in in_block if in_block.count(i) > 1})})")
        if have != every:
            problems.append(f"{s}: no translation for {spans(every - have)}")
        text = "\n".join([p["text"] for p in d["passages"]] + [t["text"] for p in d["passages"] for t in p["translations"]]
                         + [d["annex"] or ""])
        ml = len(re.findall(r"[ഀ-ൿ]", text))
        letters = ml + len(re.findall(r"[؀-ۿ]|[A-Za-z]", text))
        bad = len(MOJIBAKE.findall(text)) + text.count("(*") + text.count("<")
        log(f"{s} | {n} | {len(have)} | {len(commented)} | {len(d['passages'])} | {'yes' if d['annex'] else '-'} | "
            f"{len(text):,} | {ml / max(letters, 1):.0%} | {bad}")
        tot["ayahs"] += n
        tot["translated"] += len(have)
        tot["commented"] += len(commented)
        tot["bad"] += bad
        if len(commented) < n:
            missing.append(f"{s}:{spans(every - commented)}")
    log(f"{len(files)} surahs; {tot['ayahs']} ayahs; translation {tot['translated']}, commentary {tot['commented']}; "
        f"mojibake/U+FFFD/stray markers: {tot['bad']}")
    log(f"{len(missing)} surahs with ayahs without commentary: " + "; ".join(missing))
    log("problems: " + ("none" if not problems else "\n  " + "\n  ".join(problems)))


def pack(d):
    """The R2 body in the format the Worker reads for our own tafsirs (lib/owntafsir.ts ownText): one entry per block
    of ayahs, {ayah, to?, text}: the block's translations, one paragraph per ayah "(153) ...", then its commentary
    paragraphs; the surah's annex, after a paragraph "അനുബന്ധം", goes on the last block."""
    entries = []
    for p in d["passages"]:
        lines = [f"({t['from'] if t['from'] == t['to'] else str(t['from']) + '-' + str(t['to'])}) {t['text']}"
                 for t in p["translations"] if t["text"]]
        entries.append({"ayah": p["from"], **({"to": p["to"]} if p["to"] != p["from"] else {}),
                        "text": "\n".join(lines + ([p["text"]] if p["text"] else []))})
    if d["annex"]:
        entries[-1]["text"] += "\nഅനുബന്ധം\n" + d["annex"]
    return {"surah": d["surah"], "ayahs": entries}


def upload(args):
    """out/amani/<n>.json -> R2 tafsir/ml.amani/v1/<n>.json (served by the Worker at /media/<key>)."""
    import concurrent.futures as cf

    from common import put_media

    files = sorted(DEST.glob("*.json"), key=lambda p: int(p.stem))
    assert [int(f.stem) for f in files] == list(range(1, 115)), "build all 114 surahs first (fetch all, build, qa)"
    sizes = []

    def one(f):
        body = json.dumps(pack(read_json(f)), ensure_ascii=False, separators=(",", ":")).encode()
        put_media(f"tafsir/ml.amani/v1/{f.stem}.json", body, "application/json")
        sizes.append(len(body))

    with cf.ThreadPoolExecutor(4) as ex:
        list(ex.map(one, files))
    log(f"{len(sizes)} files in R2 under tafsir/ml.amani/v1/, {sum(sizes) / 1e6:.1f} MB in all")


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:] or ["help"]
    {"fetch": fetch, "build": build, "qa": qa, "upload": upload}.get(cmd, lambda _: print(__doc__))(rest)
