// Share links: the design (recipe) is stored as a short code; /s/:code or ?r=<code> opens it again. Framework-free.
import type { Recipe } from "../../../contracts/types";
import { createShare, getShare } from "./api";
import { sanitizeRecipe } from "./config";

/** The share code in the current address, if any. */
export const shareCodeInUrl = (loc: Location = location) =>
  loc.pathname.match(/^\/s\/([\w-]+)/)?.[1] ?? new URLSearchParams(loc.search).get("r");

/** The share code in a link that opened the app: https://<site>/s/<code>, qurandesign://s/<code>, or …?r=<code>. */
export function shareCodeOf(url: URL | null): string | null {
  if (!url) return null;
  // The app's scheme is read from the text: older WebViews do not split qurandesign://s/<code> into host and path.
  const path = /^https?:$/.test(url.protocol) ? url.pathname : `/${url.href.slice(url.protocol.length).replace(/^\/+/, "")}`;
  return path.match(/^\/s\/([\w-]+)/)?.[1] ?? url.searchParams.get("r");
}

/** The design behind a share code (checked and clamped like any input). */
export async function loadShared(code: string): Promise<Recipe> {
  const { recipe } = await getShare(code);
  return sanitizeRecipe(recipe);
}

/** Creates a link. The preview image is optional: the link still works without it. */
export async function createLink(recipe: Recipe, preview: () => Promise<string | undefined>): Promise<string> {
  const og = await preview().catch(() => undefined);
  return (await createShare(structuredClone(recipe), og)).url;
}
