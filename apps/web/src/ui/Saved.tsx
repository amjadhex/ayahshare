// Saved designs and saved ayahs, shown on the Profile screen (screens/ProfileScreen.tsx). Every design that was exported
// (video or image) or shared as a link is saved automatically — with the account when signed in, else on this device
// (history.ts). useSaved loads them, carries out a deletion once its undo time has passed and, signed in, moves designs
// kept on the device to the account by itself; CreationSheet offers Open in Create · Download again · Share link · Delete;
// SavedAyahs lists the favourite ayahs. Styles: screens/profile.css.
import { useEffect, useId, useMemo, useRef, useState, type JSX } from "react";
import type { Creation, CreationKind, Recipe, Ref } from "../../../../contracts/types";
import { deleteSaved, moveDeviceDesigns, openCreation, selectAyahs, toast, toggleFavourite } from "../actions";
import * as api from "../api";
import { backgroundFor, loadText } from "../discover";
import { apiBase, request } from "../endpoint";
import { listDevice, type DeviceDesign } from "../history";
import { navigate } from "../router";
import { t } from "../strings";
import { sceneFromRecipe, useExport } from "./exportJob";
import { quietFocus } from "./focus";
import { useAppState, useStore } from "./hooks";
import { BookmarkIcon, CloseIcon, DownloadIcon, ImageIcon, LinkIcon, NextIcon, OpenIcon, PlayIcon, ShareIcon, TrashIcon, VideoIcon } from "./icons";

/** One saved design, from the account or from this device. */
export interface Item {
  id: string;
  where: "account" | "device";
  title: string;
  kind: CreationKind;
  recipe: Recipe;
  at: number;
  /** Account: the thumbnail's API path; device: the stored image. */
  thumb: string | Blob | null;
}

export const KIND: Record<CreationKind, [label: string, Icon: () => JSX.Element]> = {
  video: [t.kindVideo, VideoIcon], image: [t.kindImage, ImageIcon], link: [t.kindLink, LinkIcon],
};
const UNDO_MS = 5000;

const fromAccount = (c: Creation): Item => ({
  id: c.id, where: "account", title: c.title, kind: c.kind ?? "video", recipe: c.recipe, at: c.updated_at ?? c.created_at, thumb: c.thumb ?? null,
});
const fromDevice = (d: DeviceDesign): Item => ({ id: d.id, where: "device", title: d.title, kind: d.kind, recipe: d.recipe, at: d.updated_at, thumb: d.thumb });

/** "Today", "Yesterday", or the date. */
export function savedDate(ms: number, now = Date.now()): string {
  const day = (x: number) => new Date(x).toDateString();
  if (day(ms) === day(now)) return t.today;
  if (day(ms) === day(now - 86400_000)) return t.yesterday;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}

/** The saved designs (newest first) and what can be done with them. Loads when `active`; a deletion waits UNDO_MS for
 *  Undo, and leaving the screen (or the page) carries it out at once. */
