// When to invite someone to sign up (owner, 8 Oct 2026). Nothing needs an account; these are gentle invitations:
//  - "welcome": once, right after the first language choice on a new device;
//  - "create" / "like": once each, after someone first makes or likes something while signed out;
//  - "login": the sheet's default copy (Log in itself opens the login page, /login).
// The unasked ones (welcome, create, like) come at most once a day, so two never follow each other. Device-local and
// framework-free; ui/Join.tsx shows them, actions.ts inviteToJoin decides who is asked at all (never someone signed in).

export type JoinReason = "welcome" | "login" | "create" | "like";

const KEY = "ayahshare.join.v1";
const GAP_MS = 24 * 3600 * 1000;

interface Seen { asked: Partial<Record<JoinReason, number>>; last: number }

function read(): Seen {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Seen | null;
    if (v && typeof v === "object" && v.asked && typeof v.asked === "object" && typeof v.last === "number") return v;
  } catch { /* damaged or blocked: start again */ }
  return { asked: {}, last: 0 };
}
const write = (s: Seen) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: asked again next visit */ } };

let current: JoinReason | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const fn of [...listeners]) fn(); };

export const getJoin = () => current;
export function subscribeJoin(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Shows the invitation for `reason` if it is due: each unasked reason once per device, at most one a day. */
export function askToJoin(reason: Exclude<JoinReason, "login">, now = Date.now()) {
  if (current) return;
  const seen = read();
  if (seen.asked[reason] || now - seen.last < GAP_MS) return;
  write({ asked: { ...seen.asked, [reason]: now }, last: now });
  current = reason;
  emit();
}

export function closeJoin() {
  if (!current) return;
  current = null;
  emit();
}

/** Tests: forget what was asked. */
export function resetJoin() {
  current = null;
  try { localStorage.removeItem(KEY); localStorage.removeItem(NAME_KEY); } catch { /* ignore */ }
  emit();
}

// ---------- the name (owner, 9 Oct 2026: make people add a name) ----------
// An account without a name (email sign-up) is asked right after signing in (the login page); put off, it is asked again
// on Profile, at most once a day.

const NAME_KEY = "ayahshare.name.v1";

/** Signed in, and neither a chosen name nor one from Google. */
export const needsName = (me: { name?: string | null; displayName?: string | null } | null | undefined) =>
  !!me && !me.displayName?.trim() && !me.name?.trim();

/** The name was asked for (or put off) at least a day ago, or never. */
export function nameAskDue(now = Date.now()) {
  let last = 0;
  try { last = Number(localStorage.getItem(NAME_KEY)) || 0; } catch { /* blocked: ask */ }
  return now - last >= GAP_MS;
}

/** Remembers that the name was asked for now. */
export function nameAsked(now = Date.now()) {
  try { localStorage.setItem(NAME_KEY, String(now)); } catch { /* private mode: asked again next visit */ }
}
