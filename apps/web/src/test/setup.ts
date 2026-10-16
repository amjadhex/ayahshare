// jsdom lacks a few browser APIs the app uses; these stand-ins are just enough for component tests.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

declare global { interface Window { __width: number } }
window.__width = 390;

/** matchMedia that answers the app's queries from `window.__width` (set it before rendering). */
window.matchMedia = (query: string) => {
  const max = query.match(/max-width:\s*(\d+)px/), min = query.match(/min-width:\s*(\d+)px/);
  const matches = max ? window.__width <= +max[1] : min ? window.__width >= +min[1] : query.includes("reduce");
  return {
    matches, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  } as MediaQueryList;
};

const dialog = HTMLDialogElement.prototype;
if (!("open" in dialog)) {
  Object.defineProperty(dialog, "open", {
    get(this: HTMLDialogElement) { return this.hasAttribute("open"); },
    set(this: HTMLDialogElement, v: boolean) { this.toggleAttribute("open", v); },
  });
}
if (!dialog.showModal) dialog.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
if (!dialog.close) {
  dialog.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
// No canvas in jsdom: drawing code is replaced in the component tests; getContext answers null instead of logging.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
Element.prototype.scrollTo ??= function () {}; // jsdom has window.scrollTo only (the topic chips' row scrolls back on refresh)
Element.prototype.setPointerCapture ??= function () {};
Element.prototype.releasePointerCapture ??= function () {};
HTMLMediaElement.prototype.pause = function () {};
HTMLMediaElement.prototype.load = function () {};

afterEach(() => cleanup());
URL.createObjectURL ??= () => "blob:test";
URL.revokeObjectURL ??= () => {};
