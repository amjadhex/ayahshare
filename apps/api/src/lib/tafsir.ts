// Tafsir HTML laid out for reading, from what the source actually sends (Quran Foundation API, checked Oct 2026):
//  - English and other non-Arabic-script tafsirs (Ibn Kathir 169, Ma'arif 168, Bengali): a quoted ayah or hadith is a
//    paragraph of Arabic only; the paragraph after it often starts with its translation in parentheses, sometimes
//    followed by the reference, "(2:45)", and then more commentary. Headings are h1/h2.
//  - Arabic, Urdu and Kurdish tafsirs: ayahs quoted inside sentences (class "arabic qpc-hafs" / "arabic uthmani"),
//    references in class "reference", Urdu translations in class "text-translation", page numbers in class
//    "page-number"; Tabari ends with footnotes after a rule of dashes; Bengali footnotes start with "[১]".
//  - Plain-text tafsirs (Tanweer, Jalalayn, Rebar Kurdish): no markup; paragraphs end at a line break, ayahs are quoted
//    in ﴿ ﴾ (which some sources also put round a reference, "﴿النحل : 98﴾"), references are "[البقرة: ١٥٠]" (Qurtubi
//    and Tabari: also "[ ص: 95 ]" page numbers; Bengali: "[মুসলিমঃ ৮১০]"); Rebar's headings are lines in { }.
//  - Some tafsirs lost their paragraph breaks (Qurtubi, al-Wasit, Bayan ul Quran, Bengali Ibn Kathir: up to 78,000
//    characters in one paragraph); where a sentence ends with no space before the next one, that was a break.
// The text is never changed, added to or reordered: paragraphs are only grouped, split (at a line break, a lost break,
// or a translation's closing parenthesis), or marked with a class (contracts TafsirClass); the one thing dropped is the
// "٭٭" decoration after Urdu headings. sanitizeHtml runs first, so only basic formatting is left.
import type { TafsirClass } from "../../../../contracts/types";
import { decodeEntities, sanitizeHtml } from "./sanitize";

interface Text { text: string }
interface El { tag: string; lang?: string; dir?: string; cls: TafsirClass[]; kids: Node[] }
type Node = Text | El;

const isEl = (n: Node): n is El => "tag" in n;
const BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr"]);
const VOID = new Set(["br", "hr"]);
/** Tafsirs written in the Arabic script: their quotes stay inside the sentence. */
const ARABIC_SCRIPT = new Set(["ar", "ur", "fa", "ps", "ku", "sd", "ug"]);
const DIGITS = "(?:\\d+|[٠-٩]+|[۰-۹]+|[০-৯]+)";
const MARKER = new RegExp(`\\[${DIGITS}\\]`, "g");
const FOOTNOTE = new RegExp(`^\\[${DIGITS}\\]`);
const NUMBER_ONLY = new RegExp(`^[\\s(\\[]*${DIGITS}[\\s)\\]]*$`);
/** A reference after a quote's translation: "(2:45)", or bare, "47:17" (Ibn Kathir writes both). */
const AYAH_REF = /^\s*(?:\(\s*\d{1,3}\s*:\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?\s*\)|\d{1,3}\s*:\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?(?![\d:]))[.,;]?/;
const ARABIC_RUN = /\p{Script=Arabic}(?:[\p{Script=Arabic}\p{M}\s‌-‏]*[\p{Script=Arabic}\p{M}])?/gu;
/** An ayah quoted in ornate parentheses (either way round), and the same parentheses round a reference. */
const ORNATE = /[﴾﴿][^﴾﴿\n]{1,1500}[﴾﴿]/u;
const ORNATE_REF = new RegExp(`^[﴾﴿][^﴾﴿:]{1,40}:\\s*${DIGITS}[^﴾﴿]{0,20}[﴾﴿]$`, "u");
/** "[البقرة: ١٥٠]", "[ ص: 95 ]", "[মুসলিমঃ ৮১০]": square brackets round a name, a colon and a number. */
const BRACKET_REF = new RegExp(`\\[[^\\[\\]\\n]{1,80}?[:ঃ]\\s*${DIGITS}[^\\[\\]\\n]{0,60}\\]`, "u");
/** Where a sentence ends with no space before the next (Arabic or Bengali script): a lost paragraph break. Only after a
 *  letter or a closing bracket or quote (never after a digit: "1." numbers a point), only in tafsirs written in those
 *  scripts, and only in long paragraphs (LOST_BREAKS_FROM characters). */
