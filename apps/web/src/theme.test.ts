// Appearance: the choice is stored on the device, shown at once (html data-theme, the browser's theme colour), and read
// again by index.html's first script before the CSS.
import { beforeEach, describe, expect, it } from "vitest";
import html from "../index.html?raw";
import { cleanTheme, storedTheme } from "./prefs";
import { applyTheme, getTheme, initTheme, resolveTheme, setTheme, themeColour } from "./theme";

const root = document.documentElement;
const metas = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];

beforeEach(() => {
  localStorage.clear();
  delete root.dataset.theme;
  delete root.dataset.page;
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0b0f0e" media="(prefers-color-scheme: dark)">';
  applyTheme("system");
});

describe("appearance", () => {
  it("is System until chosen; only light and dark are kept", () => {
    expect(storedTheme()).toBe("system");
    expect(["light", "dark", "sepia", null, 3].map(cleanTheme)).toEqual(["light", "dark", "system", "system", "system"]);
  });

  it("choosing is stored on the device and applied at once, without a reload; System removes it", () => {
    setTheme("dark");
    expect(JSON.parse(localStorage.getItem("qd.theme")!)).toBe("dark");
    expect(storedTheme()).toBe("dark");
    expect(getTheme()).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    setTheme("light");
    expect(root.dataset.theme).toBe("light");
    setTheme("system");
    expect(root.dataset.theme).toBeUndefined();
    expect(storedTheme()).toBe("system");
  });

  it("starts with the stored choice", () => {
    localStorage.setItem("qd.theme", JSON.stringify("dark"));
    initTheme();
    expect(root.dataset.theme).toBe("dark");
    expect(getTheme()).toBe("dark");
  });

  it("resolves to the choice, else the system's", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("the browser's theme colour follows the choice, and goes back to the system's (the meta tags' own) for System", () => {
    setTheme("dark");
    expect(metas().map((m) => m.content)).toEqual(["#0b0f0e", "#0b0f0e"]);
    setTheme("light");
    expect(metas().map((m) => m.content)).toEqual(["#ffffff", "#ffffff"]);
    setTheme("system");
    expect(metas().map((m) => m.content)).toEqual(["#ffffff", "#0b0f0e"]);
    expect(themeColour("#123456")).toBe("#123456");
    setTheme("dark");
    expect(themeColour("#123456")).toBe("#0b0f0e");
  });

  it("a dark screen (the editor, Reels) keeps its own colour while the theme changes", () => {
    root.dataset.page = "editor";
    metas().forEach((m) => { m.content = "#0b0f0e"; });
    setTheme("light");
    expect(metas().map((m) => m.content)).toEqual(["#0b0f0e", "#0b0f0e"]);
  });
});

describe("index.html's first script", () => {
  const script = /<script id="theme-boot">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  const run = () => new Function(script)();

  it("is there, ahead of the stylesheets and the app", () => {
    expect(script).toContain('"qd.theme"');
    expect(html.indexOf('id="theme-boot"')).toBeLessThan(html.indexOf("fonts.googleapis.com/css2"));
    expect(html.indexOf('id="theme-boot"')).toBeLessThan(html.indexOf("/src/main.tsx"));
  });

  it.each(["light", "dark"] as const)("puts the stored %s on <html> (the value prefs.ts writes)", (theme) => {
    localStorage.setItem("qd.theme", JSON.stringify(theme));
    run();
    expect(root.dataset.theme).toBe(theme);
  });

  it("leaves the system's when nothing, System or rubbish is stored", () => {
    run();
    expect(root.dataset.theme).toBeUndefined();
    for (const v of [JSON.stringify("system"), "sepia", "{"]) {
      localStorage.setItem("qd.theme", v);
      expect(run).not.toThrow();
      expect(root.dataset.theme).toBeUndefined();
    }
  });

  it("the splash follows the choice too", () => {
    expect(html).toContain(':root[data-theme="dark"] .boot {');
    expect(html).toContain(':root:not([data-theme="light"]) .boot {');
    expect(html).toContain(':root[data-theme="dark"] .boot-ink');
  });
});
