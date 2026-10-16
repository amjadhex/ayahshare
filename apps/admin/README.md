# AyahShare admin

Dashboard for the owner: overview, content, backgrounds, reports, users and AI cost. A separate Vite + TypeScript project,
no framework, no chart library. It builds into `apps/web/dist/admin/` (base `/admin/`), so the Worker serves it as static
assets at `/admin/` next to the web app: https://ayahshare.com/admin/ (and on the test address
https://quran-design.rapid-sun-0190.workers.dev/admin/). It calls the admin API in `apps/api` (contract: `apps/api/src/admin-contract.ts`).

```
npm install
npm run build        # tsc --noEmit && vite build → ../web/dist/admin (only that folder is emptied)
npm run dev          # http://localhost:5173/admin/, API/media from the deployed Worker (API_TARGET=... to change)
npm run mock         # http://localhost:8788/admin/ with made-up numbers (EVENTS=off for "no app events counted yet")
```

Deploy order (see `apps/web/README.md`): build the web app, build this, then `wrangler deploy` from `apps/api`.

## Sign-in

- Sign in with Google: the page shows Google's button and signs in through the app's own `/api/auth/google`, so the session
  is the app's cookie. Only addresses on the Worker's `ADMIN_EMAILS` (`apps/api/wrangler.jsonc`, comma-separated) get in;
  any other account sees "This Google account does not have admin access." Sign out ends the session.
- Behind Cloudflare Access (once set up for `/admin*`) the browser is already signed in: `GET /admin/api/whoami` answers 200
  with the Access email, and the page shows it.
- `ADMIN_TOKEN` (Bearer) still opens the admin API for scripts (the pipeline's ingest); the page never asks for it.
- `npm run mock` is already signed in as a made-up admin.

## Pages

Routes live after the `#` (`#/overview?days=30`) because the Worker answers unknown paths with the web app.

| Page | Shows |
|---|---|
| Overview | active devices (24 h / 7 d / 30 d), new devices, signed-in accounts, shares, open reports; devices per day; funnel open → ayah → export; exports video vs image with success rate and average time; events; countries, operating systems, device types, browsers |
| Content | top ayahs and surahs, top searches, searches nobody clicked, most-asked full searches, top backgrounds, where backgrounds come from, reciters, translations, orientations |
| Backgrounds | every clip with thumbnail, uses, reports and safety flags; filter by status, search, sort; hide / unhide; details with a preview |
| Reports | queue by status; mark done / dismiss / reopen; hide the reported background |
| Users | signed-in accounts, most recent sign-in first |
| AI cost | spend today against the daily cap, spend and calls per day, saved answers |

The time window (7 / 30 / 90 days) is in the URL. While no app events are counted yet (`eventsEnabled: false`) a notice explains what
is missing and event-based cards say so instead of drawing empty charts; the numbers from the database still show.

## Charts

Hand-rolled SVG/HTML in `src/charts.ts`. One message per chart, labelled axes (unit above the y axis, dates below), solid
hairline grid, 2 px lines, columns up to 24 px with a 4 px rounded top, a surface ring on dots. Each time chart has a
Table twin and keyboard support (focus the chart, arrow keys). Hover shows values; every value is also on the page.

Colours are tokens in `src/styles.css`, validated with the dataviz `validate_palette.js` against the card surface:

| Token | Dark | Light | Use |
|---|---|---|---|
| `--s1` | `#bf8a30` | `#a8741c` | the one series (gold) |
| `--s2` | `#3987e5` | `#2a78d6` | the second series (blue) |
| `--ord1..3` | `#e3b25e #c08a35 #8f6726` | `#d9ad5f #bf8a35 #8a5c12` | funnel steps (ordinal ramp) |

`--s1` + `--s2` pass the lightness band, chroma floor, CVD (ΔE 26 protan/deutan), normal-vision floor (ΔE 28) and 3:1 contrast
in both modes (`--pairs all`). The funnel ramp passes `--ordinal` in both modes. Status colours (good / warning / critical) are
used only on badges and always with an icon and a word.