const LOST_BREAK = /(?<=[\p{L}\p{M})\]»"”’] ?)(?:[.۔؟!](?=\p{Script=Arabic})|।(?=\p{Script=Bengali}))(?=\p{L})/gu;
const LOST_BREAKS_FROM = 600;

const el = (tag: string, kids: Node[], cls: TafsirClass[] = [], extra: Partial<El> = {}): El => ({ tag, cls, kids, ...extra });
const textOf = (n: Node | Node[]): string => (Array.isArray(n) ? n.map(textOf).join("") : isEl(n) ? textOf(n.kids) : n.text);
const hasText = (nodes: Node[]) => textOf(nodes).trim() !== "";

/** The sanitised HTML as a tree. Like a browser, a block element closes an open paragraph. */
function parse(html: string): El {
  const root = el("root", []);
  const stack: El[] = [root];
  let last = 0;
  const text = (raw: string) => { if (raw) stack[stack.length - 1].kids.push({ text: decodeEntities(raw) }); };
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)((?:\s[^<>]*)?)>/g)) {
    text(html.slice(last, m.index));
    last = m.index! + m[0].length;
    const tag = m[2];
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    if (BLOCK.has(tag)) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === "p") { stack.length = i; break; }
        if (BLOCK.has(stack[i].tag)) break;
      }
    }
    const node = el(tag, []);
    for (const a of m[3].matchAll(/([a-z]+)="([^"]*)"/g)) {
      if (a[1] === "lang") node.lang = a[2];
      else if (a[1] === "dir") node.dir = a[2];
      else if (a[1] === "class") node.cls = [a[2] as TafsirClass];
    }
    stack[stack.length - 1].kids.push(node);
    if (!VOID.has(tag)) stack.push(node);
  }
  text(html.slice(last));
  return root;
}

/** Top-level blocks: wrapper divs are opened up, loose text becomes a paragraph, headings become h3 / h4 (the sheet's
 *  own title is the h2). */
function blocks(kids: Node[], out: El[] = []): El[] {
  let run: Node[] = [];
  const flush = () => { if (hasText(run)) out.push(el("p", run)); run = []; };
  for (const n of kids) {
    if (!isEl(n) || !BLOCK.has(n.tag)) { run.push(n); continue; }
    flush();
    if (n.tag === "div") { if (n.cls.includes("rf-page")) out.push({ ...n, tag: "p" }); else blocks(n.kids, out); }
    else if (/^h[1-6]$/.test(n.tag)) out.push({ ...n, tag: n.tag === "h1" || n.tag === "h2" ? "h3" : "h4" });
    else if (n.tag === "li") out.push({ ...n, tag: "p" }); // outside a list
    else out.push(n);
  }
  flush();
  return out;
}

/** A paragraph cut at the given places in its own text (never inside its inline elements); empty pieces dropped. */
function cut(b: El, places: (text: string) => number[]): El[] {
  const out: El[] = [];
  let kids: Node[] = [];
  for (const n of b.kids) {
    if (isEl(n)) { kids.push(n); continue; }
    let last = 0;
    for (const i of places(n.text)) {
      kids.push({ text: n.text.slice(last, i) });
      out.push({ ...b, kids });
      kids = [];
      last = i;
    }
    kids.push({ text: n.text.slice(last) });
  }
  out.push({ ...b, kids });
  return out.filter((p) => hasText(p.kids));
}

/** Paragraphs split at line breaks in their text (plain-text tafsirs) and, with `lostBreaks`, long ones where a
 *  sentence ends with no space before the next (see LOST_BREAK). */
function paragraphs(list: El[], lostBreaks: boolean): El[] {
  return list.flatMap((b) => {
    if (b.tag !== "p" || b.cls.length) return [b];
    const lines = cut(b, (s) => [...s.matchAll(/\n/g)].map((m) => m.index!));
    return lostBreaks
      ? lines.flatMap((p) => (textOf(p).length >= LOST_BREAKS_FROM ? cut(p, (s) => [...s.matchAll(LOST_BREAK)].map((m) => m.index! + m[0].length)) : [p]))
      : lines;
  });
}

/** Mostly Arabic letters (an ayah or hadith quoted as its own paragraph). */
function isArabic(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  const arabic = letters.filter((ch) => /\p{Script=Arabic}/u.test(ch)).length;
  return arabic >= 3 && letters.length - arabic <= arabic * 0.1;
}

