// Share (Share v2): the still with Edit on its corner, "Video · 9:16", then Share (the file to the share menu), Save to
// phone with its HD toggle, and Copy link. Making: the ring with the percentage and Cancel. Ready: ✓ what happened, the
// signed-in or signed-out line, Make another, Edit again and Share again. Waiting (the share menu needs a tap) and the
// image instead of a video this device cannot make. The export engine, the network and analytics are stand-ins; the
// export job, store and router are the real ones, and the platform's share / save / copy are watched.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Surah } from "../../../../../contracts/types";
import surahList from "../../../public/data/surahs.json";
import { platform } from "../../platform";
import { getRoute, initRouter, navigate } from "../../router";
import { createStore, type Store } from "../../state";
import { getStreak, resetStreak } from "../../streak";
import { t } from "../../strings";
import { ExportProvider } from "../exportJob";
import { StoreContext } from "../hooks";
import { Share } from "./Share";

vi.mock("../../analytics", () => ({ anon: "test-anon", flush: () => {}, newDevice: () => {}, track: () => {} }));
const engine = vi.hoisted(() => ({
  video: true,
  canExportVideo: () => engine.video,
  exportImage: vi.fn(async (_s: unknown) => new Blob(["jpg"], { type: "image/jpeg" })),
  exportVideo: vi.fn(async (_s: unknown, _signal: AbortSignal, _p: (n: number, phase: string) => void) => new Blob(["mp4"], { type: "video/mp4" })),
  previewImage: vi.fn(async () => undefined),
  thumbnail: vi.fn(async () => new Blob([new Uint8Array([0xff, 0xd8])], { type: "image/jpeg" })),
}));
vi.mock("../../export", () => engine);
vi.mock("../../stats", () => ({
  ayahStats: vi.fn(async () => new Map()),
  formatCount: (n: number) => String(n),
  madeFromLink: () => {}, // the export job counts designs made from an opened link
}));
vi.mock("../../api", () => ({
  clipById: () => null,
  clipUrl: () => "",
  ensureClip: async () => {},
  createShare: async () => ({ code: "abc", url: "https://example.test/s/abc" }),
  saveCreation: async () => ({}),
}));

// The machine may be busy with other test runs: generous timeouts.
vi.setConfig({ testTimeout: 30_000 });

const surahs = surahList as Surah[];
let store: Store;

/** The Share screen, reached from the editor, with a design of `ayahs` ayahs loaded. `signInOffered`: the app offers
 *  sign-in (signed out, the personal line is then the invitation to log in). */
function start({ width = 390, ayahs = 1, signInOffered = false } = {}) {
  window.__width = width;
  history.replaceState(null, "", "/create");
  initRouter();
  navigate("share");
  store = createStore();
  store.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId: signInOffered ? "client-id" : null, mediaBase: "/media/" }, surahs, recipe: null });
  store.dispatch({ type: "select", surah: 94, from: 5, to: 4 + ayahs });
  store.dispatch({ type: "ayahs", ayahs: Array.from({ length: ayahs }, (_, i) => ({ num: 5 + i, ar: `نص ${5 + i}`, tr: `Text ${5 + i}` })) });
  render(
    <StoreContext.Provider value={store}>
      <ExportProvider phone={width < 760}><Share active /></ExportProvider>
    </StoreContext.Provider>,
  );
}
const button = (name: string) => screen.getByRole("button", { name });
const hdOf = (k: number) => ((engine.exportVideo.mock.calls[k] as unknown[])[0] as { hd: boolean }).hd;
const notAllowed = () => Object.assign(new Error("needs a tap"), { name: "NotAllowedError" });

beforeEach(() => {
  localStorage.clear();
  resetStreak();
  engine.video = true;
  vi.spyOn(platform, "canShareFile").mockReturnValue(true);
  vi.spyOn(platform, "shareFile").mockResolvedValue(true);
  vi.spyOn(platform, "saveFile").mockResolvedValue();
  vi.spyOn(platform, "copyText").mockResolvedValue();
});
afterEach(() => { vi.restoreAllMocks(); engine.exportVideo.mockClear(); engine.exportImage.mockClear(); });

