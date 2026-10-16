// The private streak: current, best and total from the stored days; the grace rule (one missed day is forgiven, at most
// once in any 7 days); the calendar cells; local days across months, leap days and DST; storage (v1 moved to v2, pruning
// that keeps the best and the total).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeStreak, nextMilestone, WEEKS } from "./streak";

const NOW = new Date(2026, 9, 8, 15, 30); // Thu 8 Oct 2026, local
const key = (n: number, base = NOW) => {
  const x = new Date(base.getFullYear(), base.getMonth(), base.getDate() - n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
/** Days ago (0 = today) to keys. */
const ago = (...n: number[]) => n.map((x) => key(x));
const cell = (days: string[], n: number) => computeStreak(days, NOW).cells[WEEKS * 7 - 1 - n]; // n days ago

describe("streak numbers", () => {
  it("a new person has nothing yet; today alone is a 1-day streak", () => {
    expect(computeStreak([], NOW)).toMatchObject({ days: 0, today: false, best: 0, total: 0, missedYesterday: false });
    expect(computeStreak(ago(0), NOW)).toMatchObject({ days: 1, today: true, best: 1, total: 1 });
  });

  it("counts days in a row ending today, or yesterday when today is not done yet (today empty never breaks it)", () => {
    expect(computeStreak(ago(0, 1, 2), NOW)).toMatchObject({ days: 3, today: true });
    expect(computeStreak(ago(1, 2, 3), NOW)).toMatchObject({ days: 3, today: false, missedYesterday: false });
  });

  it("best is the longest streak ever and total is every active day", () => {
    const days = ago(40, 39, 38, 37, 36, 35, 34, /* 3 days missed */ 30, 29, 28, 27, /* missed */ 2, 1, 0);
    const s = computeStreak(days, NOW);
    expect(s).toMatchObject({ days: 3, best: 7, total: 14 });
    // best never drops below the current streak
    expect(computeStreak(ago(0, 1, 2, 3, 4, 5, 6, 7), NOW)).toMatchObject({ days: 8, best: 8 });
  });

  it("ignores duplicates, unsorted input and things that are not dates", () => {
    const s = computeStreak([key(0), key(2), key(1), key(1), "garbage", "2026-02-30", "2026-13-01", "26-1-1", ""], NOW);
    expect(s).toMatchObject({ days: 3, best: 3, total: 3 });
  });

  it("milestones: 7, 30, 100, 365, then each further 365", () => {
    expect([0, 1, 6, 7, 29, 30, 99, 100, 364, 365, 400, 729, 730, 1500].map(nextMilestone))
      .toEqual([7, 7, 7, 30, 30, 100, 100, 365, 365, 730, 730, 730, 1095, 1825]);
  });
});

describe("the grace rule", () => {
  it("forgives one missed day between two active days: the chain holds, the day is not counted", () => {
    const days = ago(5, 4, 3, /* 2 missed */ 1, 0);
    const s = computeStreak(days, NOW);
    expect(s).toMatchObject({ days: 5, best: 5, total: 5 }); // 5 active days; the rest day is not the 6th
    expect(cell(days, 2)).toBe("rest");
    expect(cell(days, 1)).toBe("done");
  });

  it("two missed days in a row break it; the next day starts a new streak", () => {
    const days = ago(6, 5, 4, /* 3 and 2 missed */ 1, 0);
    expect(computeStreak(days, NOW)).toMatchObject({ days: 2, best: 3, total: 5 });
    expect(cell(days, 2)).toBe("none");
  });

  it("a second single gap inside 7 days breaks it; 7 days apart is forgiven again", () => {
    // gaps 9 and 3 days ago: 6 days apart, too close
    const tooClose = ago(10, /* 9 */ 8, 7, 6, 5, 4, /* 3 */ 2, 1, 0);
    expect(computeStreak(tooClose, NOW)).toMatchObject({ days: 3, best: 6, total: 9 });
    expect(cell(tooClose, 9)).toBe("rest");
    expect(cell(tooClose, 3)).toBe("none");
    // gaps 9 and 2 days ago: exactly 7 days apart, so both are forgiven
    const apart = ago(10, /* 9 */ 8, 7, 6, 5, 4, 3, /* 2 */ 1, 0);
    expect(computeStreak(apart, NOW)).toMatchObject({ days: 9, best: 9, total: 9 });
    expect(cell(apart, 9)).toBe("rest");
    expect(cell(apart, 2)).toBe("rest");
  });

  it("a new streak after a break starts with a clean slate (its own rest day is available)", () => {
    // streak A = 14, 12 (13 forgiven); 11 and 10 missed, so it ends; streak B = 9, 7 (8 forgiven), 6 .. 0: 5 days after A's rest
    const days = ago(14, 12, 9, 7, 6, 5, 4, 3, 2, 1, 0);
    const s = computeStreak(days, NOW);
    expect(s).toMatchObject({ days: 9, best: 9, total: 11 });
    expect(cell(days, 13)).toBe("rest");
    expect(cell(days, 8)).toBe("rest");
  });

  it("today empty never breaks it: through yesterday, and when only yesterday is missing and forgivable", () => {
    // yesterday done, today not yet
    expect(computeStreak(ago(1, 2, 3), NOW)).toMatchObject({ days: 3, today: false, missedYesterday: false });
    // yesterday missed: still alive, waiting for today; yesterday shows as a rest day
    const days = ago(4, 3, 2);
    const s = computeStreak(days, NOW);
    expect(s).toMatchObject({ days: 3, today: false, missedYesterday: true });
    expect(cell(days, 1)).toBe("rest");
    // ...and it holds once today is done
    expect(computeStreak([...days, key(0)], NOW)).toMatchObject({ days: 4, today: true, missedYesterday: false });
  });

  it("yesterday missed and not forgivable (a rest day within the last 7): ended, but the best stays", () => {
    const days = ago(6, 5, /* 4 rest */ 3, 2); // yesterday (1) missed; 4 -> 1 is only 3 days apart
    const s = computeStreak(days, NOW);
    expect(s).toMatchObject({ days: 0, today: false, best: 4, total: 4, missedYesterday: false });
    expect(computeStreak([...days, key(0)], NOW)).toMatchObject({ days: 1, best: 4 });
  });

  it("two days without activity (today included or not) end it; history stays", () => {
    expect(computeStreak(ago(3, 4, 5), NOW)).toMatchObject({ days: 0, best: 3, total: 3 });
    expect(computeStreak(ago(40, 41, 42, 43), NOW)).toMatchObject({ days: 0, best: 4, total: 4 });
  });
});

describe("calendar cells", () => {
  it("are the last 16 weeks, oldest first, today last", () => {
    const days = ago(0, 1, 111, 112);
    const { cells } = computeStreak(days, NOW);
    expect(cells).toHaveLength(WEEKS * 7);
    expect(cells[0]).toBe("done"); // 111 days ago is the oldest cell
    expect(cells[WEEKS * 7 - 1]).toBe("done");
    expect(cells.filter((c) => c === "done")).toHaveLength(3); // 112 days ago is out of view
    expect(cells.filter((c) => c === "rest")).toHaveLength(0);
  });
});

describe("local days", () => {
  it("run through month, year and leap-day boundaries", () => {
    const at = (y: number, m: number, d: number) => new Date(y, m, d, 12);
    const k = (y: number, m: number, d: number) => key(0, at(y, m, d));
    // 2026 is not a leap year: Feb 27, 28 then Mar 1
    expect(computeStreak([k(2026, 1, 27), k(2026, 1, 28), k(2026, 2, 1)], at(2026, 2, 1)).days).toBe(3);
    // 2028 is: Feb 28, 29 then Mar 1
    expect(computeStreak([k(2028, 1, 28), k(2028, 1, 29), k(2028, 2, 1)], at(2028, 2, 1)).days).toBe(3);
    // the new year
    expect(computeStreak([k(2026, 11, 30), k(2026, 11, 31)], at(2027, 0, 1))).toMatchObject({ days: 2, today: false });
    // a rest day on the last day of a month
    expect(computeStreak([k(2026, 0, 30), k(2026, 1, 1)], at(2026, 1, 1))).toMatchObject({ days: 2, best: 2 });
    expect(computeStreak([k(2026, 0, 29), k(2026, 0, 30), k(2026, 1, 1)], at(2026, 1, 2)).cells.at(-3)).toBe("rest");
  });

  describe("across DST changes", () => {
    afterEach(() => vi.unstubAllEnvs());

    // Zones with the change at different hours, a half-hour one, and the southern hemisphere.
    const zones: [string, number][] = [["America/New_York", 300], ["Europe/London", 0], ["Australia/Lord_Howe", -660], ["Pacific/Auckland", -780]];
    for (const [zone, january] of zones) {
      it(`a streak kept every day for a year and a day stays whole in ${zone}`, () => {
        vi.stubEnv("TZ", zone);
        // the zone really applies, and has a DST change in 2026
        expect(new Date(2026, 0, 1, 12).getTimezoneOffset()).toBe(january);
        expect(new Set([0, 2, 4, 6, 8, 10].map((m) => new Date(2026, m, 1, 12).getTimezoneOffset())).size).toBeGreaterThan(1);
        const all: string[] = [];
        for (let i = 0; i < 366; i++) {
          const d = new Date(2026, 0, 1 + i);
          all.push(key(0, d));
          for (const [h, m] of [[0, 5], [1, 30], [12, 0], [23, 55]]) {
            const now = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
            const s = computeStreak(all, now);
            expect(s, `${key(0, d)} ${h}:${m}`).toMatchObject({ days: i + 1, today: true, best: i + 1, total: i + 1 });
            expect(s.cells.filter((c) => c === "rest")).toHaveLength(0);
          }
        }
      });
    }

    it("the day of a time is the local day, also late on the 23- and 25-hour days", () => {
      vi.stubEnv("TZ", "America/New_York");
      // spring forward (8 Mar 2026): 23-hour day; fall back (1 Nov 2026): 25-hour day
      const late = computeStreak([key(0, new Date(2026, 2, 8, 23, 59))], new Date(2026, 2, 9, 0, 1));
      expect(late).toMatchObject({ days: 1, today: false });
      expect(key(0, new Date(2026, 2, 8, 23, 59))).toBe("2026-03-08");
      expect(computeStreak(["2026-10-31", "2026-11-01"], new Date(2026, 10, 1, 23, 30))).toMatchObject({ days: 2, today: true });
      expect(computeStreak(["2026-10-31", "2026-11-01"], new Date(2026, 10, 2, 0, 30))).toMatchObject({ days: 2, today: false });
    });
  });
});

describe("storage", () => {
  const V1 = "ayahshare.streak.v1", V2 = "ayahshare.streak.v2";
  const fresh = async () => { vi.resetModules(); return import("./streak"); };
  const stored = () => JSON.parse(localStorage.getItem(V2) ?? "null") as { v: number; days: string[]; oldDays: number; oldBest: number } | null;
  const at = (day: string) => new Date(`${day}T12:00:00`); // local noon

  beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it("moves v1 days to v2 without losing any (sorted, unique, only real dates), then drops v1", async () => {
    const v1 = [key(40), key(2), key(1), key(0), key(2), "not a date", "2026-02-31", key(41)];
    localStorage.setItem(V1, JSON.stringify({ days: v1 }));
    const m = await fresh();
    expect(stored()).toEqual({ v: 2, days: [key(41), key(40), key(2), key(1), key(0)], oldDays: 0, oldBest: 0 });
    expect(localStorage.getItem(V1)).toBeNull();
    expect(m.getStreak()).toMatchObject({ days: 3, best: 3, total: 5, today: true });
    // loading again reads v2
    const again = await fresh();
    expect(again.getStreak()).toMatchObject({ days: 3, best: 3, total: 5 });
  });

  it("keeps the v1 list when it cannot be saved as v2, and ignores a damaged one", async () => {
    localStorage.setItem(V1, "{broken");
    expect((await fresh()).getStreak()).toMatchObject({ days: 0, total: 0 });
    localStorage.setItem(V1, JSON.stringify({ days: [key(1)] }));
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect((await fresh()).getStreak()).toMatchObject({ days: 1, total: 1 });
    set.mockRestore();
    expect(localStorage.getItem(V1)).not.toBeNull();
  });

  it("records days sorted and unique, and notifies", async () => {
    const m = await fresh();
    const seen = vi.fn();
    m.subscribeStreak(seen);
    m.recordDay(at(key(1)));
    m.recordDay(at(key(1)));
    m.recordDay();
    expect(stored()?.days).toEqual([key(1), key(0)]);
    expect(seen).toHaveBeenCalledTimes(3);
    m.recordDays([at(key(5)).getTime(), at(key(1)).getTime(), at(key(5)).getTime(), NaN, -3]);
    expect(stored()?.days).toEqual([key(5), key(1), key(0)]);
    expect(m.getStreak()).toMatchObject({ total: 3, best: 2, days: 2 });
  });

  it("a new day (the app left open overnight) shows a fresh answer", async () => {
    const m = await fresh();
    m.recordDay();
    expect(m.getStreak()).toMatchObject({ days: 1, today: true });
    vi.setSystemTime(new Date(2026, 9, 9, 8));
    expect(m.getStreak()).toMatchObject({ days: 1, today: false });
    vi.setSystemTime(new Date(2026, 9, 11, 8)); // two missed days
    expect(m.getStreak()).toMatchObject({ days: 0, best: 1, total: 1 });
  });

  it("pruning drops history older than ~3 years but keeps the best and the total", async () => {
    // a 40-day streak 4 years ago, a 3-day one 2 years ago, and a 2-day streak now
    const old = Array.from({ length: 40 }, (_, i) => key(1460 + i));
    const mid = [key(730), key(729), key(728)];
    localStorage.setItem(V2, JSON.stringify({ v: 2, days: [...old, ...mid, key(1)], oldDays: 0, oldBest: 0 }));
    const m = await fresh();
    expect(m.getStreak()).toMatchObject({ best: 40, total: 44, days: 1 }); // nothing pruned until the next write
    m.recordDay();
    expect(stored()).toEqual({ v: 2, days: [...mid, key(1), key(0)].sort(), oldDays: 40, oldBest: 40 });
    expect(m.getStreak()).toMatchObject({ days: 2, best: 40, total: 45, today: true });
    // and it survives a reload
    expect((await fresh()).getStreak()).toMatchObject({ days: 2, best: 40, total: 45 });
  });

  it("pruning never cuts a streak that is still running, even with a rest day in its old part", async () => {
    // 1,200 days with one forgiven day (1199 ago), ending yesterday; today is added: all one streak, older than the 3 years kept
    const days = [key(1200), ...Array.from({ length: 1198 }, (_, i) => key(i + 1))];
    localStorage.setItem(V2, JSON.stringify({ v: 2, days, oldDays: 0, oldBest: 0 }));
    const m = await fresh();
    m.recordDay();
    expect(stored()?.days).toHaveLength(1200);
    expect(stored()).toMatchObject({ oldDays: 0, oldBest: 0 });
    expect(m.getStreak()).toMatchObject({ days: 1200, best: 1200, total: 1200 });
  });

  it("an old streak that has ended goes whole, and the numbers match counting everything", async () => {
    const gapped = [...Array.from({ length: 30 }, (_, i) => key(1300 + i)), ...Array.from({ length: 10 }, (_, i) => key(i + 1))];
    const full = computeStreak([...gapped, key(0)], NOW);
    localStorage.setItem(V2, JSON.stringify({ v: 2, days: gapped, oldDays: 0, oldBest: 0 }));
    const m = await fresh();
    m.recordDay();
    expect(stored()).toMatchObject({ oldDays: 30, oldBest: 30 });
    expect(stored()?.days).toHaveLength(11);
    expect(m.getStreak()).toMatchObject({ days: full.days, best: full.best, total: full.total });
    expect(full).toMatchObject({ days: 11, best: 30, total: 41 });
  });

  it("history 3+ years old only: everything is pruned, the totals remain", async () => {
    const old = Array.from({ length: 12 }, (_, i) => key(2000 + i));
    localStorage.setItem(V2, JSON.stringify({ v: 2, days: old, oldDays: 5, oldBest: 9 }));
    const m = await fresh();
    m.recordDay();
    expect(stored()).toEqual({ v: 2, days: [key(0)], oldDays: 17, oldBest: 12 });
    expect(m.getStreak()).toMatchObject({ days: 1, best: 12, total: 18 });
  });
});
