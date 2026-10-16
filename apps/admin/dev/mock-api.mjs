// Local stand-in for the admin API with made-up numbers, so the dashboard can be tried without real traffic.
//   npm run build && npm run mock        → http://localhost:8788/admin/   (already signed in as a made-up admin)
//   EVENTS=off npm run mock              → like production before the first app event is counted (event fields null)
// Serves the built dashboard from ../web/dist/admin and answers /admin/api/*. Thumbnails, /api/config and the surah names are
// passed through to the deployed Worker, so no real data and no credentials are involved.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 8788);
const EVENTS = process.env.EVENTS !== "off";
const REAL = process.env.API_TARGET ?? "https://quran-design.rapid-sun-0190.workers.dev";
const DIST = join(import.meta.dirname, "../../web/dist/admin");
const DAY = 86400_000;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const item = (id, name, detail, lang) => ({ id, name, detail, lang, off: false });
const LIBRARY = {
  tafsirs: [item("ml.thafheem", "Thafheemul Quran", "Abul A'la Maududi", "ml"), item("ml.amani", "Amani Thafseer", null, "ml"),
    item("169", "Ibn Kathir (Abridged)", "Hafiz Ibn Kathir", "en"), item("en.tafheem", "Tafhim al-Qur'an", "Maududi", "en"), item("16", "Tafsir Muyassar", null, "ar")],
  reciters: [item("Alafasy_128kbps", "Mishary Rashid Alafasy", null, null), item("Husary_128kbps", "Mahmoud Khalil Al-Husary", null, null),
    item("Ghamadi_40kbps", "Saad Al-Ghamdi", null, null)],
  voices: [item("en.walk", "Ibrahim Walk", "reads en.sahih", "en"), item("ml.lalithasaram", "Noushad Ibrahim", "reads ml.lalithasaram", "ml")],
};

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const counts = (pairs) => pairs.map(([key, n]) => ({ key, n }));

const surahsOf = (r) => r.map((x) => [x, Math.round(2000 / (1 + r.indexOf(x)) ** 0.8)]);
const AYAHS = ["2:255", "94:5", "94:6", "1:1", "112:1", "36:1", "55:13", "2:286", "67:1", "18:10", "3:139", "13:28", "39:53", "93:3", "2:153", "24:35", "59:22", "59:23", "20:114", "17:80"];
const SEARCHES = ["patience", "hope after hardship", "ക്ഷമ", "الصبر", "parents", "forgiveness", "sabar", "rain", "anxiety", "gratitude", "death", "ayat kursi", "light", "kindness to neighbours", "dua for exams", "trust in Allah", "orphans", "sabr", "success", "ramadan"];

async function clipIds() {
  try {
    const list = await (await fetch(`${REAL}/data/clips.json`)).json();
    return list.slice(0, 120).map((c) => ({ id: c.id, caption: c.caption, tags: c.tags, duration: c.duration, video: c.video, thumb: c.thumb }));
  } catch {
    return Array.from({ length: 40 }, (_, i) => ({ id: `pb${1000 + i}`, caption: "calm sky", tags: ["sky", "calm"], duration: 9, video: null, thumb: `thumbs/pb${1000 + i}.webp` }));
  }
}

