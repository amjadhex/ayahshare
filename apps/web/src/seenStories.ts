// Discover's story circles the person has watched (owner, 12 Oct 2026: like Instagram, a watched circle turns grey and
// moves back, and circles not seen yet come first). On this device only, for a day: the circles change with the time of
// day and the day itself, so a circle seen yesterday is new again. Framework-free.

const KEY = "seenStories";
const DAY = 24 * 3600 * 1000;

function read(now: number): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, number> | null;
    return Object.fromEntries(Object.entries(raw ?? {}).filter(([, at]) => typeof at === "number" && now - at < DAY));
  } catch {
    return {};
  }
}

/** The circles (topic ids) watched in the last day. */
export const seenCircles = (now = Date.now()) => new Set(Object.keys(read(now)));

/** Marks a circle watched. */
export function markCircleSeen(id: string, now = Date.now()) {
  const all = read(now);
  all[id] = now;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: grey for this visit only */ }
}

/** The circles to show: up to `n` not seen yet (in the order given), then up to `n` seen ones, grey, at the back. */
export function orderCircles<T extends { id: string }>(candidates: T[], seen: Set<string>, n: number): T[] {
  const fresh = candidates.filter((c) => !seen.has(c.id)), old = candidates.filter((c) => seen.has(c.id));
  return [...fresh.slice(0, n), ...old.slice(0, n)];
}