export function useSaved(active: boolean) {
  const store = useStore();
  const { me, savedVersion } = useAppState();
  const [account, setAccount] = useState<Creation[] | null | "failed">(null);
  const [device, setDevice] = useState<DeviceDesign[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<Item | null>(null);
  const [moving, setMoving] = useState(false);
  const tried = useRef(false); // the automatic move: tried once each time the screen is shown
  const pending = useRef<{ item: Item; timer: ReturnType<typeof setTimeout> } | null>(null);

  // The account's list is the account's alone: signing out (or in as someone else) drops it, shown or not.
  const id = me?.id;
  useEffect(() => { setAccount(null); }, [id]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void listDevice().then((d) => alive && setDevice(d), () => alive && setDevice([]));
    if (me) api.getCreations().then((c) => alive && setAccount(c), () => alive && setAccount("failed"));
    else setAccount(null);
    return () => { alive = false; };
  }, [active, me, savedVersion]);

  const commit = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    setUndo(null);
    void deleteSaved(store, p.item.id, p.item.where);
  };
  useEffect(() => {
    addEventListener("pagehide", commit);
    return () => { removeEventListener("pagehide", commit); commit(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!active) commit(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (item: Item) => {
    commit();
    setHidden((h) => new Set(h).add(item.id));
    setUndo(item);
    pending.current = { item, timer: setTimeout(commit, UNDO_MS) };
  };
  const restore = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    setUndo(null);
    setHidden((h) => { const n = new Set(h); n.delete(p.item.id); return n; });
  };

  // Signed in with designs still kept on this device (made before signing in): they move to the account by themselves,
  // with a short note; no question asked. What cannot move now (offline) stays on the device and is tried again the next
  // time the screen is shown.
  const onDevice = me ? device?.length ?? 0 : 0;
  useEffect(() => { if (!active) tried.current = false; }, [active]);
  useEffect(() => {
    if (!active || !onDevice || moving || tried.current) return;
    tried.current = true;
    setMoving(true);
    void moveDeviceDesigns(store)
      .then((n) => { if (n) toast(store, t.moved(n)); }, () => {})
      .finally(() => setMoving(false));
  }, [active, onDevice, moving, store]);

  const items = useMemo(() => {
    const list = me ? (Array.isArray(account) ? account.map(fromAccount) : []) : (device ?? []).map(fromDevice);
    return list.filter((i) => !hidden.has(i.id)).sort((a, b) => b.at - a.at);
  }, [me, account, device, hidden]);

  return {
    items,
    loading: me ? account === null : device === null,
    failed: !!me && account === "failed",
    remove, restore, undo,
  };
}

/** The thumbnail as an image URL: a blob kept on the device, or the account's (the web sends its cookie with a plain
 *  image request; the iOS / Android app needs its Bearer header, so it fetches the image itself). */
function useThumb(thumb: Item["thumb"]): string | null {
  const direct = typeof thumb === "string" && !apiBase() ? thumb : null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!thumb || direct) return;
    let alive = true, made: string | null = null;
    const blob = typeof thumb === "string" ? request(thumb).then((r) => (r.ok ? r.blob() : null)) : Promise.resolve(thumb);
    void blob.then((b) => {
      if (!alive || !b) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    }, () => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [thumb, direct]);
  return direct ?? url;
}

export function Thumb({ item }: { item: Item }) {
  const url = useThumb(item.thumb);
  const [, Icon] = KIND[item.kind];
  return url
    ? <span className={`prof-img ${item.recipe.orientation}`}><img src={url} alt="" loading="lazy" decoding="async" /></span>
    : <span className="prof-img empty"><Icon /><span dir="auto">{item.title}</span></span>;
}

/** The kind badge on a grid tile: a play mark for videos, a link mark for links (images have none, like Instagram). */
export function KindBadge({ kind }: { kind: CreationKind }) {
  if (kind === "image") return null;
  return <span className="prof-badge" aria-hidden="true">{kind === "video" ? <PlayIcon /> : <LinkIcon />}</span>;
}

/** What can be done with one saved design: Open in Create · Download again · Share link · Delete. A modal <dialog>
 *  (a bottom sheet on phones); Escape, the close button and a tap outside close it. */
export function CreationSheet({ item, onClose, onDelete }: { item: Item | null; onClose: () => void; onDelete: (i: Item) => void }) {
  const store = useStore();
  const ex = useExport();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current!;
    if (item && !d.open) { d.showModal(); quietFocus(d); }
    else if (!item && d.open) d.close();
  }, [item]);

  const source = (i: Item) => `saved:${i.id}`;
  const run = (fn: (i: Item) => Promise<void> | void) => () => {
    if (!item) return;
    onClose();
    void fn(item);
  };
  const open = async (i: Item) => {
    await openCreation(store, i.recipe);
    navigate("create");
  };
  const again = async (i: Item) => {
    const scene = await sceneFromRecipe(store.getState(), i.recipe, "save").catch(() => null); // a download: HD unless picked otherwise
    if (!scene) return toast(store, t.ayahsFailed);
    if (i.kind === "image") await ex.image(scene, source(i));
    else await ex.video(scene, source(i));
  };
  const share = async (i: Item) => {
    const scene = await sceneFromRecipe(store.getState(), i.recipe).catch(() => null);
    if (!scene) return toast(store, t.ayahsFailed);
    await ex.shareLink(scene, source(i));
  };

  const i = item;
  const [kindLabel, KindIcon] = i ? KIND[i.kind] : KIND.video;
  return (
    <dialog ref={ref} className="prof-sheet" aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {i && (
        <div className="prof-sheet-body">
          <div className="prof-sheet-head">
            <span className="prof-sheet-kind"><KindIcon /></span>
            <div className="prof-sheet-who">
              <h2 id={titleId} dir="auto">{i.title}</h2>
              <p>{t.creationMeta(kindLabel, savedDate(i.at))}</p>
            </div>
            <button type="button" className="prof-icon-btn" aria-label={t.close} onClick={onClose}><CloseIcon /></button>
          </div>
          <div className="prof-sheet-actions">
            <button type="button" onClick={run(open)}><OpenIcon /><span>{t.openInCreate}</span></button>
            <button type="button" disabled={ex.job.phase === "busy"} onClick={run(again)}><DownloadIcon /><span>{t.downloadAgain}</span></button>
            <button type="button" disabled={ex.linkBusy} onClick={run(share)}><ShareIcon /><span>{t.shareSaved}</span></button>
            <button type="button" className="danger" onClick={run(onDelete)}><TrashIcon /><span>{t.deleteSaved}</span></button>
          </div>
        </div>
      )}
    </dialog>
  );
}

