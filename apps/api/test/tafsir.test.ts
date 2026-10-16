// The tafsir layout (src/lib/tafsir.ts) on HTML shaped like the Quran Foundation's tafsirs (Ibn Kathir in English, an
// Arabic and an Urdu tafsir, Tabari's footnotes, Bengali footnotes, ornate parentheses, lost paragraph breaks). The
// Arabic in those is placeholder text (abjad letters) and the English is made up: the layout must only group, split and
// mark what the source sent. The last block runs on real answers of the API (fixtures/tafsir, fetched, never typed).
import { describe, expect, it } from "vitest";
import { decodeEntities, sanitizeHtml } from "../src/lib/sanitize";
import { formatTafsir } from "../src/lib/tafsir";
import zakaria from "./fixtures/tafsir/166-18-10.json";
import saadiRu from "./fixtures/tafsir/170-94-5.json";
import rebar from "./fixtures/tafsir/804-112-1.json";
import wasit from "./fixtures/tafsir/93-94-5.json";
import tanweer from "./fixtures/tafsir/925-94-5.json";

const AR = "ابجد هوز حطي كلمن";
const AR2 = "سعفص قرشت ثخذ ضظغ";
/** The text of some HTML, as a reader sees it. */
const text = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, "");
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
/** The text of each block, in order. */
const blockTexts = (html: string) => html.split(/<\/(?:p|h3|h4|div)>/).map((s) => decodeEntities(s.replace(/<[^>]+>/g, "")).trim()).filter(Boolean);

describe("English tafsir (Ibn Kathir's shape)", () => {
  const SOURCE = `<h1><span style="color: rgb(1,2,3);">Introduction</span></h1><h2>A Section</h2><p>The text says:</p>`
    + `<p>${AR}</p><p>(Placeholder translation of the quote (with a gloss) here) (2:45)</p>`
    + `<p>Commentary.</p><p>${AR2}</p><p>(Short placeholder line,) indicates more commentary.</p>`
    + `<p>«${AR}»</p><p>A plain line after a quote.</p><p>${AR2}</p><p>(1)</p>`
    + `<p>The Prophet <strong style="color: red">ﷺ</strong> said, (${AR2}) here.</p>`;

  it("quotes become cards with their translation and reference; headings h3; the rest stays as it was", () => {
    const html = formatTafsir(SOURCE, "en");
    expect(html).toBe(
      "<h3>Introduction</h3><h3>A Section</h3><p>The text says:</p>"
      + `<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">${AR}</p><p class="rf-tr">(Placeholder translation of the quote (with a gloss) here)</p><p class="rf-ref">(2:45)</p></div>`
      + "<p>Commentary.</p>"
      + `<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">${AR2}</p><p class="rf-tr">(Short placeholder line,)</p></div><p>indicates more commentary.</p>`
      + `<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">«${AR}»</p></div><p>A plain line after a quote.</p>`
      + `<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">${AR2}</p></div><p>(1)</p>`
      + `<p>The Prophet <strong><span lang="ar" dir="rtl">ﷺ</span></strong> said, (<span lang="ar" dir="rtl">${AR2}</span>) here.</p>`,
    );
  });

  it("never changes the text: every character the source sent is still there, in order", () => {
    expect(text(formatTafsir(SOURCE, "en"))).toBe(text(SOURCE));
  });

  it("does not split a translation whose closing parenthesis is inside other markup, or that never closes", () => {
    const html = formatTafsir(`<p>${AR}</p><p>(Open <b>bold) text</b> rest</p><p>${AR2}</p><p>(Never closes</p>`, "en");
    expect(html).toBe(`<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">${AR}</p></div><p>(Open <b>bold) text</b> rest</p>`
      + `<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">${AR2}</p></div><p>(Never closes</p>`);
  });

  it("a reference followed by more text: the text goes on as its own paragraph", () => {
    expect(formatTafsir(`<p>${AR}</p><p>(Some placeholder words.) (6:125) And then more.</p>`, "en")).toBe(
      `<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">${AR}</p><p class="rf-tr">(Some placeholder words.)</p><p class="rf-ref">(6:125)</p></div><p>And then more.</p>`);
    // Ibn Kathir also writes the reference bare.
    expect(formatTafsir(`<p>${AR}</p><p>(Some placeholder words.) 9:124, and more.</p><p>${AR2}</p><p>(Other words here.) 47:17</p>`, "en")).toBe(
      `<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">${AR}</p><p class="rf-tr">(Some placeholder words.)</p><p class="rf-ref">9:124,</p></div><p>and more.</p>`
      + `<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">${AR2}</p><p class="rf-tr">(Other words here.)</p><p class="rf-ref">47:17</p></div>`);
  });
});

