// Scholars' notes beside Reflect (owner, 12 Oct 2026, "names in turn"): on the reel on screen, a while into it, when
// the ayah has notes by QuranReflect's verified authors (the Reflect sheet's "Scholars' notes"), their names come in
// from the right of the Reflect button one after another ("Maryam Amir", then the next…, over "and 4 more reflected on
// this") with their faces, then go. A tap opens Reflect, which opens on those notes. The Feed shows it on every such
// reel (`allow`); the nudge waits only while the reel plays, and steps aside when it stops.
import { useEffect, useRef, useState } from "react";
import type { ReflectionPost } from "../../../../contracts/types";
import * as api from "../api";
import { t } from "../strings";
import { initials } from "./Reflect";

/** Playing time on a reel before the names come in (owner, 12 Oct 2026: early, while people are still looking: 3 s);
 *  each name's turn; how long the last one stays; the way out. */
export const NUDGE_AFTER_MS = 3000, NUDGE_TURN_MS = 1800, NUDGE_LAST_MS = 1200, NUDGE_OUT_MS = 300;
/** Names shown in turn (the count says how many more there are). */
const MAX_NAMES = 3;


export interface Scholar { name: string; avatar: string | null }

const known = new Map<string, Promise<Scholar[]>>();
/** The verified authors with notes on the ayah (lessons first, then reflections), each once; kept for the visit. */
export function scholarsFor(ref: string, lang: string): Promise<Scholar[]> {
  const key = `${ref}|${lang}`;
  let got = known.get(key);
  if (!got) {
    // Through a promise, so a missing function (older test stand-ins) is no names, not a crash.
    const load = (kind: "lessons" | "reflections") => Promise.resolve()
      .then(() => (kind === "lessons" ? api.getLessons : api.getReflections)(ref, lang, 1))
      .then((d) => d?.posts ?? [], () => [] as ReflectionPost[]);
    got = Promise.all([load("lessons"), load("reflections")]).then(([lessons, reflections]) => {
      const seen = new Set<string>(), out: Scholar[] = [];
      for (const p of [...lessons, ...reflections]) {
        const by = p.by;
        if (!by?.verified) continue;
        const name = by.name || by.username, id = by.username || by.name;
        if (!name || seen.has(id)) continue;
        seen.add(id);
        out.push({ name, avatar: api.avatarSrc(by.avatar) });
      }
      return out;
    });
    known.set(key, got);
  }
  return got;
}

/** For tests: forget the names loaded. */
export const resetScholars = () => known.clear();

type Phase = "wait" | "in" | "out" | "done";

/** `playing`: the reel is on screen and playing, with nothing over it. `allow`: whether this reel may have the nudge
 *  (asked when it mounts and again before it shows); `onShown` when it does. */
export function ScholarsNudge({ refId, lang, playing, allow, onShown, onOpen }: {
  refId: string; lang: string; playing: boolean; allow: () => boolean; onShown: () => void; onOpen: () => void;
}) {
  const [scholars, setScholars] = useState<Scholar[] | null>(null);
  const [phase, setPhase] = useState<Phase>("wait");
  const [waited, setWaited] = useState(false);
  const [turn, setTurn] = useState(0);
  const played = useRef(0);

  // The names, only for a reel that may have the nudge.
  useEffect(() => {
    if (!allow()) { setPhase("done"); return; }
    let live = true;
    void scholarsFor(refId, lang).then((s) => { if (live) setScholars(s); });
    return () => { live = false; };
  }, [refId, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Playing time only: a pause or a sheet stops the clock.
  useEffect(() => {
    if (phase !== "wait" || waited || !playing) return;
    const from = Date.now();
    const timer = setTimeout(() => setWaited(true), Math.max(0, NUDGE_AFTER_MS - played.current));
    return () => { clearTimeout(timer); played.current += Date.now() - from; };
  }, [phase, waited, playing]);

  useEffect(() => {
    if (phase !== "wait" || !waited || !scholars) return;
    if (!scholars.length || !allow()) { setPhase("done"); return; }
    setPhase("in");
    onShown();
  }, [phase, waited, scholars]); // eslint-disable-line react-hooks/exhaustive-deps

  // In: one name after another, the last stays a moment, then out. Stopping the reel sends it out at once.
  const shown = Math.min(MAX_NAMES, scholars?.length ?? 0);
  useEffect(() => {
    if (phase !== "in") return;
    if (!playing) { setPhase("out"); return; }
    const timer = turn < shown - 1 ? setTimeout(() => setTurn((n) => n + 1), NUDGE_TURN_MS) : setTimeout(() => setPhase("out"), NUDGE_TURN_MS + NUDGE_LAST_MS);
    return () => clearTimeout(timer);
  }, [phase, turn, shown, playing]);
  useEffect(() => {
    if (phase !== "out") return;
    const timer = setTimeout(() => setPhase("done"), NUDGE_OUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if ((phase !== "in" && phase !== "out") || !scholars?.length) return null;
  const more = scholars.length - 1;
  return (
    <button type="button" className={`scholars-nudge${phase === "out" ? " out" : ""}`} aria-label={t.scholarsNudge(scholars[0].name, more)} onClick={onOpen}>
      <span className="sn-text">
        <span key={turn} className="sn-name" dir="auto">{scholars[turn].name}</span>
        <span className="sn-more">{t.scholarsMore(more)}</span>
      </span>
      <span className="sn-faces" aria-hidden="true">
        {scholars.slice(0, shown).map((s, i) => <Face key={i} scholar={s} on={i === turn} />)}
      </span>
    </button>
  );
}

function Face({ scholar, on }: { scholar: Scholar; on: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={on ? "on" : undefined}>
      {scholar.avatar && !broken
        ? <img src={scholar.avatar} alt="" width={26} height={26} decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : initials(scholar.name)}
    </span>
  );
}