/** "(translation) more text" → the part up to the matching ")" and the rest; null when the paragraph does not start
 *  with "(" or the ")" is not in plain text. */
function splitParen(kids: Node[]): { head: Node[]; tail: Node[] } | null {
  let depth = 0;
  for (let k = 0; k < kids.length; k++) {
    const n = kids[k];
    if (isEl(n)) {
      if (!depth) return null;
      for (const ch of textOf(n)) if (ch === "(") depth++; else if (ch === ")" && --depth <= 0) return null;
      continue;
    }
    for (let i = 0; i < n.text.length; i++) {
      const ch = n.text[i];
      if (!depth) {
        if (/\s/.test(ch)) continue;
        if (ch !== "(") return null;
        depth = 1;
      } else if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) {
        return { head: [...kids.slice(0, k), { text: n.text.slice(0, i + 1) }], tail: [{ text: n.text.slice(i + 1) }, ...kids.slice(k + 1)] };
      }
    }
  }
  return null;
}

/** An Arabic paragraph as a quote card, with the translation that follows it when it is in parentheses (and the
 *  reference after it). Returns the card and what is left of the next paragraph (null = nothing left; undefined = the
 *  next paragraph was not used). */
function quote(arabic: El, next: El | undefined): [El, El | null | undefined] {
  const card = el("div", [el("p", arabic.kids, ["rf-ar"], { lang: "ar", dir: "rtl" })], ["rf-q"]);
  if (next?.tag !== "p" || next.cls.length || isArabic(textOf(next))) return [card, undefined];
  const split = splitParen(next.kids);
  const head = split && textOf(split.head);
  if (!split || !head || NUMBER_ONLY.test(head) || !/\p{L}{2,}\s+\p{L}{2,}/u.test(head)) return [card, undefined];
  card.kids.push(el("p", split.head, ["rf-tr"]));
  let tail = split.tail;
  const first = tail[0] as Text;
  const ref = first.text.match(AYAH_REF);
  if (ref) {
    card.kids.push(el("p", [{ text: ref[0].trim() }], ["rf-ref"]));
    tail = [{ text: first.text.slice(ref[0].length) }, ...tail.slice(1)];
  }
  return [card, hasText(tail) ? { ...next, kids: tail } : null];
}

/** Paragraph-level layout: quote cards, headings the source wrote as bold or "… ٭٭" lines, rules, footnotes. */
function layout(list: El[], arabicScript: boolean): El[] {
  const out: El[] = [];
  let notes = false;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.tag !== "p" || b.cls.includes("rf-page")) { out.push(b); continue; }
    const text = textOf(b).trim();
    if (!text) continue;
    const rule = /^[-_ـ=–—]{5,}$/.test(text);
    if (rule || /^(?:[*٭]\s*){3,}$/.test(text)) {
      if (out.at(-1)?.tag !== "hr") out.push(el("hr", []));
      notes ||= rule;
      continue;
    }
    if (/^الهوامش\s*:?$/.test(text)) notes = true;
    if (notes || FOOTNOTE.test(text)) { out.push({ ...b, cls: ["rf-fn"] }); continue; }
    const content = b.kids.filter((n) => isEl(n) || n.text.trim());
    const bold = content[0];
    if (bold && isEl(bold) && (bold.tag === "b" || bold.tag === "strong") && textOf(bold).trim().length <= 150) {
      if (content.length === 1) { out.push(el("h4", bold.kids)); continue; }
      if (textOf(bold).trim().split(/\s+/).length >= 3) {
        out.push(el("h4", bold.kids), { ...b, kids: b.kids.slice(b.kids.indexOf(bold) + 1) });
        continue;
      }
    }
    if (/^\{[^{}]{1,150}\}$/.test(text)) { out.push(el("h4", b.kids)); continue; } // Rebar Kurdish: a heading in { }
    if (/٭٭\s*$/.test(text) && text.length <= 150) {
      const kids = [...b.kids];
      let k = kids.length - 1;
      while (k >= 0 && (isEl(kids[k]) || !(kids[k] as Text).text.trim())) k--;
      if (k >= 0) kids[k] = { text: (kids[k] as Text).text.replace(/[\s٭]+$/, "") };
      out.push(el("h3", kids));
      continue;
    }
    if (!arabicScript && isArabic(text)) {
      const [card, rest] = quote(b, list[i + 1]);
      out.push(card);
      if (rest === null) i++;
      else if (rest) list[i + 1] = rest;
      continue;
    }
    out.push(b);
  }
  return out;
}