describe("Arabic-script tafsirs", () => {
  it("Arabic: quotes inside the sentence stay there, marked; colours dropped; Tabari's footnotes after the rule", () => {
    const source = `<p lang="ar" class="ar ">${AR} <span class="blue">${AR2}</span> <span class="arabic qpc-hafs">( ${AR} )</span> <span class="reference brown">[ ${AR2} : 45 ]</span> .</p>`
      + `<p>* * *</p><p>${AR} <span class="arabic qpc-hafs green">(61)</span></p><p>---------------------------</p><p>الهوامش  :</p>`
      + `<p lang="ar" class="ar "><span class="arabic qpc-hafs green">(61)</span> ${AR2}</p>`;
    expect(formatTafsir(source, "ar")).toBe(
      `<p lang="ar">${AR} ${AR2} <span lang="ar" class="rf-aya">( ${AR} )</span> <span class="rf-ref">[ ${AR2} : 45 ]</span> .</p>`
      + `<hr><p>${AR} <span class="rf-mark">(61)</span></p><hr><p class="rf-fn">الهوامش  :</p>`
      + `<p lang="ar" class="rf-fn"><span class="rf-mark">(61)</span> ${AR2}</p>`,
    );
  });

  it("Urdu: a heading line ending in ٭٭, wrapper divs opened, page numbers and inline translations marked", () => {
    const source = `${AR} ٭٭<div lang="ur" class="ur"><p>${AR2} <span class="text-translation">” ${AR} “</span> <span class="saw"> ${AR2} </span></p></div>`
      + `<div class="ur page-number">${AR}574</div>`;
    expect(formatTafsir(source, "ur")).toBe(
      `<h3>${AR}</h3><p>${AR2} <span class="rf-tr">” ${AR} “</span>  ${AR2}</p><p class="rf-page">${AR}574</p>`);
  });
});

describe("Bengali tafsirs", () => {
  it("bold lines become headings; [১] markers and footnote paragraphs are marked", () => {
    const source = "<p><p>Text one [১] more [২]</p><p><b> A bold heading line </b></p><p><b>Three word heading</b>Text after it.</p>"
      + "<p>[১] First footnote.</p><p>[২] Second footnote.</p>";
    expect(formatTafsir(source, "bn")).toBe(
      '<p>Text one <span class="rf-mark">[১]</span> more <span class="rf-mark">[২]</span></p><h4>A bold heading line</h4>'
      + "<h4>Three word heading</h4><p>Text after it.</p>"
      + '<p class="rf-fn"><span class="rf-mark">[১]</span> First footnote.</p><p class="rf-fn"><span class="rf-mark">[২]</span> Second footnote.</p>');
  });
});

describe("plain-text tafsirs: ornate parentheses, references, line breaks, lost breaks", () => {
  it("an ayah in ﴿ ﴾ (either way round) is a quote; the same parentheses round a reference make a reference", () => {
    expect(formatTafsir(`<p>The text says: ﴾${AR}﴿ and ﴿${AR2} : 98﴾ here [ ${AR2} : 45 ].</p>`, "en")).toBe(
      `<p>The text says: <span lang="ar" dir="rtl" class="rf-aya">﴾${AR}﴿</span> and <span lang="ar" dir="rtl" class="rf-ref">﴿${AR2} : 98﴾</span>`
      + ` here <span lang="ar" dir="rtl" class="rf-ref">[ ${AR2} : 45 ]</span>.</p>`);
    // Inside a quote or reference the source marked, nothing more is marked.
    expect(formatTafsir(`<p>${AR} <span class="arabic qpc-hafs">﴿${AR2}﴾</span> <span class="reference">[${AR}: ٤٥]</span></p>`, "ar")).toBe(
      `<p>${AR} <span lang="ar" class="rf-aya">﴿${AR2}﴾</span> <span class="rf-ref">[${AR}: ٤٥]</span></p>`);
  });

  it("a line break ends a paragraph; a line in { } is a heading", () => {
    expect(formatTafsir(`{${AR}}\n${AR2} .\n\n${AR}`, "ku")).toBe(`<h4>{${AR}}</h4><p>${AR2} .</p><p>${AR}</p>`);
  });

  it("long Arabic-script and Bengali paragraphs are split where a sentence ends with no space before the next", () => {
    const long = `${AR} `.repeat(40).trim();
    expect(blockTexts(formatTafsir(`<p>${long}.${AR2} ${long} 1.${AR2} ( ${AR} ) .${long}</p>`, "ar")))
      .toEqual([`${long}.`, `${AR2} ${long} 1.${AR2} ( ${AR} ) .`, long]); // never after a digit
    const bn = "অআ ইঈ উঊ ".repeat(80).trim();
    expect(blockTexts(formatTafsir(`<p>${bn}।এঐ ওঔ</p>`, "bn"))).toEqual([`${bn}।`, "এঐ ওঔ"]);
    // Short paragraphs, and tafsirs in other scripts, are left as they are.
    expect(blockTexts(formatTafsir(`<p>${AR}.${AR2}</p>`, "ar"))).toEqual([`${AR}.${AR2}`]);
    expect(count(formatTafsir(`<p>Words ${long}.${AR2} more words</p>`, "en"), /<p[ >]/g)).toBe(1);
  });
});

