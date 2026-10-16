// The preview: background (clip or colour), frosted glass, the canvas text layers (same drawing and compositing code as
// the export), the recitation and the player. The design's ayahs (up to 3) take turns in the same text block: paused,
// the preview shows the ayah (or part) chosen with the seek bar, the Ayah tab or the arrow keys (an image export shows
// that one too); playing, it plays the video exactly: each ayah's text enters as its recitation starts and leaves as it
// ends (none, fade, rise or zoom), and the last one stays through the tail. A long ayah shown in parts (draw.ts) plays its parts in turn on the same clock, each
// for its share of the ayah's recitation; paused, the seek bar and the arrow keys reach the parts too, and an image export
// shows the part on screen. With a translation voice (voice.ts), each ayah's recitation is followed by the voice reading
// its translation, and the ayah's text stays on screen through both (a long ayah's parts come again while the voice
// reads). The text's clock is the audio itself (the playing audio element's time). Two audio elements take turns: while
// one plays a recording, the other holds the next one loaded and paused at its start, so the next recording starts the
// moment one ends, and the text never runs ahead or behind.
// Auto contrast measures the clip (backdrop.ts) before the text is drawn; the clip plays from the same downloaded copy.
// The player over the preview (Editor v2): play / pause, one seek bar over the whole video (every ayah, its parts and its
// translation voice, with a mark where each ayah or part starts), the time, and Reset (once something was moved). It
// fades while playing and stays while paused, seeking or dragging; a tap on the preview shows or hides it. The seek bar
// works on the same clock as the text: the timeline is trackTiming's (the recordings' lengths, estimated until known),
// and a seek gives the playing element the recording at that moment and its position there (seekTo). Space plays or
// pauses; swipe sideways or use the arrow keys to move between ayahs. The text block and the surah header can be dragged
// anywhere (snapping to the centre and the thirds); the block's side handles set its width.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type SyntheticEvent } from "react";
import { customise, togglePlay } from "../actions";
import { clipById, clipUrl } from "../api";
import { backdropFor, backdropKey, clipBlob, posterBackdrop, type Backdrop } from "../backdrop";
import { calmer, clampCentre, composeText, sectionAt, sectionCount, sectionWindow, sectionWindows, shiftHeader, shiftPlan, type Rect, type Timing } from "../compose";
import { DEFAULT_HEADER, DEFAULT_POSITION, headerMoved, RECIPE_EXTRAS, SIZES, TAIL_SECONDS, textMoved } from "../config";
import { translationLang, type LoadedAyah } from "../design";
import { drawLayers, fontsReady, type Layers } from "../draw";
import { durationOf } from "../reels";
import { t } from "../strings";
import { audioTracks, estimateTrack, trackTiming } from "../voice";
import { reducedMotion, useAppState, useStore } from "./hooks";
import { MoveIcon, PauseIcon, PlayIcon, ResetIcon } from "./icons";

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const pct = (n: number) => `${n * 100}%`;
/** If the clip has not been measured after this long (its download is slow), the text is drawn with its poster's
 *  measurement, then once more with the clip's own. */
const SLOW_MS = 700;

/** What is being dragged: the text block, its width (by the right or the left handle), or the surah header. */
type Target = "text" | "width" | "widthLeft" | "header";
type Drag = { target: Target; id: number; x0: number; y0: number; k: number; moved: boolean; layers: Layers; rect: Rect };
type Offset = { layers: Layers; dx: number; dy: number };