/** The export progress of a saved design being downloaded again (0..100), or null. */
export function useAgainProgress(item: Item): number | null {
  const ex = useExport();
  return ex.job.phase === "busy" && ex.job.source === `saved:${item.id}` ? ex.job.pct : null;
}

/** Favourite ayahs: each with its suggested background, the Arabic and the reference; opening one starts a design. */
export function SavedAyahs({ active }: { active: boolean }) {
  const store = useStore();
  const { favourites, surahs } = useAppState();
  const [texts, setTexts] = useState<Record<Ref, string>>({});
  const [thumbs, setThumbs] = useState<Record<Ref, { bg: Recipe["bg"]; url: string | null }>>({});

  useEffect(() => {
    if (!active) return;
    let alive = true;
    for (const ref of favourites) {
      if (!(ref in texts)) void loadText(ref, "none").then((x) => alive && setTexts((o) => ({ ...o, [ref]: x.ar })), () => {});
      if (!(ref in thumbs)) {
        void backgroundFor(ref).then((p) => alive && setThumbs((o) => ({ ...o, [ref]: { bg: p.bg, url: p.clip ? api.mediaUrl(p.clip.thumb) : null } })), () => {});
      }
    }
    return () => { alive = false; };
  }, [active, favourites]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!favourites.length) {
    return <div className="prof-empty small"><span className="prof-empty-icon"><BookmarkIcon /></span><p>{t.savedAyahsEmpty}</p></div>;
  }
  return (
    <ul className="prof-ayahs">
      {favourites.map((ref) => {
        const [s, a] = ref.split(":").map(Number);
        const name = surahs[s - 1]?.name_en ?? `${s}`;
        const thumb = thumbs[ref];
        return (
          <li key={ref}>
            <button type="button" className="prof-ayah" aria-label={t.openSavedAyah(name, ref)}
              onClick={() => { selectAyahs(store, s, a, a, thumb?.bg); navigate("create"); }}>
              <span className="prof-ayah-bg" style={thumb?.bg.type === "colour" ? { background: thumb.bg.colour } : undefined}>
                {thumb?.url && <img src={thumb.url} alt="" loading="lazy" decoding="async" />}
              </span>
              <span className="prof-ayah-text">
                {texts[ref] ? <span className="prof-ayah-ar" dir="rtl" lang="ar">{texts[ref]}</span> : <span className="prof-ayah-ar placeholder" />}
                <span className="prof-ayah-ref">{t.savedAyahLabel(name, ref)}</span>
              </span>
              <NextIcon />
            </button>
            <button type="button" className="prof-icon-btn prof-unsave" aria-label={t.removeSavedAyah(ref)} title={t.removeSavedAyah(ref)}
              onClick={() => void toggleFavourite(store, ref)}><BookmarkIcon /></button>
          </li>
        );
      })}
    </ul>
  );
}