describe("the Quran Foundation's own markup (fixtures fetched from the API, Oct 2026)", () => {
  const source = (f: { tafsir: { text: string } }) => f.tafsir.text;
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

  it("never changes the text: every character the source sent is still there, in order", () => {
    for (const [f, lang] of [[tanweer, "ar"], [rebar, "ku"], [wasit, "ar"], [zakaria, "bn"], [saadiRu, "ru"]] as const) {
      expect(text(formatTafsir(source(f), lang)), f.tafsir.resource_name).toBe(text(sanitizeHtml(source(f))));
    }
  });

  it("Tanweer (plain text): a paragraph per line, every ﴿ ﴾ quote and [surah: n] reference marked", () => {
    const raw = source(tanweer), html = formatTafsir(raw, "ar");
    expect(count(html, /<p>/g)).toBe(lines(raw).length);
    expect(count(html, /<span lang="ar" class="rf-aya">﴿[^<]+﴾<\/span>/g)).toBe(count(raw, /﴿/g));
    expect(count(html, /<span class="rf-ref">\[[^<\]]+: [٠-٩]+\]<\/span>/g)).toBe(count(raw, /\[[^\]]+: [٠-٩]+\]/g));
    expect(html.startsWith('<p><span lang="ar" class="rf-aya">﴿')).toBe(true);
  });

  it("Rebar Kurdish: lines in { } are headings, the other lines paragraphs; its quotes stay in the sentence", () => {
    const raw = source(rebar), html = formatTafsir(raw, "ku");
    const headings = lines(raw.replace(/<[^>]+>/g, "")).filter((l) => /^\{[^{}]+\}$/.test(l));
    expect(headings.length).toBeGreaterThan(0);
    expect(html.match(/<h4>.*?<\/h4>/g)!.map((h) => h.replace(/<[^>]+>/g, ""))).toEqual(headings);
    expect(count(html, /<(?:p|h4)>/g)).toBe(lines(raw).length);
    expect(count(html, /<p>[^]*?<span lang="ar" class="rf-aya">/g)).toBeGreaterThan(0);
    expect(html).not.toMatch(/rf-q/);
  });

  it("al-Wasit (one paragraph in the source): split at its lost breaks, each piece ending a sentence", () => {
    const raw = source(wasit), html = formatTafsir(raw, "ar");
    expect(count(raw, /<p|\n/g)).toBe(0);
    const pieces = blockTexts(html);
    expect(pieces.length).toBeGreaterThan(5);
    for (const p of pieces.slice(0, -1)) expect(p).toMatch(/[\p{L}\p{M})\]»"”] ?[.۔؟!]$/u);
  });

  it("Bengali (Abu Bakr Zakaria): footnote, the Arabic du'a as a quote, the [book: n] reference marked", () => {
    const html = formatTafsir(source(zakaria), "bn");
    expect(html).toMatch(/<p class="rf-fn"><span class="rf-mark">\[১\]<\/span>/);
    expect(html).toMatch(/<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">[^<]+<\/p><\/div>/);
    expect(html).toMatch(/<span class="rf-ref">\[[^<\]]+: [০-৯/]+\]<\/span>/);
  });

  it("Russian al-Sa'di (plain text, one passage): one paragraph, nothing marked", () => {
    const html = formatTafsir(source(saadiRu), "ru");
    expect(count(html, /<p>/g)).toBe(1);
    expect(html).not.toMatch(/class=|lang=/);
  });
});

describe("safety", () => {
  it("stays sanitised: no attributes but lang, dir and our classes; text escaped", () => {
    const html = formatTafsir(`<p onclick="x()" class="rf-q">a &lt;b&gt; &amp; c<img src=x onerror=alert(1)></p><script>alert(2)</script><p>${AR}</p>`
      + `<p>(&lt;script&gt;alert(3)&lt;/script&gt; words here)</p>`, "en");
    expect(html).toBe(`<p>a &lt;b&gt; &amp; c</p><div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">${AR}</p><p class="rf-tr">(&lt;script&gt;alert(3)&lt;/script&gt; words here)</p></div>`);
    expect(formatTafsir("", "en")).toBe("");
    expect(formatTafsir("Plain text only.", "ru")).toBe("<p>Plain text only.</p>");
  });
});