/** How long the player stays up after a touch while playing. */
const CONTROLS_MS = 2500;
/** "0:07". */
const mmss = (t: number) => { const s = Math.max(0, Math.floor(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** `active`: the preview is on screen (phones show one screen at a time); the clip and recitation pause otherwise.
 *  `image`: the design is made as an image (no playing; the seek bar picks the frame). `dragHint`: "Drag to move" over the
 *  text until it is first dragged. `onLength`: the video's length in seconds, whenever it is known better. */
export function Stage({ active, image = false, dragHint = false, onLength }: {
  active: boolean; image?: boolean; dragHint?: boolean; onLength?: (seconds: number) => void;
}) {
  const store = useStore();
  const { recipe: r, ayahs, current, section, playing, loading, surahs, editions, config } = useAppState();
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const players = [useRef<HTMLAudioElement>(null), useRef<HTMLAudioElement>(null)];
  /** Which of the two plays the current ayah; the other one holds the next. */
  const slot = useRef(0);
  const player = () => players[slot.current].current;
  const spare = () => players[1 - slot.current].current;

  const clip = r.bg.type === "clip" ? clipById(r.bg.id) : null;
  const [W, H] = SIZES.hd[r.orientation];
  const surah = surahs[r.surah - 1];
  const lang = translationLang(r.translation, editions);
  const brand = config.appName;
  const animation = calmer(r.animation ?? RECIPE_EXTRAS.animation, reducedMotion());
  const n = ayahs.length;
  const goTo = (i: number, part = 0) => store.dispatch({ type: "goTo", index: i, section: part });

  // ---------- the clip: downloaded once, played from memory and measured for Auto contrast ----------
  const [videoSrc, setVideoSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    setVideoSrc(undefined); // the poster shows until the clip is here
    if (!clip) return;
    let alive = true, url: string | undefined;
    clipBlob(clip, r.orientation).then((b) => {
      if (alive) setVideoSrc((url = URL.createObjectURL(b)));
    }, () => { if (alive) setVideoSrc(clipUrl(clip, "video", r.orientation)); }); // streamed instead
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [clip?.id, r.orientation]); // eslint-disable-line react-hooks/exhaustive-deps

  const auto = r.autoContrast ?? RECIPE_EXTRAS.autoContrast;
  const bgKey = backdropKey(r);
  const [backdrop, setBackdrop] = useState<{ key: string; b: Backdrop | null } | null>(null);
  useEffect(() => {
    if (!auto) return;
    let alive = true, done = false;
    const set = (b: Backdrop | null) => { if (alive) setBackdrop({ key: bgKey, b }); };
    void backdropFor(r, clip).then((b) => { done = true; set(b); });
    // A slow download: the poster's measurement in the meantime (one change when the clip's own arrives).
    const slow = clip ? setTimeout(() => void posterBackdrop(clip, r.orientation).then((b) => { if (!done) set(b); }), SLOW_MS) : 0;
    return () => { alive = false; clearTimeout(slow); };
  }, [auto, bgKey, clip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- text layers ----------
  // A width being dragged re-lays out the text; a position being dragged only moves the drawn layers. With Auto
  // contrast the text waits for the background's measurement (the previous design stays on screen meanwhile).
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const design = useMemo(() => (liveWidth === null ? r : { ...r, textWidth: liveWidth }), [r, liveWidth]);
  const measured = !auto ? null : backdrop?.key === bgKey ? backdrop.b : undefined;
  const [layers, setLayers] = useState<Layers | null>(null);
  /** The ayahs the layers on screen show: other ayahs are never left on screen while a measurement is on its way. */
  const drawnFor = useRef<LoadedAyah[] | null>(null);
  useEffect(() => {
    if (!ayahs.length || !surah) return;
    if (measured === undefined) {
      if (drawnFor.current !== ayahs) { drawnFor.current = null; setLayers(null); }
      return;
    }
    let alive = true;
    const scene = { recipe: design, surah, lang, brand, backdrop: measured };
    // Fonts load first; a newer design wins over a draw still waiting for its fonts.
    void fontsReady(ayahs, scene).then(() => {
      if (!alive) return;
      drawnFor.current = ayahs;
      setLayers(drawLayers(W, H, ayahs, scene));
    });
    return () => { alive = false; };
  }, [design, ayahs, surah, lang, brand, W, H, measured]);

  // Offsets belong to the layers they were measured on; the redraw after the drop replaces both at once (no jump).
  const [textOffset, setTextOffset] = useState<Offset | null>(null);
  const [headOffset, setHeadOffset] = useState<Offset | null>(null);
  const shown = useMemo(() => {
    if (!layers || layers.plan.width !== W || layers.plan.height !== H) return null;
    let plan = layers.plan;
    if (textOffset?.layers === layers) plan = shiftPlan(plan, textOffset.dx, textOffset.dy);
    if (headOffset?.layers === layers) plan = shiftHeader(plan, headOffset.dx, headOffset.dy);
    return plan === layers.plan ? layers : { ...layers, plan };
  }, [layers, textOffset, headOffset, W, H]);

  // What the swipes and arrow keys step through: each ayah, and each part of a long one ([ayah, part]).
  const counts = ayahs.map((_, i) => (shown ? sectionCount(shown.plan, i) : 1));
  const slides = counts.flatMap((c, i) => Array.from({ length: c }, (_, j): [number, number] => [i, j]));
  const here = Math.max(0, slides.findIndex(([i, j]) => i === current && j === Math.min(section, counts[current] - 1)));
  /** Playing, a jump to a part of a long ayah: where in that ayah's recitation to continue (a fraction of it). The
   *  painting loop moves the playing element there as soon as it plays that ayah. */
  const seek = useRef<{ ayah: number; at: number } | null>(null);
  /** The seek bar: recording k (index into tracks), `offset` seconds in. The playing element is moved there as soon as it
   *  has that recording loaded (the painting loop, or its loadedmetadata); until then the clock reads that moment. */
  const jump = useRef<{ k: number; offset: number } | null>(null);
  /** The swipes and arrow keys: a jump (playing, that ayah's recitation starts, or for a part of a long ayah
   *  continues from that part, and its text comes in). */
  const step = (k: number) => {
    const [i, j] = slides[Math.max(0, Math.min(k, slides.length - 1))] ?? [0, 0];
    const at = shown?.plan.sections?.[i]?.[j] ?? 0;
    seek.current = playing && counts[i] > 1 && (at > 0 || i === current) ? { ayah: i, at } : null;
    if (seek.current && i === current) {
      // The same ayah (also from its translation voice or its tail): its recitation moves to the part.
      const a = player();
      if (track.current !== firstOf(i)) recite(firstOf(i));
      else if (a?.paused) void a.play().catch(() => {});
    }
    tail.current = 0;
    handover.current = false;
    jump.current = null;
    goTo(i, j);
  };

  // ---------- recitation (and translation voice) ----------
  // The design's audio in playing order (voice.ts): each ayah's recitation, then, with a translation voice, the voice
  // reading its translation. Each file is downloaded into memory, the next one while the current one plays, and loaded
  // into the spare element. Both elements are started by the person's tap (phones allow sound only on elements started
  // that way).
  const tracks = useMemo(() => audioTracks(r, ayahs.map((a) => a.num)), [ayahs, r.reciter, r.surah, r.voice, r.translation]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The recording the playing element plays (index into tracks). */
  const track = useRef(0);
  /** Ayah i's recitation (index into tracks). */
  const firstOf = (i: number) => Math.max(0, tracks.findIndex((tk) => tk.ayah === i));
  const durations = useRef<number[]>([]);
  const files = useRef(new Map<string, string | null>()); // network address → in-memory copy (null while loading)
  const urlOf = (k: number) => tracks[k]?.url ?? null;
  useEffect(() => {
    durations.current = [];
    track.current = 0;
    jump.current = null;
    const mine = files.current;
    return () => {
      for (const u of mine.values()) if (u) URL.revokeObjectURL(u);
      mine.clear();
      for (const p of players) if (p.current) delete p.current.dataset.net; // its in-memory copy is gone: load it again
    };
  }, [tracks]); // eslint-disable-line react-hooks/exhaustive-deps
  const preload = (k: number) => {
    const net = urlOf(k), mine = files.current;
    if (!net || mine.has(net)) return;
    mine.set(net, null);
    void fetch(net).then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`${res.status}`)))).then(async (b) => {
      if (files.current !== mine || !mine.has(net)) return;
      const url = URL.createObjectURL(b);
      mine.set(net, url);
      const d = await durationOf(url);
      if (d && urlOf(k) === net) durations.current[k] = d;
    }).catch(() => mine.delete(net));
  };
  /** Gives element `a` recording k (from memory when it is there), unless it has it already. */
  const give = (a: HTMLAudioElement, k: number) => {
    const net = urlOf(k);
    if (!net || a.dataset.net === net) return;
    a.dataset.net = net;
    a.src = files.current.get(net) ?? net;
  };
  const unlocked = useRef(new WeakSet<HTMLAudioElement>());
  /** The spare element takes recording k, ready at its start. The first time, inside the person's tap, it is also
   *  started (silently, for a moment) so that it may play on its own later. */
  const ready = (k: number) => {
    const s = spare();
    if (!s || !urlOf(k)) return;
    give(s, k);
    if (unlocked.current.has(s)) return;
    unlocked.current.add(s);
    s.muted = true;
    s.play().then(() => {
      if (s === spare()) { s.pause(); s.currentTime = 0; } // (unless a very short recording ended meanwhile and it plays now)
      s.muted = false;
    }, () => { s.muted = false; });
  };
  /** Starts recording k on the playing element. */
  const recite = (k: number) => {
    const a = player();
    if (!a || !urlOf(k)) return;
    track.current = k;
    give(a, k);
    unlocked.current.add(a);
    a.play().catch(() => store.dispatch({ type: "play", on: false }));
    preload(k + 1);
    ready(k + 1);
  };
  const audioSrc = urlOf(firstOf(current));
  /** The tail after the last ayah (performance.now() when it began; 0 = not in it). */
  const tail = useRef(0);
  /** One recording has just ended and the next is starting: until it sounds, the text stays at the end of the one
   *  before (a cut waits for the voice too). */
  const handover = useRef(false);
  useEffect(() => {
    if (!playing || !audioSrc) { for (const p of players) p.current?.pause(); tail.current = 0; return; }
    if (tail.current) return;
    // Every recording of the design starts downloading now (a few small files), so none is late when its turn comes.
    tracks.forEach((_, k) => preload(k));
    // Paused during this ayah's translation voice: the voice goes on. Otherwise the ayah's recitation (re)starts.
    const a = player(), k0 = firstOf(current), now = track.current;
    const k = tracks[now]?.ayah === current && a?.dataset.net === urlOf(now) ? now : k0;
    // A part of a long ayah chosen while paused: the recitation continues from that part (unless it was paused inside it).
    const cuts = shown?.plan.sections?.[current];
    if (k === k0 && !seek.current && !jump.current && cuts && cuts.length > 1) {
      const j = Math.min(store.getState().section, cuts.length - 1);
      const pos = a && a.dataset.net === audioSrc ? a.currentTime / (durations.current[k0] || estimateTrack(tracks[k0], ayahs)) : 0;
      if (pos < cuts[j] || pos >= (cuts[j + 1] ?? Infinity)) seek.current = { ayah: current, at: cuts[j] };
    }
    recite(k);
  }, [playing, audioSrc, tracks]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!active) store.dispatch({ type: "play", on: false }); }, [active, store]);
  const onEnded = (e: SyntheticEvent<HTMLAudioElement>) => {
    if (e.currentTarget !== player()) return;
    const next = track.current + 1;
    if (next >= tracks.length) { tail.current = performance.now(); return; } // the last ayah stays for the tail, then leaves
    handover.current = true;
    const s = spare();
    if (s && s.dataset.net === urlOf(next)) {
      // the next recording is waiting at its start in the other element: straight on
      const before = slot.current;
      slot.current = 1 - before;
      track.current = next;
      s.currentTime = 0;
      // (if the browser does not let it play on its own, the element that just ended switches its source instead)
      s.play().then(() => { preload(next + 1); ready(next + 1); }, () => { slot.current = before; recite(next); });
    } else recite(next); // not ready: the same element switches its source
    if (tracks[next].ayah !== store.getState().current) goTo(tracks[next].ayah); // (a translation voice keeps its ayah)
  };
  const finish = () => { tail.current = 0; track.current = 0; jump.current = null; store.dispatch({ type: "play", on: false }); goTo(0); };

  // ---------- the seek bar's clock (the same timeline the painting loop uses) ----------
  const timeline = () => {
    const lengths = tracks.map((tk, k) => durations.current[k] || estimateTrack(tk, ayahs));
    return { lengths, ...trackTiming(tracks, lengths, n, animation, TAIL_SECONDS) };
  };
  /** Where each ayah (after the first) and each part of a long one starts, in seconds. */
  const marks = () => {
    if (!tracks.length) return [];
    const { timing } = timeline(), out: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) out.push(timing.starts[i]);
      if (!shown) continue;
      for (let j = 1; j < sectionCount(shown.plan, i); j++) for (const [from] of sectionWindows(shown.plan, timing, i, j)) out.push(from);
    }
    return out;
  };
  /** The moment of the video on screen: playing, the audio's own clock; paused, where the recitation was paused in the
   *  ayah (or part) on screen, else where that ayah (or part) starts. */
  const timeNow = () => {
    if (!tracks.length || !n) return 0;
    const { timing, at, total, lengths } = timeline();
    if (playing && tail.current) return total + (performance.now() - tail.current) / 1000;
    if (jump.current) return at[jump.current.k] + jump.current.offset;
    const k0 = firstOf(current), k = tracks[track.current]?.ayah === current ? track.current : k0;
    const a = player(), ct = a && a.dataset.net === urlOf(k) ? Math.min(a.currentTime || 0, lengths[k]) : 0;
    if (playing) return handover.current ? at[k] : at[k] + ct;
    const part = shown ? Math.min(section, sectionCount(shown.plan, current) - 1) : 0;
    if (ct > 0 && (!shown || sectionAt(shown.plan, timing, current, at[k] + ct) === part)) return at[k] + ct;
    return shown ? sectionWindow(shown.plan, timing, current, part)[0] : timing.starts[current] ?? 0;
  };
  /** The seek bar moved to `time` (seconds): that moment's ayah (and part) comes on screen, and the recording heard
   *  there is given to the playing element at that position (playing, it goes on from there; paused, Play starts there). */
  const seekTo = (time: number) => {
    if (!tracks.length || !n) return;
    const { timing, at, total } = timeline();
    const tt = Math.max(0, Math.min(time, total - 0.05));
    let k = 0;
    while (k + 1 < tracks.length && at[k + 1] <= tt) k++;
    const i = tracks[k].ayah, j = shown ? sectionAt(shown.plan, timing, i, tt) : 0;
    tail.current = 0;
    handover.current = false;
    seek.current = null;
    jump.current = { k, offset: tt - at[k] };
    const a = player();
    if (playing) {
      if (track.current !== k || a?.dataset.net !== urlOf(k)) recite(k);
    } else if (a) {
      track.current = k;
      preload(k);
      give(a, k);
    }
    if (a && a.dataset.net === urlOf(k) && a.readyState >= 1) { a.currentTime = jump.current.offset; jump.current = null; }
    if (i !== current || j !== section) goTo(i, j);
  };
  /** The scrubbing label: "94:6 · ayah 2 of 2" (and the part of a long ayah). */
  const momentLabel = (time: number) => {
    if (!tracks.length || !n) return "";
    const { timing, at } = timeline();
    let k = 0;
    while (k + 1 < tracks.length && at[k + 1] <= time) k++;
    const i = tracks[k].ayah, parts = shown ? sectionCount(shown.plan, i) : 1;
    const part = parts > 1 && shown ? sectionAt(shown.plan, timing, i, time) : 0;
    return parts > 1 ? t.edSeekMomentPart(refOf(i), i + 1, n, part + 1, parts) : t.edSeekMoment(refOf(i), i + 1, n);
  };

  // ---------- painting ----------
  // Paused: the selected ayah, full text. Playing: the text as the video shows it at this moment of the audio.
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    if (!shown) { ctx.clearRect(0, 0, W, H); return; }
    const paint = (timing: Timing | null, time: number) => { ctx.clearRect(0, 0, W, H); composeText(ctx, shown, timing, time, current, section); };
    if (!playing) { paint(null, 0); return; }
    let raf = 0;
    const k0 = firstOf(current);
    const tick = () => {
      const lengths = tracks.map((tk, k) => durations.current[k] || estimateTrack(tk, ayahs));
      const { timing, at, total } = trackTiming(tracks, lengths, n, animation, TAIL_SECONDS);
      let time: number;
      if (tail.current) {
        time = total + (performance.now() - tail.current) / 1000;
        if (time >= total + TAIL_SECONDS) { finish(); return; }
      } else {
        // The audio's own clock. Until the element plays this ayah's recording, its text has not started.
        const k = tracks[track.current]?.ayah === current ? track.current : k0;
        const a = player(), mine = !!a && a.dataset.net === urlOf(k), s = seek.current, j = jump.current;
        if (s && mine && s.ayah === current && k === k0 && a.readyState >= 1) { a.currentTime = s.at * lengths[k] + 0.01; seek.current = null; }
        // A seek bar jump: the element plays that recording from that moment once it can (until then, the text is there).
        if (j && j.k === k && mine && a.readyState >= 1) { a.currentTime = j.offset; jump.current = null; }
        const ct = mine ? a.currentTime || 0 : 0;
        if (ct > 0) handover.current = false;
        time = jump.current ? at[jump.current.k] + jump.current.offset
          : handover.current ? at[k] - 0.001 : at[k] + Math.min(ct, lengths[k]);
      }
      paint(timing, time);
      // A long ayah in parts: the part being recited (or read) is the one shown once paused (and in an image export).
      const live = sectionAt(shown.plan, timing, current, time), now = store.getState();
      if (!seek.current && now.current === current && now.section !== live) goTo(current, live);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [shown, playing, animation, current, section, ayahs, tracks, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  // Frame size on screen ÷ canvas size: the glass blur and the drag maths work in canvas pixels.
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = frame.current!;
    const set = () => setScale(el.clientWidth / W);
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);

  // ---------- background clip ----------
  // One clip for the whole design: it keeps looping while the ayahs take turns.
  useEffect(() => {
    const v = video.current!;
    if (!videoSrc) { v.load(); return; } // stops the previous clip
    v.muted = true;
    if (active) v.play().catch(() => {}); else v.pause();
  }, [videoSrc, active]);

  // ---------- tap, swipe, keys on the frame ----------
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (e: PointerEvent) => { if (e.button === 0) start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  const onPointerUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) step(here + (dx < 0 ? 1 : -1));
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) tapPreview();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return; // keys on the text block or the header move them
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowLeft") step(here + (k === "ArrowRight" ? 1 : -1));
    else if (k === " " || k === "Enter") play();
    else return;
    e.preventDefault();
  };

  // ---------- dragging the text block and the header ----------
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: boolean; y: number | null } | null>(null);
  const GUIDES_Y = [H / 3, H / 2, (2 * H) / 3];
  const centreOf = (b: Rect) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

  const beginDrag = (target: Target) => (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation(); // not a tap or a swipe on the frame
    const rect = target === "header" ? shown?.plan.header?.rect : shown?.plan.box;
    if (e.button !== 0 || !layers || !rect || !frame.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      target, id: e.pointerId, x0: e.clientX, y0: e.clientY, k: W / frame.current.getBoundingClientRect().width, moved: false, layers, rect,
    };
  };
  const onDragMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.stopPropagation();
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    if (!d.moved) { d.moved = true; setGuides({ x: false, y: null }); }
    const dx = (e.clientX - d.x0) * d.k, dy = (e.clientY - d.y0) * d.k;
    if (d.target === "width" || d.target === "widthLeft") {
      const grow = d.target === "width" ? dx : -dx; // the block stays centred: both edges move
      setLiveWidth(round3(Math.min(1, Math.max(0.3, (d.rect.w + 2 * grow) / W))));
      return;
    }
    const c0 = centreOf(d.rect), snap = 12 * d.k;
    let cx = c0.x + dx, cy = c0.y + dy, gy: number | null = null;
    const gx = Math.abs(cx - W / 2) < snap;
    if (gx) cx = W / 2;
    for (const g of GUIDES_Y) if (Math.abs(cy - g) < snap) { cy = g; gy = g; }
    const c = clampCentre(d.layers.plan, d.rect.w, d.rect.h, cx, cy);
    const offset = { layers: d.layers, dx: c.x - c0.x, dy: c.y - c0.y };
    if (d.target === "header") setHeadOffset(offset); else setTextOffset(offset);
    setGuides({ x: gx && c.x === W / 2, y: gy !== null && c.y === gy ? gy : null });
  };
  const endDrag = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.stopPropagation();
    drag.current = null;
    setGuides(null);
    if (!d.moved) { tapPreview(); return; } // a tap on the text or the header, like anywhere on the preview
    dragged.current = true;
    if (d.target === "width" || d.target === "widthLeft") {
      if (liveWidth !== null) customise(store, { textWidth: liveWidth }, "textWidth");
      setLiveWidth(null);
    } else if (d.target === "header") {
      const h = shown?.plan.header;
      if (h) { const c = centreOf(h.rect); customise(store, { headerX: round3(c.x / W), headerY: round3(c.y / H) }, "headerPosition"); }
    } else if (shown) {
      const c = centreOf(shown.plan.box);
      customise(store, { textX: round3(c.x / W), textY: round3(c.y / H) }, "position");
    }
  };
  const cancelDrag = () => {
    drag.current = null;
    setGuides(null);
    setTextOffset(null);
    setHeadOffset(null);
    setLiveWidth(null);
  };
  /** Arrow keys move the focused block by 1 % (5 % with Shift). */
  const nudge = (target: "text" | "header") => (e: KeyboardEvent<HTMLElement>) => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const rect = target === "header" ? shown?.plan.header?.rect : shown?.plan.box;
    if (!dir || !shown || !rect) return;
    e.preventDefault();
    e.stopPropagation();
    const k = e.shiftKey ? 0.05 : 0.01, c0 = centreOf(rect);
    const c = clampCentre(shown.plan, rect.w, rect.h, c0.x + dir[0] * k * W, c0.y + dir[1] * k * H);
    if (target === "header") customise(store, { headerX: round3(c.x / W), headerY: round3(c.y / H) }, "headerPosition");
    else customise(store, { textX: round3(c.x / W), textY: round3(c.y / H) }, "position");
  };
  const nudgeWidth = (e: KeyboardEvent<HTMLElement>) => {
    const d = { ArrowLeft: -0.02, ArrowDown: -0.02, ArrowRight: 0.02, ArrowUp: 0.02 }[e.key];
    if (d === undefined || !shown) return;
    e.preventDefault();
    e.stopPropagation();
    customise(store, { textWidth: round3(Math.min(1, Math.max(0.3, shown.plan.box.w / W + d))) }, "textWidth");
  };
  const moved = textMoved(r) || headerMoved(r);

  // ---------- the player over the preview: up while paused, seeking or dragging; while playing, for a moment ----------
  const [controlsUntil, setControlsUntil] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [, setClock] = useState(0); // re-renders when the moment the player fades has come
  const controlsUp = !playing || scrubbing || guides !== null || Date.now() < controlsUntil;
  useEffect(() => {
    const left = controlsUntil - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setClock((c) => c + 1), left + 20);
    return () => clearTimeout(timer);
  }, [controlsUntil]);
  const touched = () => setControlsUntil(Date.now() + CONTROLS_MS);
  /** A tap on the preview: shows the player, or hides it while playing. */
  const tapPreview = () => setControlsUntil(controlsUp && playing ? 0 : Date.now() + CONTROLS_MS);
  const play = () => { if (image) return; touched(); togglePlay(store); };
  // An image does not play.
  useEffect(() => { if (image && store.getState().playing) store.dispatch({ type: "play", on: false }); }, [image, store]);
  const dragged = useRef(false);


  const place = (b: Rect) => ({ left: pct(b.x / W), top: pct(b.y / H), width: pct(b.w / W), height: pct(b.h / H) });
  const box = shown?.plan.box;
  const boxStyle = box && place(box);
  const head = shown?.plan.header;
  const glass = !!(shown && box && clip && shown.plan.blur && scale);
  const label = ayahs[current] ? `${ayahs[current].ar} ${ayahs[current].tr}` : "";
  const handlers = (target: Target) => ({
    onPointerDown: beginDrag(target), onPointerMove: onDragMove, onPointerUp: endDrag, onPointerCancel: cancelDrag,
  });
  const refOf = (i: number) => `${r.surah}:${ayahs[i].num}`;
  return (
    <>
      <div className="stage-fit">
        <div className="stage-box" data-orientation={r.orientation} style={{ "--ratio": W / H } as CSSProperties}>
          <div ref={frame} className={`frame${guides ? " dragging" : ""}`}
            style={{ "--ratio": W / H, background: clip ? "#000" : r.bg.type === "colour" ? r.bg.colour : "#000" } as CSSProperties}
            tabIndex={0} title={t.previewHint} aria-label={t.previewLabel} role="group"
            onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (start.current = null)} onKeyDown={onKeyDown}>
            <video ref={video} muted loop playsInline autoPlay preload="auto" src={videoSrc}
              poster={clip ? clipUrl(clip, "poster", r.orientation) : undefined} hidden={!clip} />
            {glass && (
              <div className="glass" aria-hidden="true"
                style={{ ...boxStyle, borderRadius: box!.radius * scale, "--blur": `${shown!.plan.blur * scale}px` } as CSSProperties} />
            )}
            <canvas ref={canvas} width={W} height={H} role="img" aria-label={label || t.loadingAyahs} />
            {guides && (
              <div className="guides" aria-hidden="true">
                <span className={`guide v${guides.x ? " on" : ""}`} />
                {GUIDES_Y.map((g) => <span key={g} className={`guide h${guides.y === g ? " on" : ""}`} style={{ top: pct(g / H) }} />)}
              </div>
            )}
            {head && (
              <div className="drag-block header-block" style={place(head.rect)} role="button" tabIndex={0} aria-label={t.moveHeader}
                {...handlers("header")} onKeyDown={nudge("header")} />
            )}
            {boxStyle && (
              <>
                <div className="drag-block text-block" style={boxStyle} role="button" tabIndex={0} aria-label={t.moveText}
                  {...handlers("text")} onKeyDown={nudge("text")} />
                <span className="width-handle" style={{ left: pct((box!.x + box!.w) / W), top: pct((box!.y + box!.h / 2) / H) }}
                  role="slider" tabIndex={0} aria-label={t.resizeText} aria-orientation="horizontal" aria-valuemin={30} aria-valuemax={100}
                  aria-valuenow={Math.round((box!.w / W) * 100)} aria-valuetext={`${Math.round((box!.w / W) * 100)}%`}
                  {...handlers("width")} onKeyDown={nudgeWidth}><span /></span>
                {/* The same width from the left edge, for pointers (on phones the tool rail covers the right edge). */}
                <span className="width-handle left" style={{ left: pct(box!.x / W), top: pct((box!.y + box!.h / 2) / H) }}
                  aria-hidden="true" {...handlers("widthLeft")}><span /></span>
              </>
            )}
            {(loading || !surah || !layers) && <div className="loading"><span className="spinner" /></div>}
          </div>
          <div className={`stage-overlay${controlsUp ? " up" : ""}`}>
            {dragHint && !dragged.current && !playing && box && (
              <span className="drag-hint" aria-hidden="true" style={{ left: pct((box.x + box.w / 2) / W), top: pct(box.y / H) }}>
                <MoveIcon />{t.edDragHint}
              </span>
            )}
            {moved && (
              <button type="button" className="stage-reset" aria-label={t.resetPosition} tabIndex={controlsUp ? 0 : -1}
                onClick={() => { touched(); customise(store, { ...DEFAULT_POSITION, ...DEFAULT_HEADER }, "position"); }}>
                <span><ResetIcon />{t.reset}</span>
              </button>
            )}
            <div className="stage-bar">
              {image ? <span className="stage-frame-chip">{t.edFrame}</span> : (
                <button type="button" className={`stage-btn play${playing ? " playing" : ""}`} aria-label={playing ? t.pause : t.play}
                  tabIndex={controlsUp ? 0 : -1} disabled={!n} onClick={play}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
              )}
              <SeekBar now={timeNow} marks={marks} end={() => timeline().total + TAIL_SECONDS} seek={(v) => { touched(); seekTo(v); }}
                label={momentLabel} scrubbing={scrubbing} onScrub={(on) => { setScrubbing(on); if (!on) touched(); }}
                onLength={onLength} focusable={controlsUp} disabled={!n} running={active} />
            </div>
          </div>
        </div>
      </div>
      {players.map((ref, k) => (
        <audio key={k} ref={ref} preload="auto" onEnded={onEnded}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget, d = el.duration, k = tracks.findIndex((tk) => tk.url === el.dataset.net);
            if (Number.isFinite(d) && k >= 0) durations.current[k] = d;
            const j = jump.current;
            if (j && el === player() && j.k === k) { el.currentTime = j.offset; jump.current = null; }
          }} />
      ))}
    </>
  );
}