const now = Date.now();
const clips = (await clipIds()).map((c, i) => {
  const status = i % 23 === 7 ? "rejected" : i % 11 === 5 ? "hidden" : "active";
  return {
    ...c, source: i % 4 ? "pixabay" : "pexels", author: `author${i % 9}`, page_url: `https://pixabay.com/videos/${c.id}/`, quality: Math.round(rnd() * 40 + 55) / 100,
    safety: { people: rnd() < 0.15 ? 0.35 : 0.02, animals: rnd() < 0.1 ? 0.18 : 0.01, text_logo: 0.03, other_religion: 0, immodest: 0.01, abstract_dark: rnd() },
    status, created_at: now - i * 3600_000 * 5, reports: i % 17 === 3 ? 2 : i % 29 === 1 ? 1 : 0, uses: EVENTS ? Math.round(300 / (1 + i / 4)) : null,
  };
});
const reports = Array.from({ length: 130 }, (_, i) => {
  const bg = i % 3 === 0;
  return {
    id: 200 - i, created_at: now - i * 7 * 3600_000, kind: bg ? "background" : pick(["search", "text", "other"]), ref: bg ? null : pick(AYAHS),
    clip_id: bg ? clips[(i * 5) % clips.length].id : null, note: pick([null, "A person is visible in the video", "The wrong ayah came first", "Text is cut off at the bottom", "Beautiful, but the font looks too small on my phone and I could not read the translation properly"]),
    status: i < 3 ? "open" : i < 110 ? "done" : "dismissed", anon_id: `anon-${i}xxxxxxxx`, user_id: i % 4 === 0 ? `u${i}` : null,
  };
});
const users = Array.from({ length: 120 }, (_, i) => ({
  id: `u${i}`, email: `person${i}@example.com`, name: i % 9 === 0 ? "" : `Test Person ${i}`, avatar_url: null, created_at: now - (i + 1) * 20 * 3600_000,
  last_login: now - i * 5 * 3600_000, creations: i % 7, favourites: (i * 3) % 11, devices: 1 + (i % 3),
  display_name: i % 5 === 0 ? `Person ${i}` : null, lang: ["en", "ur", "ml", "id"][i % 4], country: i % 3 ? ["IN", "ID", "GB", "PK"][i % 4] : null,
  city: i % 4 === 0 ? ["Kochi", "Jakarta", "Leeds", "Lahore"][i % 4] : null, phone: i % 6 === 0 ? "••••••••••123" : null, phone_opt_in: i % 12 === 0,
  interests: i % 2 ? ["hope", "patience", "gratitude", "parents"].slice(0, 1 + (i % 4)) : [], updated_at: i % 2 ? now - i * 3600_000 : null,
}));

function overview(days) {
  seed = 11;   // same numbers on every request
  const series = (f) => Array.from({ length: Math.min(days, 60) }, (_, i) => ({ day: day(now - (Math.min(days, 60) - i) * DAY), value: Math.round(f(i)) }));
  const wave = (base, amp, i) => base + amp * Math.sin(i / 4) + i * 6 + rnd() * amp * 0.5;
  const daily = { devices_active: series((i) => wave(900, 150, i)), devices_new: series((i) => wave(120, 40, i) / 2), users_new: series((i) => 3 + rnd() * 6) };
  if (EVENTS) daily["funnel:open"] = series((i) => wave(1000, 160, i));
  const e = EVENTS;
  return {
    eventsEnabled: e, days,
    devices: { total: 18420, dau: 1240, wau: 5310, mau: 12980, new1: 180, new7: 1420, new30: 5200 },
    users: { total: 342, new7: 41, active30: 187 },
    shares: { total: 2140, new7: 310, opens: 9800 },
    reports: { open: reports.filter((r) => r.status === "open").length },
    countries: counts([["IN", 4200], ["ID", 3100], ["PK", 2200], ["SA", 1700], ["BD", 1500], ["US", 900], ["GB", 640], ["EG", 480], ["MY", 400], ["TR", 310], ["", 120]]),
    platforms: counts([["android-app", 6100], ["android", 3700], ["ios-app", 2400], ["ios", 2800], ["windows", 1900], ["mac", 900], ["linux", 120], ["other", 40]]),
    accountCountries: counts([["IN", 120], ["ID", 80], ["PK", 52], ["GB", 31]]),
    interests: counts([["hope", 140], ["patience", 122], ["gratitude", 90], ["parents", 64], ["ease-after-hardship", 41]]),
    exports: e ? { video: { done: 3100, failed: 140, avgMs: 14200 }, image: { done: 5200, failed: 30, avgMs: 900 } } : null,
    funnel: e ? { open: 12980, ayah: 7420, export: 3980 } : null,
    events: e ? counts([["app_open", 31200], ["search", 18400], ["ayah_select", 15200], ["bg_select", 11900], ["customise", 9800], ["preview_play", 8700], ["export_start", 8600], ["export_done", 8300], ["search_click", 7600], ["share_native", 3300], ["link_copy", 2100], ["share_open", 1900], ["export_failed", 170], ["report", 16], ["error", 40]]) : null,
    devicesByType: e ? counts([["mobile", 21000], ["desktop", 8900], ["tablet", 1300]]) : null,
    browsers: e ? counts([["Chrome", 17000], ["Safari", 9000], ["Samsung Internet", 2100], ["Firefox", 900], ["Edge", 700]]) : null,
    daily,
  };
}

