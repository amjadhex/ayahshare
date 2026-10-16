// Long ayahs in parts (owner, 8 Oct 2026): "For long ayahs, everything doesn't have to be on one screen. A part of the
// ayah comes with its meaning, then the next part replaces it." This module only cuts text; draw.ts decides which
// ayahs are long (from the layout) and how many parts they need, compose.ts gives each part its share of the
// recitation. Framework-free and DOM-free.
//
// The Quran text is never altered: an ayah is cut only at the mushaf's own pause marks (waqf signs) in the Uthmani text,
// and its parts, in order, are the whole ayah, every character kept (only the space at each cut is not drawn). The
// translation is cut into as many parts, at the end of a sentence or clause, where its length best matches the Arabic
// parts; when it has no such place close enough, every part shows the whole translation (never a guess that pairs the
// Arabic with the wrong meaning). Nothing is translated or rewritten.

/** The pause marks an ayah may be cut after. In the app's Arabic (alquran.cloud quran-uthmani) each one stands alone,
 *  after the word it follows: ۘ (U+06D8, a necessary stop), ۗ (U+06D7, stopping is better), ۚ (U+06DA, stopping is
 *  allowed) and ۖ (U+06D6, going on is better, stopping is allowed). Never at ۙ (U+06D9: do not stop), ۛ (U+06DB: a pair,
 *  stop at only one of the two) or ۜ (U+06DC: a short pause without a breath). */
const PAUSE = /[ۖۗۘۚ]/;

/** Sentence and clause punctuation a translation may be cut after (Latin, Arabic script, Indic, Ethiopic, CJK). */
const CLAUSE = new Set([..."..,;:!?،؛؟۔।॥።፣፤。，、；：！？"]);
/** Of those, the ones that need no space after them (scripts written without spaces). */
const WIDE = new Set([..."。，、；：！？"]);
/** Closing quotes and brackets that stay with the punctuation before them. */
const CLOSERS = new Set([..."\"'”’»›」』)]）】"]);
const OPEN = new Set([..."([{（【"]), SHUT = new Set([...")]}）】"]);

/** How far (a fraction of the translation's length) a translation cut may be from where the Arabic parts put it. */
export const TRANSLATION_TOLERANCE = 0.12;

/** Letters and digits: the length measure for balancing parts and sharing the recitation (vowel marks and pause signs
 *  are not counted). */
export const letters = (s: string) => s.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

const space = (c: string | undefined) => c !== undefined && /\s/.test(c);

/** Where a new part may start: the index of the first letter after each pause mark that stands before more text. */
export function pauseCuts(ar: string): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < ar.length; i++) {
    if (!PAUSE.test(ar[i]) || !space(ar[i + 1])) continue;
    let j = i + 1;
    while (space(ar[j])) j++;
    if (j < ar.length && letters(ar.slice(0, i))) cuts.push(j);
  }
  return cuts;
}

/** Where a translation may be cut: the index of the first character after clause punctuation (and any closing quote
 *  or bracket after it), outside brackets, followed by a space (or a wide punctuation mark), with more text after. */
export function clauseCuts(tr: string): number[] {
  const cuts: number[] = [];
  let depth = 0;
  for (let i = 0; i < tr.length; i++) {
    const c = tr[i];
    if (OPEN.has(c)) depth++;
    else if (SHUT.has(c)) depth = Math.max(0, depth - 1);
    if (depth || !CLAUSE.has(c)) continue;
    let j = i + 1;
    while (j < tr.length && CLOSERS.has(tr[j]) && !OPEN.has(tr[j])) j++;
    if (!space(tr[j]) && !WIDE.has(c)) continue; // "2:255", "i.e" and the like: not a clause end
    while (space(tr[j])) j++;
    if (j < tr.length && letters(tr.slice(j)) && letters(tr.slice(0, j))) cuts.push(j);
  }
  return [...new Set(cuts)];
}

/** Picks `n` of the positions `at` (increasing, in letters) so that position j is as close as possible to target[j]
 *  (least squares). Returns their indices into `at`, or null when there are fewer than `n`. */
