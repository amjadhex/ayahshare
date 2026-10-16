// The export in progress lives here, above the Export sheet, so it keeps running (and its result stays) when the
// sheet is closed. The engine (src/export) and its encoders load only on the first export or link.
// Exports started on the Share screen (source "share") keep their file there: that screen sends it on (share menu,
// save, link) and shows the status itself. Every completed share, saved file and copied link counts for the streak.
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Recipe } from "../../../../contracts/types";
import { autoSave, toast } from "../actions";
import { track } from "../analytics";
import { clipById, ensureClip, getAyahText } from "../api";
import { sanitizeRecipe } from "../config";
import { clampRange, designProps, fileName, stripBasmala, translationLang } from "../design";
import type { ExportScene, Phase } from "../export";
import { platform } from "../platform";
import { getRoute, openSheet } from "../router";
import { createLink } from "../share";
import type { AppState } from "../state";
import { hdFor, type Purpose } from "../prefs";
import { madeFromLink } from "../stats";
import { recordDay } from "../streak";
import { t } from "../strings";
import { holdUpdates } from "../update";
import { coarsePointer, useStore } from "./hooks";

export type Kind = "video" | "image";
/** `source`: the feed reel being exported (its share button shows the progress), a saved design ("saved:…"), or
 *  "share" (the Share screen); none = the design in Create. */
export type Job =
  | { phase: "idle" }
  /** `scene`: what is being made (the Export sheet shows its picture and quality). */
  | { phase: "busy"; kind: Kind; pct: number; label: string; source?: string; scene?: ExportScene }
  | { phase: "ready"; kind: Kind; file: File; recipe: Recipe; scene: ExportScene; source?: string };

/** What became of a file sent to the share menu: shared, closed without sharing, refused because the browser wants a
 *  fresh tap first (only when `auto`), or saved instead because no share menu could take it (or neither worked). */
export type ShareResult = "shared" | "closed" | "blocked" | "saved" | "failed";

export interface ExportApi {
  job: Job;
  /** Status line shown with the export controls. */
  status: string;
  linkBusy: boolean;
  /** What an export of the design in Create is for, by default: sending it on (phones and touch screens, where the
   *  share menu follows) or saving it (a computer downloads it at once). Sets its quality (prefs.ts hdFor). */
  purpose: Purpose;
  /** Exports the design in Create, or `scene` (a feed reel or a saved design, named by `source`). True when the file
   *  was made. `save`: the file goes straight to the device (download / Photos) instead of the share and save buttons. */
  video(scene?: ExportScene | null, source?: string, opts?: { save?: boolean }): Promise<boolean>;
  image(scene?: ExportScene | null, source?: string, opts?: { save?: boolean }): Promise<boolean>;
  cancel(): void;
  /** Opens the share menu with the finished file. `auto`: not straight after a tap (the browser may refuse). */
  shareFile(opts?: { auto?: boolean }): Promise<ShareResult>;
  /** Saves the finished file to the device. True when saved. */
  saveFile(): Promise<boolean>;
  dismiss(): void;
  /** A link to the design in Create, or to `scene` (the file just made, a saved design named by `source`). Touch
   *  screens open the share menu with it unless `mode` is "copy". True when shared or copied. */
  shareLink(scene?: ExportScene, source?: string, mode?: "share" | "copy"): Promise<boolean>;
}

const Ctx = createContext<ExportApi | null>(null);
export function useExport() {
  const api = useContext(Ctx);
  if (!api) throw new Error("no export provider");
  return api;
}

const engine = () => import("../export");
/** What is said once a file is saved to the device (web: the file's name; app: where it went). */
const savedText = (name: string) => (platform.kind === "ios" ? t.savedToPhotos : platform.kind === "android" ? t.savedToGallery : t.saved(name));

/** No progress at all for this long gives the export up, whatever it is waiting for (the engine's own watchdogs cover
 *  the encoders; this covers everything else, so no export can stay busy for ever). */
export const JOB_STALL_MS = 60_000;

/** Ties an export to its controller: `until` ends any step at once when the export is canceled or given up; `watch`
 *  (on every bit of progress) restarts the countdown to giving up. */
function guard(controller: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const g = {
    stalled: false,
    stop: new Promise<never>((_, reject) => controller.signal.addEventListener("abort",
      () => reject(g.stalled ? new Error("stalled") : new DOMException("canceled", "AbortError")), { once: true })),
    until: <T,>(p: Promise<T>) => Promise.race([p, g.stop]),
    watch() { clearTimeout(timer); timer = setTimeout(() => { g.stalled = true; controller.abort(); }, JOB_STALL_MS); },
    end() { clearTimeout(timer); },
  };
  g.stop.catch(() => {});
  return g;
}

