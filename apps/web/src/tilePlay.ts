// Search result tiles that move: a tile whose clip has a preview (a small muted loop, ~100–400 KB) plays it while it is
// well in view. At most a few play at once (the ones nearest the middle of the screen: 2 on a phone, 4 on a computer);
// the others hold still on their thumbnail, and a tile that leaves the screen lets its file go. Nothing moves with
// reduced motion, a data saver or a 2G connection, while the tile's screen (its group: Results, Discover) is not the one
// shown, or while the page is hidden. Framework-free; the screens register each tile's element and video.

interface NetInfo { saveData?: boolean; effectiveType?: string }
interface Entry { video: HTMLVideoElement; url: string; ratio: number; group: string }

const entries = new Map<Element, Entry>();
let io: IntersectionObserver | null = null;
/** Groups whose screen is not shown. */
const hidden = new Set<string>();
const VISIBLE = 0.5; // the share of a tile that must be on screen for it to play

/** Whether tiles may move here at all. */
export function canMove(nav: { connection?: NetInfo } = navigator as { connection?: NetInfo }): boolean {
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const c = nav.connection;
  return !(c?.saveData || c?.effectiveType === "2g" || c?.effectiveType === "slow-2g");
}

/** How many tiles play at once: fewer on a phone (small screen, battery). */
export const maxPlaying = () => (typeof matchMedia === "function" && matchMedia("(max-width: 759px)").matches ? 2 : 4);

function release(e: Entry) {
  const v = e.video;
  v.pause();
  v.removeAttribute("data-on");
  if (v.getAttribute("src")) { v.removeAttribute("src"); v.load(); }
}

/** Plays the tiles nearest the middle of the screen, pauses the rest (letting go of those off screen). */
export function update() {
  const allowed = !document.hidden && canMove();
  const mid = window.innerHeight / 2;
  const playing = allowed
    ? [...entries].filter(([, e]) => e.ratio >= VISIBLE && !hidden.has(e.group))
      .map(([el, e]) => { const r = el.getBoundingClientRect(); return { e, d: Math.abs(r.top + r.height / 2 - mid) }; })
      .sort((a, b) => a.d - b.d).slice(0, maxPlaying()).map((x) => x.e)
    : [];
  for (const e of entries.values()) {
    if (playing.includes(e)) {
      if (!e.video.getAttribute("src")) e.video.src = e.url;
      void e.video.play().catch(() => {});
    } else if (e.ratio === 0) release(e);
    else e.video.pause();
  }
}

/** Starts watching a tile of a screen (`group`); returns the function that stops it. */
export function registerTile(el: Element, video: HTMLVideoElement, url: string, group = "results"): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  if (!io) {
    io = new IntersectionObserver((list) => {
      for (const x of list) { const e = entries.get(x.target); if (e) e.ratio = x.isIntersecting ? x.intersectionRatio : 0; }
      update();
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    document.addEventListener("visibilitychange", update);
  }
  video.muted = true; // React sets the property only after the first render; autoplay needs it before play()
  const onPlaying = () => video.setAttribute("data-on", "");
  video.addEventListener("playing", onPlaying);
  const entry: Entry = { video, url, ratio: 0, group };
  entries.set(el, entry);
  io.observe(el);
  return () => {
    io?.unobserve(el);
    entries.delete(el);
    video.removeEventListener("playing", onPlaying);
    release(entry);
  };
}

/** A screen (`group`) tells whether it is the one shown: hidden, its tiles hold still. */
export function setTilesActive(on: boolean, group = "results") {
  if (on) hidden.delete(group); else hidden.add(group);
  update();
}
