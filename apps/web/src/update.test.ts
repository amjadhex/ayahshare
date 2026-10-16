import { afterEach, describe, expect, it, vi } from "vitest";
import * as platformModule from "./platform";
import { compareVersions, holdUpdates, requireUpdate } from "./update";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("compareVersions", () => {
  it("compares part by part, missing parts as 0", () => {
    expect(compareVersions("1.0.2", "1.0.10")).toBe(-1);
    expect(compareVersions("1.1", "1.0.9")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});

describe("requireUpdate", () => {
  const as = (kind: "web" | "android" | "ios", version: string | null) => {
    const p = { ...platformModule.platform, kind, appVersion: async () => version, openExternal: vi.fn(), ready: vi.fn() };
    vi.spyOn(platformModule, "platform", "get").mockReturnValue(p);
    return p;
  };
  const config = { appName: "AyahShare", googleClientId: null, mediaBase: "/media/", minAppVersion: { android: "1.0.3" } };

  it("an older app: only the Update screen, which opens the store", async () => {
    const p = as("android", "1.0.2");
    expect(await requireUpdate(config)).toBe(true);
    const screen = document.querySelector(".update-screen")!;
    expect(screen.textContent).toContain("Update AyahShare");
    screen.querySelector("button")!.click();
    expect(p.openExternal).toHaveBeenCalledWith("https://play.google.com/store/apps/details?id=com.ayahshare.app");
    expect(p.ready).toHaveBeenCalled(); // the splash screen goes
  });

  it("the same or newer app, another platform's minimum, the web, or no minimum: runs", async () => {
    as("android", "1.0.3");
    expect(await requireUpdate(config)).toBe(false);
    as("ios", "1.0.0");
    expect(await requireUpdate(config)).toBe(false);
    as("web", null);
    expect(await requireUpdate(config)).toBe(false);
    as("android", "1.0.0");
    expect(await requireUpdate({ ...config, minAppVersion: undefined })).toBe(false);
    expect(await requireUpdate(null)).toBe(false);
    expect(document.querySelector(".update-screen")).toBeNull();
  });
});

describe("holdUpdates", () => {
  it("lets go once, however often it is called", () => {
    const release = holdUpdates();
    release();
    release();
    expect(typeof holdUpdates()).toBe("function");
  });
});
