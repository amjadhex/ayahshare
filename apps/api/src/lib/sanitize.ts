// Text from the Quran Foundation API, made safe to show: tafsir HTML keeps basic formatting only, reflections become
// plain text. The web app sanitises the tafsir again in the browser before showing it (defence in depth).
import type { TafsirClass } from "../../../../contracts/types";

const ALLOWED = new Set(["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "b", "strong", "i", "em", "u", "ul", "ol", "li", "blockquote", "sup", "sub", "span", "div", "hr"]);
const VOID = new Set(["br", "hr"]);
/** Elements dropped together with everything inside them. */
const DROP = /<(script|style|iframe|object|embed|noscript|template|svg|math|textarea|select|button|form|head|title)\b[\s\S]*?<\/\1\s*>/gi;
const LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
/** The source's own classes that carry meaning, as ours (contracts TafsirClass). Every other class is dropped. */
const SOURCE_CLASSES: [RegExp, TafsirClass][] = [
  [/\barabic\b/i, "rf-aya"], // a quoted ayah ("arabic qpc-hafs", "arabic uthmani")
  [/\breference\b/i, "rf-ref"],
  [/\btext-translation\b/i, "rf-tr"],
  [/\bpage-number\b/i, "rf-page"],
];

function attributes(raw: string): string {
  const out: string[] = [];
  let lang: string | null = null, dir: string | null = null, cls: TafsirClass | null = null;
  for (const m of raw.matchAll(/([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const name = m[1].toLowerCase(), value = (m[3] ?? m[4] ?? m[5] ?? "").trim();
    if (name === "lang" && LANG.test(value)) lang = value.toLowerCase();
    else if (name === "dir" && /^(ltr|rtl|auto)$/i.test(value)) dir = value.toLowerCase();
    else if (name === "class") {
      cls = SOURCE_CLASSES.find(([re]) => re.test(value))?.[1] ?? null;
      // The source marks Arabic quotations with a class; keep that as a language so the app can use an Arabic font.
      if (/\barabic\b/i.test(value) && !lang) lang = "ar";
    }
  }
  if (lang) out.push(` lang="${lang}"`);
  if (dir) out.push(` dir="${dir}"`);
  if (cls) out.push(` class="${cls}"`);
  return out.join("");
}

/** Keeps only basic formatting tags (no attributes but lang, dir and a class from TafsirClass; no links, images,
 *  scripts or styles). Text is left as it is; a "<" that does not start an allowed tag is escaped. */
export function sanitizeHtml(html: string): string {
  const s = html.replace(/<!--[\s\S]*?-->/g, "").replace(DROP, "");
  let out = "";
  let last = 0;
  for (const m of s.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s[^<>]*)?)\/?>/g)) {
    out += escapeText(s.slice(last, m.index));
    last = m.index! + m[0].length;
    const tag = m[2].toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    if (m[1]) { if (!VOID.has(tag)) out += `</${tag}>`; continue; }
    out += `<${tag}${VOID.has(tag) ? "" : attributes(m[3])}>`;
  }
  return (out + escapeText(s.slice(last))).trim();
}

/** Stray "<" and ">" in text (entities such as &amp; are already escaped and stay as they are). */
const escapeText = (text: string) => text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Common named entities and every numeric one decoded; unknown names stay as they are. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Plain text: tags removed (a block tag becomes a line break), common entities decoded, line breaks kept (at most one
 *  empty line in a row), capped at `max` characters. The app shows it as text, never as HTML. */
export function plainText(input: string, max = 6000): string {
  let s = input.replace(/<!--[\s\S]*?-->/g, "").replace(DROP, "");
  s = s.replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  s = s.replace(/\r\n?/g, "\n").replace(/[ \t\u00a0]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}
