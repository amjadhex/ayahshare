// The app's platform adapter with the Capacitor plugins replaced by stand-ins: start-up (API host, saved session),
// the Android back button, deep links, sharing and saving files.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiUrl, hasSessionToken, setApiBase, setSessionToken } from "./endpoint";
import { getRoute, initRouter, navigate, openSheet } from "./router";

const cap = vi.hoisted(() => {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    listeners,
    emit: (name: string, e?: unknown) => listeners[name]?.forEach((fn) => fn(e)),
    App: {
      addListener: vi.fn(async (name: string, fn: (e: unknown) => void) => { (listeners[name] ??= []).push(fn); return { remove: async () => {} }; }),
      getLaunchUrl: vi.fn(async (): Promise<{ url: string } | undefined> => undefined),
      minimizeApp: vi.fn(async () => {}),
    },
    Preferences: {
      store: new Map<string, string>(),
      get: vi.fn(async ({ key }: { key: string }) => ({ value: cap.Preferences.store.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => void cap.Preferences.store.set(key, value)),
      remove: vi.fn(async ({ key }: { key: string }) => void cap.Preferences.store.delete(key)),
    },
    Filesystem: {
      writeFile: vi.fn(async (_o: { path: string; directory: string; recursive: boolean; data: string }) => ({ uri: "" })),
      appendFile: vi.fn(async () => {}),
      getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///cache/${path}` })),
      rmdir: vi.fn(async () => {}),
    },
    Share: { share: vi.fn(async (_o: unknown): Promise<unknown> => ({})) },
    SaveToGallery: { save: vi.fn(async () => {}) },
    SocialLogin: { login: vi.fn(async (_o: unknown): Promise<unknown> => ({})), initialize: vi.fn(async (_o: unknown) => {}) },
    MediaSession: { setMetadata: vi.fn(async (_o: unknown) => {}), setPlaybackState: vi.fn(async (_o: unknown) => {}), setActionHandler: vi.fn(async (_o: unknown, _h: unknown) => {}) },
    clearUser: vi.fn(async () => {}),
    platform: "android",
  };
});

vi.mock("@capacitor/app", () => ({ App: cap.App }));
vi.mock("@capacitor/preferences", () => ({ Preferences: cap.Preferences }));
vi.mock("@capacitor/filesystem", () => ({ Filesystem: cap.Filesystem, Directory: { Cache: "CACHE" } }));
vi.mock("@capacitor/share", () => ({ Share: cap.Share }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => cap.platform }, registerPlugin: () => cap.SaveToGallery }));
vi.mock("@capacitor/clipboard", () => ({ Clipboard: { write: vi.fn(async () => {}) } }));
vi.mock("@capacitor/haptics", () => ({ Haptics: { impact: vi.fn(async () => {}), notification: vi.fn(async () => {}) }, ImpactStyle: {}, NotificationType: {} }));
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: { hide: vi.fn(async () => {}) } }));
vi.mock("@capacitor/status-bar", () => ({ StatusBar: { setStyle: vi.fn(async () => {}) }, Style: { Dark: "DARK" } }));
vi.mock("@capgo/capacitor-media-session", () => ({ MediaSession: cap.MediaSession }));
vi.mock("@capgo/capacitor-social-login", () => ({ SocialLogin: cap.SocialLogin }));
// The offline store has its own tests (native/offline.test.ts).
vi.mock("./native/offline", () => ({ startOffline: vi.fn(async () => ({ clearUser: cap.clearUser, flush: vi.fn(async () => {}) })) }));

const { startNative } = await import("./platform-native");

