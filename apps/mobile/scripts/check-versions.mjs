// The app's JavaScript (bundled from apps/web) and its native code (installed here) must come from the same plugin
// versions. Fails when a Capacitor package differs between apps/web/package.json and apps/mobile/package.json.
import { readFileSync } from "node:fs";

const deps = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")).dependencies ?? {};
const web = deps("../../web/package.json"), mobile = deps("../package.json");
const native = (name) => name.startsWith("@capacitor/") || name.startsWith("@capgo/");
const wrong = Object.keys(web).filter(native).filter((name) => web[name] !== mobile[name]);
if (wrong.length) {
  console.error(`Plugin versions differ between apps/web and apps/mobile: ${wrong.map((n) => `${n} ${web[n]} vs ${mobile[n] ?? "missing"}`).join(", ")}`);
  process.exit(1);
}
console.log(`Plugin versions match (${Object.keys(web).filter(native).length} packages).`);
