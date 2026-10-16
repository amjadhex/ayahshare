// Warming a reel before it is opened from Results or Discover, so it starts at once: its text (kept in memory by
// api.ts), its recordings (into the HTTP cache and the offline cache) and its poster. The reel a list opens with gets
// its reciter afresh (Feed.tsx), so the recordings warmed here are the ones it plays. Framework-free.
import type { Prefs, Recipe, Ref } from "../../../contracts/types";
import * as api from "./api";
import { fixedReciter, groupItem, pickReciter, reelDesign, reelFor } from "./feed";
import { numsOf } from "./reels";
import { audioTracks } from "./voice";

const warmed = new Set<string>();
/** True the first time for each address (the last 200 are remembered). */
function first(url: string) {
  if (warmed.has(url)) return false;
  warmed.add(url);
  if (warmed.size > 200) warmed.delete(warmed.values().next().value!);
  return true;
}

/** Warms the reel that opening `ref` (to `to`, on background `bg`) starts with. */
export function warmReel(ref: Ref, opts: { to?: number; bg?: Recipe["bg"]; prefs: Prefs; lang: string }) {
  try { warm(ref, opts); } catch { /* only a head start: the reel loads as usual when opened */ }
}

function warm(ref: Ref, { to, bg, prefs, lang }: { to?: number; bg?: Recipe["bg"]; prefs: Prefs; lang: string }) {
  const item = groupItem(reelFor(ref, { kind: "discover" }, 0, to)); // as buildReels opens it
  const recipe = reelDesign(item, bg ?? { type: "colour", colour: "#000000" }, fixedReciter(prefs) ?? pickReciter(item.ref, [], prefs.reciter), prefs, lang);
  void api.getAyahText(recipe.surah, recipe.from, recipe.to, recipe.translation).catch(() => {});
  for (const tk of audioTracks(recipe, numsOf(recipe))) {
    if (first(tk.url)) void fetch(tk.url, { priority: "low" }).then((r) => r.blob()).catch(() => {});
  }
  const clip = bg?.type === "clip" ? api.clipById(bg.id) : null;
  const poster = clip ? api.clipUrl(clip, "poster", "portrait") : null;
  if (poster && first(poster)) Object.assign(new Image(), { fetchPriority: "low", src: poster });
}

let timer = 0;
/** Handlers that call `warm` when the person lingers on a result: the mouse resting on it, a press (a tap is coming)
 *  or keyboard focus. */
export function lingerProps(warm: () => void) {
  const soon = () => { clearTimeout(timer); timer = window.setTimeout(warm, 150); };
  return {
    onPointerEnter: (e: { pointerType: string }) => { if (e.pointerType === "mouse") soon(); },
    onPointerLeave: () => clearTimeout(timer),
    onPointerDown: () => { clearTimeout(timer); warm(); },
    onFocus: soon,
  };
}