const content = (days) => ({
  eventsEnabled: EVENTS, days,
  interests: counts([["hope", 140], ["patience", 122], ["gratitude", 90], ["parents", 64], ["ease-after-hardship", 41]]),
  cachedSearches: SEARCHES.slice(0, 12).map((q, i) => ({ q, topic: i % 4 ? q.slice(0, 8) : null, n: 120 - i * 8, created_at: now - i * DAY })),
  ayahs: EVENTS ? counts(surahsOf(AYAHS).slice(0, 20)) : null,
  surahs: EVENTS ? counts([["2", 4200], ["112", 2800], ["94", 2600], ["1", 2400], ["36", 1900], ["55", 1500], ["67", 1300], ["18", 900], ["3", 700], ["13", 500]]) : null,
  searches: EVENTS ? counts(surahsOf(SEARCHES)) : null,
  noClickSearches: EVENTS ? counts([["dua for exams", 42], ["sabr", 31], ["kindness to neighbours", 19], ["ramadan", 11]]) : null,
  clips: EVENTS ? counts([...clips.slice(0, 7).map((c, i) => [c.id, 420 - i * 50]), ["colour", 260]]) : null,
  bgSources: EVENTS ? counts([["suggested", 6200], ["library", 3300], ["colour", 2400]]) : null,
  reciters: EVENTS ? counts([["Alafasy_128kbps", 3900], ["Abdul_Basit_Murattal_192kbps", 1400], ["Husary_128kbps", 800], ["Minshawy_Murattal_128kbps", 400]]) : null,
  translations: EVENTS ? counts([["en.sahih", 3800], ["id.indonesian", 1700], ["ur.jalandhry", 900], ["ml.abdulhameed", 500], ["none", 400]]) : null,
  orientations: EVENTS ? counts([["portrait", 6100], ["square", 1500], ["landscape", 700]]) : null,
});

const luna = (days) => (seed = 13, {
  capUsd: 1,
  days: Array.from({ length: days }, (_, i) => i).filter((i) => i % 5 !== 3).map((i) => {
    const calls = Math.round(30 + rnd() * 160 + i * 2);
    return { day: day(now - (days - 1 - i) * DAY), calls, input_tokens: calls * 1700, cost_usd: calls * 0.00018 };
  }),
  cache: { rows: 640, hits: 2210 },
});

// Today's ayah: the days an admin replaced (kept while the mock runs) and made-up counts for the 7 days before `from` and `from`.
let news = [
  { id: 2, title: "21 more reciters", body: "Pick one in Language and audio.", link: "/feed", at: now - 2 * 3600_000 },
  { id: 1, title: "Welcome to AyahShare", body: "", link: null, at: now - 70 * DAY },
];
const dailyPicks = new Map([[day(now + 2 * DAY), "2:255"]]);
function daily(url) {
  const from = url.searchParams.get("from") ?? day(now), count = Number(url.searchParams.get("days") ?? 14);
  const at = (i) => day(Date.parse(`${from}T00:00:00Z`) + i * DAY);
  const days = Array.from({ length: count }, (_, i) => at(i));
  return {
    eventsEnabled: EVENTS,
    picks: [...dailyPicks].filter(([d]) => days.includes(d)).sort().map(([d, ref]) => ({ day: d, ref, at: now - 3600_000 })),
    stats: Array.from({ length: 8 }, (_, i) => ({ day: at(i - 7), seen: EVENTS ? 400 + i * 35 : 0, opened: EVENTS ? 90 + i * 8 : 0, shared: EVENTS ? 30 + i * 3 : 0 })),
    remindersOn: EVENTS ? 1480 : null,
  };
}