/** An audio context started inside the tap, for the real-time recorder (src/export/recorder.ts): Safari keeps one made
 *  later, without a tap, suspended, and its clock then never moves. null where the browser has none. */
function audioInTap(): AudioContext | null {
  if (typeof AudioContext === "undefined" || typeof MediaRecorder === "undefined") return null;
  try {
    const ac = new AudioContext();
    void ac.resume().catch(() => {});
    // A silent sample started in the tap too: older iOS only lets the context run after that.
    const blank = ac.createBufferSource();
    blank.buffer = ac.createBuffer(1, 1, ac.sampleRate);
    blank.connect(ac.destination);
    blank.start();
    return ac;
  } catch {
    return null;
  }
}

/** The design in Create as an export scene, in the quality for `purpose`. */
export function sceneOf(s: AppState, purpose: Purpose = "share"): ExportScene | null {
  const surah = s.surahs[s.recipe.surah - 1];
  if (!surah || !s.ayahs.length || s.loading) return null;
  const bg = s.recipe.bg;
  return {
    recipe: s.recipe, surah, lang: translationLang(s.recipe.translation, s.editions), brand: s.config.appName, ayahs: s.ayahs,
    current: Math.min(s.current, s.ayahs.length - 1), section: s.section, clip: bg.type === "clip" ? clipById(bg.id) : null, hd: hdFor(s.hd, purpose),
  };
}

/** A still of the design (the ayah on screen, at thumbnail size), as the export engine draws it. */
export const stillOf = (scene: ExportScene) => engine().then((m) => m.thumbnail(scene, scene.current, scene.section));

/** The export scene of a saved design: its text loaded again, its clip in the catalogue. null when it cannot load. */
export async function sceneFromRecipe(s: AppState, recipe: Recipe, purpose: Purpose = "share"): Promise<ExportScene | null> {
  const r = clampRange(sanitizeRecipe(recipe), s.surahs), surah = s.surahs[r.surah - 1];
  if (!surah) return null;
  const [[ar, tr]] = await Promise.all([getAyahText(r.surah, r.from, r.to, r.translation), r.bg.type === "clip" ? ensureClip(r.bg.id) : null]);
  const ayahs = ar.ayahs.map((a, i) => ({ num: a.numberInSurah, ar: stripBasmala(a.text, r.surah, a.numberInSurah), tr: tr ? tr.ayahs[i].text : "" }));
  return {
    recipe: r, surah, lang: translationLang(r.translation, s.editions), brand: s.config.appName, ayahs, current: 0,
    clip: r.bg.type === "clip" ? clipById(r.bg.id) : null, hd: hdFor(s.hd, purpose),
  };
}

/** `phone` changes how a finished file is delivered: phones always get Share / Save / Copy link; larger screens
 *  download at once unless the system share sheet can take the file (touch screens). */