describe("Share (phone): choose", () => {
  it("shows the still with Edit on it, the caption and three actions; nothing is made before one is tapped", async () => {
    start();
    expect(screen.getByRole("heading", { level: 1, name: "Share" })).toBeTruthy();
    expect(await screen.findByRole("img", { name: "نص 5 Text 5" })).toBeTruthy();
    expect(engine.thumbnail).toHaveBeenCalledWith(expect.objectContaining({ current: 0, section: 0 }), 0, 0);
    expect(screen.getByText("Video · 9:16")).toBeTruthy();
    expect(button("Edit")).toBeTruthy();
    expect(button("Share")).toBeTruthy();
    expect(button("Save to phone")).toBeTruthy();
    expect(button("HD quality")).toBeTruthy();
    expect(button("Copy link")).toBeTruthy();
    // Only the new design's actions: no list of apps, no Video / Image switch.
    expect(screen.queryByRole("button", { name: "WhatsApp" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Image" })).toBeNull();
    expect(engine.exportVideo).not.toHaveBeenCalled();
    expect(engine.exportImage).not.toHaveBeenCalled();
  });

  it("an image chosen in the editor's Format card: the caption says so and Save makes the image of the ayah on screen", async () => {
    const user = userEvent.setup();
    start({ ayahs: 2 });
    act(() => { store.dispatch({ type: "format", format: "image" }); store.dispatch({ type: "goTo", index: 1 }); });
    expect(screen.getByText("Image · 9:16")).toBeTruthy();
    await user.click(button("Save to phone"));
    await waitFor(() => expect(engine.exportImage).toHaveBeenCalledWith(expect.objectContaining({ current: 1 })));
    expect(engine.exportVideo).not.toHaveBeenCalled();
  });

  it("HD toggle: on by default (Save keeps HD) while Share sends Standard; turning it off or on picks one quality for both, remembered", async () => {
    const user = userEvent.setup();
    start();
    expect(button("HD quality").getAttribute("aria-pressed")).toBe("true");
    expect(store.getState().hd).toBeNull();

    await user.click(button("Share"));
    expect(await screen.findByText("Shared")).toBeTruthy();
    expect(hdOf(0)).toBe(false); // nothing picked: the share is Standard
    await user.click(button("Share again"));
    await user.click(button("Save to phone"));
    expect(await screen.findByText("Saved to your phone")).toBeTruthy();
    expect(engine.exportVideo).toHaveBeenCalledTimes(2); // a new file: the saved one is HD
    expect(hdOf(1)).toBe(true);

    await user.click(button("Share again"));
    await user.click(button("HD quality"));
    expect(button("HD quality").getAttribute("aria-pressed")).toBe("false");
    expect(store.getState().hd).toBe(false);
    expect(localStorage.getItem("qd.hd")).toBe("false");
    await user.click(button("Save to phone"));
    expect(await screen.findByText("Saved to your phone")).toBeTruthy();
    expect(hdOf(2)).toBe(false); // Standard for Save too now

    await user.click(button("Share again"));
    await user.click(button("HD quality"));
    expect(localStorage.getItem("qd.hd")).toBe("true");
    await user.click(button("Share"));
    expect(await screen.findByText("Shared")).toBeTruthy();
    expect(engine.exportVideo).toHaveBeenCalledTimes(4);
    expect(hdOf(3)).toBe(true); // HD for Share too
  });

  it("Copy link copies a link (no file is made) and says so", async () => {
    const user = userEvent.setup();
    start();
    await user.click(button("Copy link"));
    expect(await screen.findByText("Link copied")).toBeTruthy();
    expect(platform.copyText).toHaveBeenCalled();
    expect(engine.exportVideo).not.toHaveBeenCalled();
    expect(getStreak()).toMatchObject({ days: 1, today: true });
  });

  it("Edit goes back to the editor, as does the back button", async () => {
    const user = userEvent.setup();
    start();
    await user.click(button("Edit"));
    await waitFor(() => expect(getRoute().view).toBe("create"));
    act(() => navigate("share"));
    await user.click(button("Back to editor"));
    await waitFor(() => expect(getRoute().view).toBe("create"));
  });
});

describe("Share (phone): making and ready", () => {
  it("making: the ring with the percentage, one line and Cancel; Cancel returns to the choices", async () => {
    const user = userEvent.setup();
    start();
    engine.exportVideo.mockImplementationOnce((_s, signal, progress) => new Promise<Blob>((_, reject) => {
      progress(0.42, "rendering");
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    await user.click(button("Share"));
    const ring = await screen.findByRole("progressbar", { name: "Making your video…" });
    expect(ring.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Making your video…");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull(); // not while making
    await user.click(button("Cancel"));
    expect(await screen.findByText("Canceled")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(button("Share")).toHaveProperty("disabled", false);
    expect(screen.queryByRole("alert")).toBeNull(); // canceled is not a failure
    expect(platform.shareFile).not.toHaveBeenCalled();
  });

  it("ready after Share: ✓ Shared, the streak line (signed in), Share again reuses the file, Make another goes Home", async () => {
    const user = userEvent.setup();
    start();
    await user.click(button("Share"));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Shared");
    expect(platform.shareFile).toHaveBeenCalledWith(expect.objectContaining({ name: "ayah-94-5.mp4" }));
    expect(screen.getByText("In your profile · 1-day streak, done for today")).toBeTruthy();
    expect(button("Make another")).toBeTruthy();
    expect(button("Edit again")).toBeTruthy();

    await user.click(button("Share again"));
    await user.click(button("Share"));
    expect(await screen.findByText("Shared")).toBeTruthy();
    expect(engine.exportVideo).toHaveBeenCalledTimes(1); // the same file, sent again
    expect(platform.shareFile).toHaveBeenCalledTimes(2);
    await user.click(button("Make another"));
    await waitFor(() => expect(getRoute().view).toBe("find"));
  });

  it("Edit again goes back to the editor", async () => {
    const user = userEvent.setup();
    start();
    await user.click(button("Save to phone"));
    expect(await screen.findByText("Saved to your phone")).toBeTruthy();
    expect(platform.saveFile).toHaveBeenCalledWith(expect.objectContaining({ name: "ayah-94-5.mp4" }), "ayah-94-5.mp4");
    expect(platform.shareFile).not.toHaveBeenCalled();
    await user.click(button("Edit again"));
    await waitFor(() => expect(getRoute().view).toBe("create"));
  });

  it("signed out (where sign-in is offered): kept on this device, and Log in opens the login page", async () => {
    const user = userEvent.setup();
    start({ signInOffered: true });
    await user.click(button("Share"));
    expect(await screen.findByText("Shared")).toBeTruthy();
    expect(screen.queryByText(/In your profile/)).toBeNull();
    expect(screen.getByText((_, el) => el?.className === "share-line" && el.textContent === "Kept on this device · Log in to keep it")).toBeTruthy();
    await user.click(button("Log in"));
    expect(getRoute().view).toBe("login");
  });

  it("signed in: the profile line with the streak", async () => {
    const user = userEvent.setup();
    start({ signInOffered: true });
    act(() => store.dispatch({ type: "me", me: { id: "u1", name: "Amjad", email: "a@example.test", avatar: null } }));
    await user.click(button("Copy link"));
    expect(await screen.findByText("Link copied")).toBeTruthy();
    expect(screen.getByText("In your profile · 1-day streak, done for today")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
  });

  it("when the share menu needs a fresh tap, the ready file waits for one (or is saved instead)", async () => {
    const user = userEvent.setup();
    vi.mocked(platform.shareFile).mockRejectedValueOnce(notAllowed());
    start();
    await user.click(button("Share"));
    expect(await screen.findByText("Your file is ready")).toBeTruthy();
    expect(button("Save to phone instead")).toBeTruthy();
    expect(platform.saveFile).not.toHaveBeenCalled();
    await user.click(button("Open the share menu"));
    expect(await screen.findByText("Shared")).toBeTruthy();
    expect(engine.exportVideo).toHaveBeenCalledTimes(1);
  });

  it("a browser without a share menu for files saves the file instead", async () => {
    const user = userEvent.setup();
    vi.mocked(platform.canShareFile).mockReturnValue(false);
    vi.mocked(platform.shareFile).mockRejectedValue(new TypeError("no share"));
    start();
    await user.click(button("Share"));
    expect(await screen.findByText("Saved to your phone")).toBeTruthy();
    expect(platform.saveFile).toHaveBeenCalledWith(expect.objectContaining({ name: "ayah-94-5.mp4" }), "ayah-94-5.mp4");
  });
});

describe("Share (phone): error", () => {
  it("a video this device cannot make offers the image (the ayah on screen); Back returns to the choices", async () => {
    const user = userEvent.setup();
    engine.video = false;
    start({ ayahs: 3 });
    act(() => store.dispatch({ type: "goTo", index: 1 }));
    await user.click(button("Save to phone"));
    expect((await screen.findByRole("alert")).textContent).toBe(t.exportFailed);
    await user.click(button("Back"));
    expect(button("Share")).toBeTruthy();

    await user.click(button("Save to phone"));
    await user.click(await screen.findByRole("button", { name: "Make the image" }));
    expect(await screen.findByText("Saved to your phone")).toBeTruthy();
    expect(engine.exportImage).toHaveBeenCalledTimes(1);
    expect(engine.exportImage).toHaveBeenCalledWith(expect.objectContaining({ current: 1, hd: true }));
    expect(platform.saveFile).toHaveBeenCalledWith(expect.objectContaining({ name: "ayah-94-6.jpg" }), "ayah-94-6.jpg");
    expect(screen.getByText("Image · 9:16")).toBeTruthy();
  });
});

describe("Share (computer)", () => {
  it("the same actions beside the still; Save says the device and downloads the file", async () => {
    const user = userEvent.setup();
    start({ width: 1440 });
    await user.click(button("Save to device"));
    expect(await screen.findByText("Saved to your device")).toBeTruthy();
    expect(platform.saveFile).toHaveBeenCalledWith(expect.objectContaining({ name: "ayah-94-5.mp4" }), "ayah-94-5.mp4");
  });
});
