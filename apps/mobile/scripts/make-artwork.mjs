// Draws the app icon and launch screen sources from the brand artwork (brand/icon, brand/splash: the gold mushaf
// ornament with alif madda on emerald) into assets/, which `capacitor-assets generate` turns into every iOS and Android
// size (npm run assets).
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const brand = (p) => new URL(`../../../brand/${p}`, import.meta.url).pathname;
const out = new URL("../assets/", import.meta.url);
mkdirSync(out, { recursive: true });
const png = (src, name, size) => sharp(brand(src), { density: 300 }).resize(size).png().toFile(new URL(name, out).pathname);
await Promise.all([
  png("icon/app-icon.svg", "icon-only.png", 1024),                     // iOS (the system rounds the corners) and legacy Android icons
  png("icon/android-foreground.svg", "icon-foreground.png", 1024),     // Android adaptive icon: the mark inside the 66 dp safe zone
  png("icon/android-background.svg", "icon-background.png", 1024),
  png("splash/splash.svg", "splash.png", 2732),
  png("splash/splash.svg", "splash-dark.png", 2732),
]);
console.log("assets/ written");