const json = (res, body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b ? JSON.parse(b) : {})); });

async function api(req, res, url) {
  const path = url.pathname.replace("/admin/api/", "");
  const days = Number(url.searchParams.get("days") ?? 30);
  const page = (rows) => rows.slice(Number(url.searchParams.get("offset") ?? 0), Number(url.searchParams.get("offset") ?? 0) + Number(url.searchParams.get("limit") ?? 100));
  await new Promise((r) => setTimeout(r, 150));   // a little latency, like the real thing
  if (path.startsWith("daily/")) {
    const d = path.slice("daily/".length);
    if (req.method === "DELETE") { dailyPicks.delete(d); res.writeHead(204); return res.end(); }
    if (req.method === "PUT") {
      const ref = (await readBody(req)).ref;
      if (!/^\d{1,3}:\d{1,3}$/.test(ref ?? "")) return json(res, { error: "ref must be an ayah like 2:255" }, 400);
      dailyPicks.set(d, ref);
      return json(res, { day: d, ref, at: Date.now() });
    }
  }
  if (path === "library") return json(res, LIBRARY);
  if (path.startsWith("library/") && req.method === "PUT") {
    const [, kind, id] = path.split("/").map(decodeURIComponent);
    const item = LIBRARY[`${kind}s`]?.find((x) => x.id === id);
    if (!item) return json(res, { error: `no such ${kind}` }, 400);
    item.off = (await readBody(req)).off === true;
    res.writeHead(204).end();
    return;
  }
  if (path === "announcements" || path.startsWith("announcements/")) {
    if (req.method === "POST") {
      const b = await readBody(req);
      if (!b.title?.trim()) return json(res, { error: "title is required, at most 80 characters" }, 400);
      const a = { id: news.length ? news[0].id + 1 : 1, title: b.title.trim(), body: (b.body ?? "").trim(), link: b.link || null, at: Date.now() };
      news.unshift(a);
      return json(res, a, 201);
    }
    if (req.method === "DELETE") { news = news.filter((a) => String(a.id) !== path.split("/")[1]); res.writeHead(204); return res.end(); }
    return json(res, { items: news });
  }
  if (req.method === "PATCH") {
    const [kind, id] = path.split("/");
    const row = (kind === "clips" ? clips : reports).find((r) => String(r.id) === decodeURIComponent(id));
    if (!row) return json(res, { error: "not found" }, 404);
    row.status = (await readBody(req)).status;
    return json(res, { id, status: row.status });
  }
  if (path === "whoami") return json(res, { via: "account", email: "owner@example.com" });
  if (path === "overview") return json(res, overview(days));
  if (path === "content") return json(res, content(days));
  if (path === "daily") return json(res, daily(url));
  if (path === "luna") return json(res, luna(days));
  if (path === "clips") return json(res, { clips: page(clips), total: clips.length, eventsEnabled: EVENTS });
  if (path === "reports") {
    const st = url.searchParams.get("status");
    const rows = st && st !== "all" ? reports.filter((r) => r.status === st) : reports;
    return json(res, { reports: page(rows), total: rows.length });
  }
  if (path === "users") return json(res, { users: page(users), total: users.length });
  return json(res, { error: "not found" }, 404);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/admin/api/")) return await api(req, res, url);
    if (url.pathname === "/admin") { res.writeHead(307, { Location: "/admin/" }); return res.end(); }
    if (url.pathname.startsWith("/admin/")) {
      const file = normalize(url.pathname.slice("/admin/".length) || "index.html").replace(/^(\.\.[/\\])+/, "");
      const body = await readFile(join(DIST, file === "." ? "index.html" : file)).catch(() => null);
      if (!body) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      return res.end(body);
    }
    // everything else (media, config, surah names) comes from the deployed Worker
    const up = await fetch(REAL + url.pathname + url.search);
    res.writeHead(up.status, { "Content-Type": up.headers.get("content-type") ?? "application/octet-stream" });
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, () => console.log(`mock admin on http://localhost:${PORT}/admin/  events: ${EVENTS ? "on" : "off"}`));