beforeEach(() => {
  for (const k of Object.keys(cap.listeners)) delete cap.listeners[k];
  cap.Preferences.store.clear();
  history.replaceState(null, "", "/");
  initRouter();
});
afterEach(() => {
  cap.platform = "android";
  setApiBase("");
  setSessionToken(null);
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("app platform adapter", () => {
  it("start-up: API calls go to the Worker; a saved session is restored; sign-in stays hidden without client ids", async () => {
    cap.Preferences.store.set("qd.session", "s".repeat(43));
    const p = await startNative();
    expect(p.kind).toBe("android");
    expect(apiUrl("/api/config")).toBe("https://ayahshare.com/api/config");
    expect(hasSessionToken()).toBe(true);
    expect(p.googleSignIn.supported).toBe(false);
    await p.saveSession(null);
    expect(hasSessionToken()).toBe(false);
    expect(cap.Preferences.store.has("qd.session")).toBe(false);
    expect(cap.clearUser).toHaveBeenCalled(); // the signed-in person's offline copies go with the session
  });

  it("back button: closes the open sheet first, then goes back a screen, then leaves the app", async () => {
    await startNative();
    navigate("create");
    openSheet("background");
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.setAttribute("open", "");
    const cancel = vi.fn();
    dialog.addEventListener("cancel", cancel);
    cap.emit("backButton");
    expect(cancel).toHaveBeenCalledTimes(1);
    dialog.remove();

    const back = vi.spyOn(history, "go");
    cap.emit("backButton");
    expect(back).toHaveBeenCalledWith(-1);

    history.replaceState(null, "", "/");
    initRouter();
    expect(getRoute()).toMatchObject({ view: "find", depth: 0 });
    cap.emit("backButton");
    expect(cap.App.minimizeApp).toHaveBeenCalled();
  });

  it("deep links: the link that started the app is reported once; later links arrive as they open", async () => {
    cap.App.getLaunchUrl.mockResolvedValueOnce({ url: "ayahshare://s/first1" });
    const p = await startNative();
    expect((await p.launchUrl())?.href).toBe("ayahshare://s/first1");
    const opened: string[] = [];
    p.onDeepLink((url) => opened.push(url.href));
    cap.emit("appUrlOpen", { url: "ayahshare://s/first1" }); // iOS repeats the launch link
    cap.emit("appUrlOpen", { url: "https://ayahshare.com/s/second2" });
    expect(opened).toEqual(["https://ayahshare.com/s/second2"]);
  });

  it("share: the file goes to the cache folder in slices, then to the share sheet; closing the sheet is not an error", async () => {
    const p = await startNative();
    const video = new File([new Uint8Array(7 * 1024 * 1024)], "Ash-Sharh 94:5-6.mp4", { type: "video/mp4" });
    expect(await p.shareFile(video)).toBe(true);
    expect(cap.Filesystem.writeFile).toHaveBeenCalledTimes(1);
    expect(cap.Filesystem.appendFile).toHaveBeenCalledTimes(2);
    expect(cap.Filesystem.writeFile.mock.calls[0][0]).toMatchObject({ path: "exports/Ash-Sharh_94_5-6.mp4", directory: "CACHE", recursive: true });
    expect(cap.Share.share).toHaveBeenCalledWith({ files: ["file:///cache/exports/Ash-Sharh_94_5-6.mp4"] });

    cap.Share.share.mockRejectedValueOnce(new Error("Share canceled"));
    expect(await p.shareFile(video)).toBe(false);
    cap.Share.share.mockRejectedValueOnce(new Error("No app can handle this"));
    await expect(p.shareFile(video)).rejects.toThrow("No app can handle this");
  });

  it("save: hands the cached file and its type to the gallery plugin", async () => {
    const p = await startNative();
    await p.saveFile(new Blob(["jpg"], { type: "image/jpeg" }), "a.jpg");
    expect(cap.SaveToGallery.save).toHaveBeenCalledWith({ path: "file:///cache/exports/a.jpg", type: "image/jpeg" });
  });
});

describe("now playing", () => {
  it("lock screen card, state and buttons go to the media-session plugin; the card's image is an absolute URL", async () => {
    const { nowPlaying } = await startNative();
    nowPlaying.set({ title: "Al-Fatihah", artist: "Mishary Alafasy", album: "AyahShare" });
    expect(cap.MediaSession.setMetadata).toHaveBeenCalledWith({
      title: "Al-Fatihah", artist: "Mishary Alafasy", album: "AyahShare",
      artwork: [{ src: "https://ayahshare.com/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
    nowPlaying.set({ title: "t", artist: "a", album: "b", artwork: "https://x.test/a.png" });
    expect(cap.MediaSession.setMetadata.mock.calls[1][0]).toMatchObject({ artwork: [{ src: "https://x.test/a.png" }] });
    nowPlaying.set(null);
    expect(cap.MediaSession.setMetadata.mock.calls[2][0]).toMatchObject({ title: "", artwork: [] });

    nowPlaying.state("playing");
    expect(cap.MediaSession.setPlaybackState).toHaveBeenCalledWith({ playbackState: "playing" });

    const next = vi.fn();
    nowPlaying.handle("nexttrack", next);
    expect(cap.MediaSession.setActionHandler.mock.calls[0][0]).toEqual({ action: "nexttrack" });
    (cap.MediaSession.setActionHandler.mock.calls[0][1] as () => void)();
    expect(next).toHaveBeenCalledTimes(1);
    nowPlaying.handle("nexttrack", null);
    expect(cap.MediaSession.setActionHandler).toHaveBeenLastCalledWith({ action: "nexttrack" }, null);
  });

  it("a plugin failure is swallowed (the recitation plays on without the card)", async () => {
    const { nowPlaying } = await startNative();
    cap.MediaSession.setPlaybackState.mockRejectedValueOnce(new Error("not implemented"));
    expect(() => nowPlaying.state("paused")).not.toThrow();
  });
});

describe("Sign in with Apple", () => {
  it("only the iOS app offers it", async () => {
    expect((await startNative()).appleSignIn).toBeUndefined();
    cap.platform = "ios";
    expect((await startNative()).appleSignIn).toBeTypeOf("function");
  });

  it("asks Apple (name and email are the plugin's default scopes) → the identity token, the name when Apple gives one, and the authorization code", async () => {
    cap.platform = "ios";
    const p = await startNative();
    cap.SocialLogin.login.mockResolvedValueOnce({ provider: "apple", result: { idToken: "jwt-1", accessToken: null, authorizationCode: "code-1", profile: { user: "u", email: "", givenName: "Amina", familyName: "Khan" } } });
    expect(await p.appleSignIn!()).toEqual({ idToken: "jwt-1", name: "Amina Khan", authorizationCode: "code-1" });
    // The plugin hands over the code only with useProperTokenExchange (set up once).
    expect(cap.SocialLogin.initialize).toHaveBeenCalledWith({ apple: { useProperTokenExchange: true } });
    expect(cap.SocialLogin.login).toHaveBeenCalledWith({ provider: "apple", options: {} });
    cap.SocialLogin.login.mockResolvedValueOnce({ provider: "apple", result: { idToken: "jwt-2", profile: { user: "u", email: "", givenName: "", familyName: "" } } });
    expect(await p.appleSignIn!()).toEqual({ idToken: "jwt-2" });
    expect(cap.SocialLogin.initialize).toHaveBeenCalledTimes(1);
  });

  it("the code from the legacy place (accessToken.token) when the plugin could not be set up", async () => {
    cap.platform = "ios";
    vi.resetModules();
    const fresh = await import("./platform-native");
    const p = await fresh.startNative();
    cap.SocialLogin.initialize.mockRejectedValueOnce(new Error("setup failed"));
    cap.SocialLogin.login.mockResolvedValueOnce({ provider: "apple", result: { idToken: "jwt-3", accessToken: { token: "code-legacy" }, profile: {} } });
    expect(await p.appleSignIn!()).toEqual({ idToken: "jwt-3", authorizationCode: "code-legacy" });
  });

  it("cancelling resolves null; other failures throw", async () => {
    cap.platform = "ios";
    const p = await startNative();
    cap.SocialLogin.login.mockRejectedValueOnce(Object.assign(new Error("The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)"), { code: "USER_CANCELLED" }));
    expect(await p.appleSignIn!()).toBeNull();
    cap.SocialLogin.login.mockRejectedValueOnce(new Error("AuthorizationError error 1000"));
    await expect(p.appleSignIn!()).rejects.toThrow("1000");
    cap.SocialLogin.login.mockResolvedValueOnce({ provider: "apple", result: { idToken: "", profile: {} } });
    await expect(p.appleSignIn!()).rejects.toThrow("no identity token");
  });
});
