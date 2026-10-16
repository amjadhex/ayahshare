import { beforeEach, describe, expect, it } from "vitest";
import { guessLang, LANGUAGES, storedLang, storeLang, translationFor } from "./lang";

describe("My language", () => {
  beforeEach(() => localStorage.clear());

  it("each language has a translation edition id (or none for Arabic) and a unique code", () => {
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
    for (const l of LANGUAGES) expect(l.translation).toMatch(/^(none|[a-z]{2,3}\.[\w-]+)$/);
    expect(translationFor("ur")).toBe("ur.jalandhry");
    expect(translationFor("ar")).toBe("none");
    expect(translationFor("xx")).toBe("en.sahih");
  });

  it("guesses from the device's languages, else English", () => {
    expect(guessLang(["ml-IN", "en-GB"])).toBe("ml");
    expect(guessLang(["xx", "id-ID"])).toBe("id");
    expect(guessLang(["xx"])).toBe("en");
    expect(guessLang([])).toBe("en");
  });

  it("is kept on the device; unknown values are ignored", () => {
    expect(storedLang()).toBeNull();
    storeLang("ur");
    expect(storedLang()).toBe("ur");
    localStorage.setItem("qd.lang", "klingon");
    expect(storedLang()).toBeNull();
  });
});
