// Coarse device / browser / OS from the User-Agent, for analytics. The UA string itself is not stored.
// The iOS / Android app adds "AyahShareApp" to its WebView's User-Agent (apps/mobile capacitor.config.ts appendUserAgent):
// its browser is "app".
export interface Agent { device: "mobile" | "tablet" | "desktop"; browser: string; os: string; app: boolean }

export function parseAgent(ua: string): Agent {
  const os = /android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "ios" : /windows/i.test(ua) ? "windows"
    : /mac os x|macintosh/i.test(ua) ? "mac" : /cros/i.test(ua) ? "chromeos" : /linux/i.test(ua) ? "linux" : "other";
  const app = /AyahShareApp/.test(ua);
  const browser = app ? "app" : /edg\//i.test(ua) ? "edge" : /samsungbrowser/i.test(ua) ? "samsung" : /opr\/|opera/i.test(ua) ? "opera"
    : /firefox|fxios/i.test(ua) ? "firefox" : /chrome|crios/i.test(ua) ? "chrome" : /safari/i.test(ua) ? "safari" : "other";
  const device = /ipad|tablet/i.test(ua) || (os === "android" && !/mobile/i.test(ua)) ? "tablet" : /mobi|iphone|ipod/i.test(ua) ? "mobile" : "desktop";
  return { device, browser, os, app };
}