/** The seek bar over the whole video: a mark where each ayah or part starts, the moment while seeking ("94:6 · ayah 2
 *  of 2") and the time. It reads the preview's clock (`now`, `end`, `marks`) every frame and draws only what changed. */
function SeekBar({ now, end, marks, seek, label, scrubbing, onScrub, onLength, focusable, disabled, running }: {
  now: () => number; end: () => number; marks: () => number[]; seek: (time: number) => void; label: (time: number) => string;
  scrubbing: boolean; onScrub: (on: boolean) => void; onLength?: (seconds: number) => void; focusable: boolean; disabled: boolean;
  /** The preview is on screen (the clock is read only then). */
  running: boolean;
}) {
  const live = useRef({ now, end, marks, onLength });
  live.current = { now, end, marks, onLength };
  const [v, setV] = useState({ time: 0, end: 0, marks: "" });
  const length = useRef(-1);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      const c = live.current, e = Math.round(c.end() * 10) / 10, time = Math.min(Math.round(c.now() * 10) / 10, e);
      const m = c.marks().map((x) => (e ? x / e : 0).toFixed(4)).join(" ");
      setV((p) => (p.time === time && p.end === e && p.marks === m ? p : { time, end: e, marks: m }));
      if (e !== length.current) { length.current = e; c.onLength?.(e); }
      raf = requestAnimationFrame(read);
    };
    if (running) read();
    return () => cancelAnimationFrame(raf);
  }, [running]);
  const f = v.end ? Math.min(1, v.time / v.end) : 0;
  const at = (x: number) => `calc(8px + (100% - 16px) * ${x})`;
  const moment = label(v.time);
  return (
    <>
      <div className="seek">
        <span className="seek-track" />
        <span className="seek-fill" style={{ width: `calc((100% - 16px) * ${f})` }} />
        {v.marks && v.marks.split(" ").map((x) => (
          <span key={x} className={`seek-mark${+x <= f ? " past" : ""}`} style={{ left: at(+x) }} />
        ))}
        <span className={`seek-thumb${scrubbing ? " on" : ""}`} style={{ left: at(f) }} />
        {scrubbing && moment && <span className="seek-label" style={{ left: at(f) }}>{moment}</span>}
        <input type="range" min={0} max={v.end || 1} step={0.1} value={v.time} disabled={disabled} tabIndex={focusable ? 0 : -1}
          aria-label={t.edSeek} aria-valuetext={t.edSeekValue(mmss(v.time), mmss(v.end), moment)}
          onChange={(e) => { const x = +e.target.value; setV((p) => ({ ...p, time: x })); seek(x); }}
          onPointerDown={() => onScrub(true)} onPointerUp={() => onScrub(false)} onPointerCancel={() => onScrub(false)}
          onBlur={() => scrubbing && onScrub(false)} />
      </div>
      <span className="seek-time">{mmss(v.time)} / {mmss(v.end)}</span>
    </>
  );
}
