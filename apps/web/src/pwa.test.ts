// Promoting the install: only where the browser can install; on its own from the second day or after making something,
// at most 3 times, 3 days apart, and never on top of a sign-up invitation.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { askToJoin, closeJoin, resetJoin } from "./join";
import { askInstall, closeInstall, hideStrip, initPwa, installBusy, installKind, isAskingInstall, openInstall, resetInstallAsks, stripHidden } from "./pwa";

const DAY = 24 * 3600 * 1000;
const offerInstall = () => {
  const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: async () => {} });
  dispatchEvent(e);
};
const visitedDays = (days: number) =>
  localStorage.setItem("ayahshare.install.v1", JSON.stringify({ days, day: new Date().toDateString(), asked: [] }));

beforeAll(() => initPwa(() => {}));
beforeEach(() => {
  localStorage.clear();
  resetInstallAsks();
  resetJoin();
});

describe("install promotion", () => {
  it("is offered only once the browser can install", () => {
    dispatchEvent(new Event("appinstalled"));
    expect(installKind()).toBeNull();
    visitedDays(5);
    askInstall("visit");
    expect(isAskingInstall()).toBe(false);
    offerInstall();
    expect(installKind()).toBe("prompt");
  });

  it("asks on its own from the second day of visits, 3 days apart, at most 3 times; the button any time", () => {
    offerInstall();
    const t0 = Date.now();
    visitedDays(1);
    askInstall("visit", t0);
    expect(isAskingInstall()).toBe(false); // the first day: not yet
    visitedDays(2);
    askInstall("visit", t0);
    expect(isAskingInstall()).toBe(true);
    closeInstall();
    askInstall("create", t0 + DAY);
    expect(isAskingInstall()).toBe(false); // too soon
    askInstall("create", t0 + 3 * DAY + 1);
    expect(isAskingInstall()).toBe(true);
    closeInstall();
    askInstall("visit", t0 + 7 * DAY);
    expect(isAskingInstall()).toBe(true);
    closeInstall();
    askInstall("visit", t0 + 30 * DAY);
    expect(isAskingInstall()).toBe(false); // asked 3 times
    openInstall();
    expect(isAskingInstall()).toBe(true); // Home's Install button
  });

  it("Home's strip, closed with ×, stays away for a week", () => {
    const t0 = Date.now();
    expect(stripHidden(t0)).toBe(false);
    hideStrip(t0);
    expect(stripHidden(t0 + 6 * DAY)).toBe(true);
    expect(stripHidden(t0 + 7 * DAY + 1)).toBe(false);
  });

  it("never asks while a sign-up invitation is showing", () => {
    offerInstall();
    visitedDays(3);
    askToJoin("welcome");
    askInstall("visit");
    expect(isAskingInstall()).toBe(false);
    closeJoin();
    askInstall("visit");
    expect(isAskingInstall()).toBe(true);
  });

  describe("while a share or an export is open", () => {
    afterEach(() => vi.useRealTimers());

    it("waits, then asks a minute after it ends; the ask is not used up", () => {
      vi.useFakeTimers();
      offerInstall();
      visitedDays(3);
      const end = installBusy();
      askInstall("visit");
      expect(isAskingInstall()).toBe(false);
      end();
      vi.advanceTimersByTime(59_000);
      expect(isAskingInstall()).toBe(false); // still within the minute after
      vi.advanceTimersByTime(2_000);
      expect(isAskingInstall()).toBe(true);
      expect(JSON.parse(localStorage.getItem("ayahshare.install.v1")!).asked).toHaveLength(1);
    });

    it("keeps waiting while another is still open", () => {
      vi.useFakeTimers();
      offerInstall();
      visitedDays(3);
      const a = installBusy(), b = installBusy();
      askInstall("create");
      a();
      vi.advanceTimersByTime(120_000);
      expect(isAskingInstall()).toBe(false);
      b();
      vi.advanceTimersByTime(61_000);
      expect(isAskingInstall()).toBe(true);
    });
  });
});
