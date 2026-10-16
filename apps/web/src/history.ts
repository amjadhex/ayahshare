// Designs saved on this device while signed out (Saved): the last 50 exports and share links, each with a small
// thumbnail, in IndexedDB. After sign-in the app offers to move them to the account. The exported files themselves are
// never kept; "Download again" renders them again from the recipe. Falls back to memory (this visit only) where
// IndexedDB is not available (private windows in some browsers, tests). Framework-free.
import type { CreationKind, Recipe } from "../../../contracts/types";
import { sanitizeRecipe } from "./config";

export interface DeviceDesign {
  id: string;
  recipe: Recipe;
  title: string;
  kind: CreationKind;
  created_at: number;
  updated_at: number;
  thumb: Blob | null;
}

export const MAX_DEVICE = 50;
const DB = "qd", STORE = "designs";
/** A design saved again as a link keeps its video / image kind (as the account does). */
const RANK: Record<CreationKind, number> = { link: 0, image: 1, video: 1 };

/** The same design compares equal however it was written (sanitizeRecipe fixes the key order and the defaults). */
export const recipeKey = (r: Recipe) => JSON.stringify(sanitizeRecipe(r));

let memory: Map<string, DeviceDesign> | null = null;
let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  return (opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function all(): Promise<DeviceDesign[]> {
  const db = await open();
  if (!db) return [...(memory ??= new Map()).values()];
  try {
    return ((await tx<DeviceDesign[]>(db, "readonly", (s) => s.getAll() as IDBRequest<DeviceDesign[]>)) ?? []);
  } catch {
    return [];
  }
}

async function put(d: DeviceDesign) {
  const db = await open();
  if (!db) return void (memory ??= new Map()).set(d.id, d);
  await tx(db, "readwrite", (s) => void s.put(d));
}

/** Newest first. Recipes read in the current form (designs saved by an older version: newer fields get their defaults,
 *  the removed typewriter animation reads as fade). */
export async function listDevice(): Promise<DeviceDesign[]> {
  return (await all()).map((d) => ({ ...d, recipe: sanitizeRecipe(d.recipe) })).sort((a, b) => b.updated_at - a.updated_at);
}

/** Saves a design (an identical one is updated instead of copied); keeps the newest MAX_DEVICE. */
export async function saveDevice(d: { recipe: Recipe; title: string; kind: CreationKind; thumb: Blob | null }, now = Date.now()): Promise<DeviceDesign> {
  const list = await listDevice();
  const key = recipeKey(d.recipe);
  const same = list.find((x) => recipeKey(x.recipe) === key);
  const saved: DeviceDesign = same
    ? { ...same, title: d.title || same.title, kind: RANK[d.kind] >= RANK[same.kind] ? d.kind : same.kind, updated_at: now, thumb: d.thumb ?? same.thumb }
    : { id: crypto.randomUUID(), recipe: sanitizeRecipe(d.recipe), title: d.title, kind: d.kind, created_at: now, updated_at: now, thumb: d.thumb };
  await put(saved);
  const rest = list.filter((x) => x.id !== saved.id);
  for (const old of rest.slice(MAX_DEVICE - 1)) await removeDevice(old.id);
  return saved;
}

export async function removeDevice(id: string): Promise<void> {
  const db = await open();
  if (!db) return void memory?.delete(id);
  await tx(db, "readwrite", (s) => void s.delete(id)).catch(() => {});
}

/** Forget everything (tests). */
export async function clearDevice(): Promise<void> {
  memory = null;
  const db = await open();
  if (db) await tx(db, "readwrite", (s) => void s.clear()).catch(() => {});
}
