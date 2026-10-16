import { describe, expect, it } from "vitest";
import { setHd } from "./actions";
import { cleanInterests, cleanPrefs, COUNTRY_CODES, hdFor, normalizePhone, prefsPatch, storedHd } from "./prefs";
import { callingCode, flagOf, joinPhone, splitPhone } from "./phone";
import { createStore } from "./state";

describe("preferences", () => {
  it("keep known keys with valid values only", () => {
    expect(cleanPrefs({ reciter: "Husary_128kbps", translation: "ur.jalandhry", orientation: "square", effect: "glass", animation: "fade", font: "x" }))
      .toEqual({ reciter: "Husary_128kbps", translation: "ur.jalandhry", orientation: "square", effect: "glass", animation: "fade" });
    expect(cleanPrefs({ reciter: "Nobody_1kbps", orientation: "tall", effect: 3, animation: "spin" })).toEqual({});
    expect(cleanPrefs({ animation: "rise" })).toEqual({ animation: "rise" });
    expect(cleanPrefs({ animation: "zoom" })).toEqual({ animation: "zoom" });
    expect(cleanPrefs({ animation: "typewriter" })).toEqual({ animation: "fade" }); // stored before it was removed
    expect(cleanPrefs(null)).toEqual({});
    expect(cleanInterests(["hope", "hope", "Bad Id", 4, ...Array.from({ length: 12 }, (_, i) => `t-${i}`)])).toHaveLength(10);
  });

  it("are the defaults of a new design; the translation follows My language unless one is chosen", () => {
    expect(prefsPatch({}, "ur")).toEqual({ translation: "ur.jalandhry", voice: "none" });
    expect(prefsPatch({ translation: "none", reciter: "Husary_128kbps", effect: "outline" }, "ur"))
      .toEqual({ translation: "none", reciter: "Husary_128kbps", effect: "outline", voice: "none" });
  });

  it("translation voice: on for new designs where the language has one, with the translation it reads", () => {
    expect(cleanPrefs({ voice: true, feedVoice: false })).toEqual({ voice: true, feedVoice: false });
    expect(cleanPrefs({ voice: "yes", feedVoice: 1 })).toEqual({});
    expect(prefsPatch({ voice: true }, "en")).toEqual({ translation: "en.sahih", voice: "en.walk" });
    expect(prefsPatch({ voice: true }, "ur")).toEqual({ translation: "ur.jalandhry", voice: "ur.khan" });
    // Malayalam: the voice reads Quran Lalithasaram, so the design shows it (My language's default stays as it is).
    expect(prefsPatch({ voice: true }, "ml")).toEqual({ translation: "ml.lalithasaram", voice: "ml.lalithasaram" });
    expect(prefsPatch({ voice: true }, "fa")).toEqual({ translation: "fa.makarem", voice: "fa.kabiri" });
    expect(prefsPatch({ voice: true }, "hi")).toEqual({ translation: "hi.hindi", voice: "none" }); // no recorded voice
    expect(prefsPatch({ voice: true, translation: "none" }, "en")).toEqual({ translation: "none", voice: "none" });
    expect(prefsPatch({ voice: false }, "en")).toEqual({ translation: "en.sahih", voice: "none" });
  });
});

describe("phone numbers", () => {
  it("normalise to E.164 or are refused", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone("0044 (0)7700 900123")).toBe("+447700900123");
    expect(normalizePhone("  ")).toBeNull();
    for (const bad of ["98765 43210", "+0123456789", "+1234", "+1234567890123456", "call me"]) expect(normalizePhone(bad), bad).toBeUndefined();
  });

  it("the country list has every ISO code once", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES.length).toBe(250);
  });
});

describe("export quality", () => {
  it("until the person picks: a saved file is HD, a file sent to an app Standard; then their pick for both", () => {
    expect([hdFor(null, "save"), hdFor(null, "share")]).toEqual([true, false]);
    expect([hdFor(true, "save"), hdFor(true, "share")]).toEqual([true, true]);
    expect([hdFor(false, "save"), hdFor(false, "share")]).toEqual([false, false]);
  });

  it("the pick is remembered on the device and read back by a new visit", () => {
    localStorage.clear();
    expect(storedHd()).toBeNull();
    expect(createStore().getState().hd).toBeNull();
    setHd(createStore(), true);
    expect(storedHd()).toBe(true);
    expect(createStore().getState().hd).toBe(true);
    setHd(createStore(), false);
    expect(createStore().getState().hd).toBe(false);
    localStorage.setItem("qd.hd", "\"yes\""); // anything else: not picked
    expect(storedHd()).toBeNull();
  });
});


describe("the phone number in two parts (phone.ts)", () => {
  it("joins the country code and the national number into E.164, dropping a trunk 0 (not Italy's)", () => {
    expect(joinPhone("IN", "98765 43210")).toBe("+919876543210");
    expect(joinPhone("IN", "098765-43210")).toBe("+919876543210");
    expect(joinPhone("GB", "07911 123456")).toBe("+447911123456");
    expect(joinPhone("IT", "06 1234 5678")).toBe("+390612345678");
    expect(joinPhone("IN", "+971 50 123 4567")).toBe("+971501234567"); // typed with its own code
    expect(joinPhone("IN", "")).toBeNull();
    expect(joinPhone("IN", "123")).toBeUndefined(); // too short
    expect(joinPhone("IN", "1234567890123456")).toBeUndefined(); // too long
    expect(joinPhone("IN", "98765abc")).toBeUndefined();
    expect(joinPhone("", "9876543210")).toBeUndefined(); // no code chosen
  });

  it("splits a stored number back, preferring the person's country where a code is shared", () => {
    expect(splitPhone("+919876543210")).toEqual({ cc: "IN", national: "9876543210" });
    expect(splitPhone("+971501234567")).toEqual({ cc: "AE", national: "501234567" });
    expect(splitPhone("+14165550123")).toEqual({ cc: "US", national: "4165550123" });
    expect(splitPhone("+14165550123", "CA")).toEqual({ cc: "CA", national: "4165550123" });
    expect(splitPhone("+447911123456", "IN")).toEqual({ cc: "GB", national: "7911123456" });
    expect(splitPhone(null)).toBeNull();
    expect(splitPhone("9876")).toBeNull();
  });

  it("every country in the list has a calling code and a flag", () => {
    expect(COUNTRY_CODES.filter((cc) => !callingCode(cc))).toEqual([]);
    expect(callingCode("IN")).toBe("91");
    expect(flagOf("IN")).toBe("🇮🇳");
  });
});