function closest(at: number[], targets: number[]): number[] | null {
  const n = targets.length, m = at.length;
  if (m < n) return null;
  // best[j][i]: least cost with the first j+1 targets matched and target j at position i.
  const best = targets.map(() => new Array<number>(m).fill(Infinity)), from = targets.map(() => new Array<number>(m).fill(-1));
  for (let j = 0; j < n; j++) {
    for (let i = j; i < m - (n - 1 - j); i++) {
      const own = (at[i] - targets[j]) ** 2;
      if (j === 0) { best[0][i] = own; continue; }
      for (let p = j - 1; p < i; p++) {
        const c = best[j - 1][p] + own;
        if (c < best[j][i]) { best[j][i] = c; from[j][i] = p; }
      }
    }
  }
  let i = -1;
  for (let k = 0; k < m; k++) if (best[n - 1][k] < (i < 0 ? Infinity : best[n - 1][i])) i = k;
  if (i < 0) return null;
  const picked = [i];
  for (let j = n - 1; j > 0; j--) picked.unshift((i = from[j][i]));
  return picked;
}

const pieces = (text: string, cuts: number[]) =>
  [0, ...cuts].map((from, j) => text.slice(from, cuts[j] ?? text.length).trim());

/** The ayah's Arabic in `n` parts, cut at pause marks so that the parts are as even as possible (in letters), and where
 *  each part starts as a fraction of the whole (by letters; [0, ...]). null when it has fewer than n - 1 pause marks. */
export function splitArabic(ar: string, n: number): { parts: string[]; starts: number[] } | null {
  if (n < 2) return { parts: [ar], starts: [0] };
  const cuts = pauseCuts(ar), total = letters(ar);
  if (cuts.length < n - 1 || !total) return null;
  // Even parts: the cuts closest to 1/n, 2/n, … of the letters. Least squares on the cut positions keeps every part
  // close to an n-th, and never leaves a tiny part between two close marks when a better pair exists.
  const at = cuts.map((c) => letters(ar.slice(0, c)));
  const picked = closest(at, Array.from({ length: n - 1 }, (_, j) => ((j + 1) * total) / n));
  if (!picked) return null;
  return { parts: pieces(ar, picked.map((i) => cuts[i])), starts: [0, ...picked.map((i) => at[i] / total)] };
}

/** The translation in as many parts as the Arabic (`starts`: where each Arabic part starts, as a fraction), cut at
 *  clause ends closest to the same fractions of its own length. null when it cannot be cut sensibly: too few clause
 *  ends, or one of them further than TRANSLATION_TOLERANCE from where it should be. */
export function splitTranslation(tr: string, starts: number[]): string[] | null {
  const n = starts.length;
  if (n < 2) return [tr];
  const cuts = clauseCuts(tr), total = letters(tr);
  if (!total) return null;
  const at = cuts.map((c) => letters(tr.slice(0, c)));
  const targets = starts.slice(1).map((f) => f * total);
  const picked = closest(at, targets);
  if (!picked || picked.some((i, j) => Math.abs(at[i] - targets[j]) > TRANSLATION_TOLERANCE * total)) return null;
  return pieces(tr, picked.map((i) => cuts[i]));
}

/** One screen of the text block: a whole ayah, or one part of a long one. `tr` is "" without a translation. */
export interface Section { ar: string; tr: string }

/** A long ayah in `n` parts: its Arabic at pause marks, its translation to match (or whole with every part when it
 *  cannot be cut sensibly), and where each part starts in the ayah's recitation (fractions, [0, ...]). null when the
 *  Arabic has too few pause marks. */
export function splitAyah(ar: string, tr: string, n: number): { sections: Section[]; starts: number[]; trSplit: boolean } | null {
  const a = splitArabic(ar, n);
  if (!a) return null;
  const t = tr ? splitTranslation(tr, a.starts) : null;
  return { sections: a.parts.map((p, j) => ({ ar: p, tr: t ? t[j] : tr })), starts: a.starts, trSplit: !!t || !tr };
}