export function ExportProvider({ phone, children }: { phone: boolean; children: ReactNode }) {
  const store = useStore();
  const [job, setJobState] = useState<Job>({ phase: "idle" });
  const [status, setStatus] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const busy = useRef<AbortController | null>(null);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const jobRef = useRef(job);
  jobRef.current = job;
  /** What an export with no scene given is for (see ExportApi.purpose). */
  const purposeOf = (): Purpose => (phoneRef.current || coarsePointer() ? "share" : "save");
  /** The job changes at once for the methods below too (the Share screen sends a file on as soon as it is made). */
  const setJob = (next: Job) => { jobRef.current = next; setJobState(next); };

  const api = useMemo<ExportApi>(() => {
    // Exports, links and their analytics use the design as it was when the button was pressed (sceneOf), not whatever
    // is being edited while the export runs.
    /** Status for the export controls, and a toast when they are not on screen (phones without the Export sheet open,
     *  the feed, which has no export controls of its own, and Saved, whose cards start exports: `source` "saved:…"). */
    const say = (text: string, source?: string) => {
      setStatus(text);
      const view = getRoute().view;
      if (view === "share") return; // the Share screen shows the status itself
      if ((phoneRef.current && getRoute().sheet !== "export") || view === "feed" || source?.startsWith("saved:")) toast(store, text);
    };

    /** Saves to the device (web: download; app: Photos / Gallery) and says where it went. */
    async function saveToDevice(file: File) {
      try {
        await platform.saveFile(file, file.name);
        setStatus(savedText(file.name));
        if (platform.kind !== "web") platform.haptic("success");
        recordDay();
        return true;
      } catch {
        setStatus(t.saveDenied);
        return false;
      }
    }

    async function deliver(blob: Blob, name: string, kind: Kind, scene: ExportScene, source?: string, save?: boolean) {
      madeFromLink(scene.recipe);
      const file = new File([blob], name, { type: blob.type });
      const recipe = scene.recipe;
      if (!save && (source === "share" || phoneRef.current || (coarsePointer() && platform.canShareFile(file)))) {
        // Sharing needs a fresh tap, so the share sheet opens from the "ready" buttons.
        setJob({ phase: "ready", kind, file, recipe, scene, source });
        setStatus(t.ready);
        platform.haptic("success");
        if (source === "share") return; // the Share screen sends it on
        const view = getRoute().view;
        if (getRoute().sheet !== "export") {
          if (view === "create" || view === "share" || view === "feed" || view === "profile") openSheet("export"); else toast(store, t.fileReady);
        }
      } else {
        setJob({ phase: "idle" });
        try { await platform.saveFile(file, name); } catch { say(t.saveDenied, source); return; }
        say(savedText(name), source);
        if (platform.kind !== "web") platform.haptic("success");
        recordDay();
      }
    }

    return {
      job: { phase: "idle" }, status: "", linkBusy: false, purpose: "share",

      async video(given, source, opts) {
        const first = given ?? sceneOf(store.getState(), opts?.save ? "save" : purposeOf());
        if (busy.current || !first) return false;
        // Before anything is awaited, so still inside the tap: Safari keeps a context made later suspended.
        const audio = audioInTap();
        const controller = (busy.current = new AbortController()), started = performance.now();
        const release = holdUpdates(); // no reload into a new version mid-export
        const run = guard(controller);
        let scene = first;
        const props = designProps(scene.recipe);
        try {
          const { canExportVideo, exportVideo } = await run.until(engine());
          if (!canExportVideo()) {
            say(t.imageOnly, source);
            track("export_failed", { ...props, kind: "video", reason: "unsupported" });
            return false;
          }
          store.dispatch({ type: "play", on: false });
          setJob({ phase: "busy", kind: "video", pct: 0, label: t.preparing, source, scene });
          setStatus(t.preparing);
          track("export_start", { ...props, kind: "video" });
          run.watch();
          const labels: Record<Phase, (pct: number) => string> = { preparing: () => t.preparing, rendering: t.rendering, recording: t.recording };
          let silent = false;
          const recording = { audio, onSilent: () => { if (!silent && !controller.signal.aborted) { silent = true; toast(store, t.videoNoSound); } } };
          const make = (s: ExportScene) => run.until(exportVideo(s, controller.signal, (p, phase) => {
            if (controller.signal.aborted) return; // canceled or given up: late progress must not bring the job back
            run.watch();
            const pct = Math.round(Math.min(1, Math.max(0, p)) * 100);
            setJob({ phase: "busy", kind: "video", pct, label: labels[phase](pct), source, scene: s });
          }, recording));
          let blob: Blob;
          try {
            blob = await make(scene);
          } catch (e) {
            if (controller.signal.aborted || !scene.hd) throw e;
            // HD did not work here (the encoder's size limit, or a phone's memory): the Standard file instead.
            track("export_failed", { ...props, kind: "video", reason: `hd: ${(e as Error).message}` });
            toast(store, t.hdFallback);
            scene = { ...scene, hd: false };
            setJob({ phase: "busy", kind: "video", pct: 0, label: t.preparing, source, scene });
            run.watch();
            blob = await make(scene);
          }
          run.end();
          const ext = blob.type === "video/webm" ? "webm" : "mp4";
          track("export_done", { ...props, kind: "video", ms: Math.round(performance.now() - started), bytes: blob.size });
          void autoSave(store, scene.recipe, scene.surah, "video", () => engine().then((m) => m.thumbnail(scene, 0)));
          await deliver(blob, `${fileName(scene.recipe)}.${ext}`, "video", scene, source, opts?.save);
          return true;
        } catch (e) {
          if (busy.current !== controller) return false; // canceled: cancel() has already cleared the job
          setJob({ phase: "idle" });
          // Every way of making it (the worker in HD and Standard, then the real-time recorder) failed or stalled.
          setStatus(t.videoFailed);
          toast(store, t.videoFailed);
          track("export_failed", { ...props, kind: "video", reason: run.stalled ? "stalled" : (e as Error).message });
          return false;
        } finally {
          run.end();
          release();
          void audio?.close().catch(() => {});
          if (busy.current === controller) busy.current = null;
        }
      },

      async image(given, source, opts) {
        let scene = given ?? sceneOf(store.getState(), purposeOf());
        if (busy.current || !scene) return false;
        const props = designProps(scene.recipe);
        const controller = (busy.current = new AbortController());
        const release = holdUpdates();
        const run = guard(controller);
        const started = performance.now();
        setJob({ phase: "busy", kind: "image", pct: 0, label: t.makingImage, source, scene });
        setStatus(t.makingImage);
        track("export_start", { ...props, kind: "image" });
        try {
          const { exportImage } = await run.until(engine());
          let blob: Blob;
          try {
            blob = await run.until(exportImage(scene));
          } catch (e) {
            if (controller.signal.aborted || !scene.hd) throw e;
            // An HD image too large for this device's canvas or memory: the Standard one instead.
            track("export_failed", { ...props, kind: "image", reason: `hd: ${(e as Error).message}` });
            toast(store, t.hdFallback);
            scene = { ...scene, hd: false };
            blob = await run.until(exportImage(scene));
          }
          track("export_done", { ...props, kind: "image", ms: Math.round(performance.now() - started), bytes: blob.size });
          const shown = scene.ayahs.length > 1 ? scene.ayahs[scene.current].num : undefined;
          // Saved as the design of the ayah in the image, so "Download again" makes the same picture.
          const one: ExportScene = shown === undefined ? scene
            : { ...scene, recipe: { ...scene.recipe, from: shown, to: shown }, ayahs: [scene.ayahs[scene.current]], current: 0 };
          void autoSave(store, one.recipe, one.surah, "image", () => engine().then((m) => m.thumbnail(one, 0)));
          await deliver(blob, `${fileName(scene.recipe, shown)}.jpg`, "image", scene, source, opts?.save);
          return true;
        } catch (e) {
          if (busy.current !== controller) return false; // canceled
          setJob({ phase: "idle" });
          say(t.imageFailed, source);
          track("export_failed", { ...props, kind: "image", reason: (e as Error).message });
          return false;
        } finally {
          run.end();
          release();
          if (busy.current === controller) busy.current = null;
        }
      },

      /** Ends the export at once, whatever it is waiting for: the engine tears down its worker, recorder and audio
       *  (they listen to the signal), and the job is idle again, so another export can start straight away. */
      cancel() {
        const controller = busy.current, current = jobRef.current;
        if (!controller) return;
        busy.current = null;
        controller.abort();
        setJob({ phase: "idle" });
        say(t.canceled, current.phase === "busy" ? current.source : undefined);
      },

      async shareFile({ auto = false } = {}) {
        const current = jobRef.current;
        if (current.phase !== "ready") return "failed";
        try {
          if (await platform.shareFile(current.file)) {
            track("share_native", { ...designProps(current.recipe), kind: current.kind });
            recordDay();
            // The Share screen keeps the file, so it can be sent somewhere else too.
            if (current.source !== "share") { setJob({ phase: "idle" }); setStatus(""); }
            return "shared";
          }
          return "closed";
        } catch (e) {
          if (auto && (e as Error)?.name === "NotAllowedError") return "blocked"; // the share menu needs a fresh tap
          // no share sheet for this file: save it instead
          return (await saveToDevice(current.file)) ? "saved" : "failed";
        }
      },

      async saveFile() {
        const current = jobRef.current;
        return current.phase === "ready" ? saveToDevice(current.file) : false;
      },

      dismiss() { setJob({ phase: "idle" }); setStatus(""); },

      async shareLink(given, source, mode = "share") {
        const scene = given ?? sceneOf(store.getState());
        if (!scene) return false;
        const props = designProps(scene.recipe);
        setLinkBusy(true);
        const link = createLink(scene.recipe, () => engine().then((m) => m.previewImage(scene)));
        link.then(() => { madeFromLink(scene.recipe); return autoSave(store, scene.recipe, scene.surah, "link", () => engine().then((m) => m.thumbnail(scene, 0))); }, () => {}); // failure handled below
        try {
          if (mode === "share" && coarsePointer() && platform.canShareLink()) {
            const url = await link;
            try {
              const shared = await platform.shareLink(url, store.getState().config.appName);
              if (shared) { track("share_native", props); recordDay(); }
              return shared;
            } catch { /* no share sheet: copy instead */ }
          }
          try {
            await platform.copyText(link);
            say(t.linkCopied, source);
            track("link_copy", props);
            recordDay();
            return true;
          } catch {
            say(await link, source); // clipboard blocked: show the link so it can be copied by hand
            return false;
          }
        } catch {
          say(t.linkFailed, source);
          return false;
        } finally {
          setLinkBusy(false);
        }
      },

    };
  }, [store]);

  const purpose: Purpose = phone || coarsePointer() ? "share" : "save";
  const value = useMemo(() => ({ ...api, job, status, linkBusy, purpose }), [api, job, status, linkBusy, purpose]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