/** A match of inline()'s pattern as an element: a marker, an ayah in ﴿ ﴾, a reference, or Arabic words. */
function mark(s: string, wrapArabic: boolean): El {
  const rtl = wrapArabic ? { lang: "ar", dir: "rtl" } : {};
  if (new RegExp(`^${MARKER.source}$`).test(s)) return el("span", [{ text: s }], ["rf-mark"]);
  if (/^[﴾﴿]/.test(s)) return ORNATE_REF.test(s) ? el("span", [{ text: s }], ["rf-ref"], rtl) : el("span", [{ text: s }], ["rf-aya"], { lang: "ar", ...rtl });
  if (s.startsWith("[")) return el("span", [{ text: s }], ["rf-ref"], /\p{Script=Arabic}/u.test(s) ? rtl : {});
  return el("span", [{ text: s }], [], { lang: "ar", dir: "rtl" });
}

/** Inside a paragraph: footnote and ayah-number markers, ayahs quoted inline (marked by the source, or in ﴿ ﴾),
 *  references in square brackets, and (in non-Arabic-script tafsirs) Arabic words marked as Arabic so they get an Arabic
 *  font. Nothing is marked inside a quote or reference the source marked. Plain spans are opened up. */
function inline(nodes: Node[], wrapArabic: boolean, quotes = true): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (isEl(n)) {
      if (n.cls.includes("rf-aya") && NUMBER_ONLY.test(textOf(n))) { out.push(el("span", n.kids, ["rf-mark"])); continue; }
      const kids = inline(n.kids, wrapArabic && n.lang !== "ar" && !n.cls.includes("rf-ar"), quotes && !n.cls.some((c) => c === "rf-aya" || c === "rf-ref"));
      if (n.tag === "span" && !n.lang && !n.dir && !n.cls.length) out.push(...kids);
      else out.push({ ...n, kids });
      continue;
    }
    const sources = [MARKER.source, ...(quotes ? [ORNATE.source, BRACKET_REF.source] : []), ...(wrapArabic ? [ARABIC_RUN.source] : [])];
    let last = 0;
    for (const m of n.text.matchAll(new RegExp(sources.join("|"), "gu"))) {
      if (m.index! > last) out.push({ text: n.text.slice(last, m.index) });
      out.push(mark(m[0], wrapArabic));
      last = m.index! + m[0].length;
    }
    if (last < n.text.length) out.push({ text: n.text.slice(last) });
  }
  return out;
}

/** Leading and trailing white space of a block removed (inside its first and last text). */
function trim(b: El): El {
  const kids = [...b.kids];
  if (kids.length && !isEl(kids[0])) kids[0] = { text: kids[0].text.replace(/^\s+/, "") };
  const end = kids.length - 1;
  if (end >= 0 && !isEl(kids[end])) kids[end] = { text: (kids[end] as Text).text.replace(/\s+$/, "") };
  return { ...b, kids: kids.map((k) => (isEl(k) && k.tag === "p" ? trim(k) : k)).filter((k) => isEl(k) || k.text) };
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function serialise(n: Node): string {
  if (!isEl(n)) return escape(n.text);
  const attrs = (n.lang ? ` lang="${n.lang}"` : "") + (n.dir ? ` dir="${n.dir}"` : "") + (n.cls.length ? ` class="${n.cls.join(" ")}"` : "");
  return VOID.has(n.tag) ? `<${n.tag}${attrs}>` : `<${n.tag}${attrs}>${n.kids.map(serialise).join("")}</${n.tag}>`;
}

/** The source's tafsir HTML, sanitised and laid out (see the top of this file). `lang`: the tafsir's language. */
export function formatTafsir(raw: string, lang: string): string {
  const arabicScript = ARABIC_SCRIPT.has(lang);
  const list = layout(paragraphs(blocks(parse(sanitizeHtml(raw)).kids), arabicScript || lang === "bn"), arabicScript);
  return list.map((b) => serialise(trim({ ...b, kids: b.cls.includes("rf-q") ? b.kids.map((k) => (isEl(k) && k.cls.includes("rf-tr") ? { ...k, kids: inline(k.kids, !arabicScript) } : k)) : inline(b.kids, !arabicScript) }))).join("");
}
