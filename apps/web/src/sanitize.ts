// Tafsir HTML, cleaned again in the browser before it is shown (the Worker already sanitises it): only basic formatting
// elements survive, with no attributes but lang, dir and the Worker's layout classes (contracts TafsirClass). Uses the
// browser's own HTML parser. Framework-free.
import type { TafsirClass } from "../../../contracts/types";

const ALLOWED = new Set(["P", "BR", "H2", "H3", "H4", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "BLOCKQUOTE", "SUP", "SUB", "SPAN", "DIV", "HR"]);
const LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
/** Every TafsirClass, and nothing else (the type makes this list match the contract). */
const CLASSES: Record<TafsirClass, true> = { "rf-q": true, "rf-ar": true, "rf-tr": true, "rf-ref": true, "rf-aya": true, "rf-fn": true, "rf-mark": true, "rf-page": true };

/** Safe HTML: disallowed elements are replaced by their text (scripts, styles and the like are dropped whole). */
export function safeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.createElement("div");
  const copy = (from: Node, to: Node) => {
    for (const node of [...from.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) { to.appendChild(document.createTextNode(node.textContent ?? "")); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|IFRAME|OBJECT|EMBED|SVG|MATH|TEXTAREA|SELECT|BUTTON|FORM)$/i.test(el.tagName)) continue;
      if (!ALLOWED.has(el.tagName)) { copy(el, to); continue; }
      const clean = document.createElement(el.tagName.toLowerCase());
      const lang = el.getAttribute("lang"), dir = el.getAttribute("dir");
      if (lang && LANG.test(lang)) clean.setAttribute("lang", lang);
      if (dir && /^(ltr|rtl|auto)$/i.test(dir)) clean.setAttribute("dir", dir.toLowerCase());
      const classes = [...el.classList].filter((c) => Object.hasOwn(CLASSES, c));
      if (classes.length) clean.className = classes.join(" ");
      copy(el, clean);
      to.appendChild(clean);
    }
  };
  copy(doc.body, out);
  return out.innerHTML;
}
