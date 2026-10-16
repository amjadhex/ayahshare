import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Surah } from "../../../contracts/types";

const world = vi.hoisted(() => ({
  picks: [] as { day: string; ref: string }[],
  own: "47:24",
  allowed: true,
  scheduled: [] as { id: number; at: Date; title: string; body: string }[][],
  cancelled: 0,
  events: [] as { name: string; props?: Record<string, unknown> }[],
  native: true, web: false, offline: false,
  pushed: [] as { list: unknown[]; time: string }[],
}));

vi.mock("./api", () => ({
  getDailyPicks: vi.fn(async () => ({ picks: world.picks })),
  getTopics: vi.fn(async () => ({ topics: [] })),
}));
vi.mock("./discover", () => ({
  loadText: vi.fn(async (ref: string) => ({ ar: `ar ${ref}`, tr: `tr ${ref}` })),
  backgroundFor: vi.fn(async () => ({ bg: { type: "colour", value: "#000000" }, clip: null, sensitive: false })),
  loadAyahOfTheDay: vi.fn(async () => ({ ref: world.own, ar: "", tr: `tr ${world.own}`, bg: { type: "colour", value: "#000000" }, clip: null })),
}));
vi.mock("./platform", () => ({
  platform: {
    get reminders() { return world.native ? native : undefined; },
  },
}));
const native = vi.hoisted(() => ({
      kind: "local" as const,
      allow: vi.fn(async () => world.allowed),
      schedule: vi.fn(async (list: { id: number; at: Date; title: string; body: string }[]) => { world.scheduled.push(list); }),
      cancel: vi.fn(async () => { world.cancelled++; }),
      onOpen: vi.fn(),
}));
const web = vi.hoisted(() => ({
  kind: "push" as const,
  allow: vi.fn(async () => true),
  schedule: vi.fn(async (list: unknown[], time: string) => { world.pushed.push({ list, time }); if (world.offline) throw new Error("offline"); }),
  cancel: vi.fn(async () => {}),
  onOpen: vi.fn(),
}));
vi.mock("./webpush", () => ({ webReminders: () => (world.web ? web : undefined) }));
vi.mock("./analytics", () => ({ track: (name: string, props?: Record<string, unknown>) => world.events.push({ name, props }) }));

import { dayAyah, dayKey, remindersAvailable, remindersFrom, reminderSetting, resetDayAyah, scheduleReminders, shownTime, turnOffReminder, turnOnReminder } from "./today";

const surahs = Array.from({ length: 114 }, (_, i) => ({ number: i + 1, name_en: `Surah ${i + 1}` })) as unknown as Surah[];

beforeEach(() => {
  localStorage.clear();
  resetDayAyah();
  Object.assign(world, { picks: [], own: "47:24", allowed: true, scheduled: [], cancelled: 0, events: [], native: true, web: false, offline: false, pushed: [] });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 8, 30)); // Monday 12 October, 8:30 local
});
afterEach(() => vi.useRealTimers());

describe("today's ayah", () => {
  it("is the admin's pick for that local day, else the app's own", async () => {
    world.picks = [{ day: "2026-10-13", ref: "13:28" }];
    expect((await dayAyah(new Date(2026, 9, 12), "en.sahih"))?.ref).toBe("47:24");
    expect((await dayAyah(new Date(2026, 9, 13), "en.sahih"))?.ref).toBe("13:28");
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("reminds once a day at the chosen time, for the next seven days, each with that day's ayah", async () => {
    world.picks = [{ day: "2026-10-13", ref: "13:28" }];
    const list = await remindersFrom(new Date(), "07:00", "en.sahih", surahs);
    expect(list).toHaveLength(7);
    expect(list[0].at).toEqual(new Date(2026, 9, 13, 7, 0)); // 7:00 today has passed: tomorrow first
    expect(list.map((r) => r.id)).toEqual([7000, 7001, 7002, 7003, 7004, 7005, 7006]);
    expect(list[0]).toMatchObject({ title: "Today's ayah · Surah 13 13:28", body: "tr 13:28" });
    expect(list[1].title).toBe("Today's ayah · Surah 47 47:24");
    expect((await remindersFrom(new Date(), "20:00", "en.sahih", surahs))[0].at).toEqual(new Date(2026, 9, 12, 20, 0)); // still today
  });

  it("is off until turned on; on asks permission, schedules and counts; off cancels and counts", async () => {
    expect(reminderSetting()).toEqual({ on: false, time: "07:00" });
    await scheduleReminders("en.sahih", surahs);
    expect(world.scheduled).toHaveLength(0);

    world.allowed = false;
    expect(await turnOnReminder("20:00", "en.sahih", surahs)).toBe("denied");
    expect(reminderSetting().on).toBe(false);

    world.allowed = true;
    expect(await turnOnReminder("20:00", "en.sahih", surahs)).toBe("on");
    expect(reminderSetting()).toEqual({ on: true, time: "20:00" });
    expect(world.scheduled.at(-1)).toHaveLength(7);
    expect(world.events.map((e) => e.name)).toEqual(["reminder_on"]);
    await scheduleReminders("en.sahih", surahs); // the same day again: nothing to do
    expect(world.scheduled).toHaveLength(1);

    await turnOffReminder();
    expect(reminderSetting().on).toBe(false);
    expect(world.cancelled).toBeGreaterThan(0);
    expect(world.events.map((e) => e.name)).toEqual(["reminder_on", "reminder_off"]);
    expect(shownTime("07:00")).toBe("7:00");
  });

  it("on the web the reminder is push: only the time goes to the server; offline it stays off", async () => {
    Object.assign(world, { native: false, web: true, offline: true });
    expect(remindersAvailable()).toBe(true);
    expect(await turnOnReminder("07:00", "en.sahih", surahs)).toBe("failed");
    expect(reminderSetting().on).toBe(false);
    expect(world.events).toEqual([]);
    world.offline = false;
    expect(await turnOnReminder("07:00", "en.sahih", surahs)).toBe("on");
    expect(world.pushed.at(-1)).toEqual({ list: [], time: "07:00" });
    expect(world.events.map((e) => e.name)).toEqual(["reminder_on"]);
    world.web = false;
    expect(remindersAvailable()).toBe(false); // no app and no push: no "Remind me"
  });
});
