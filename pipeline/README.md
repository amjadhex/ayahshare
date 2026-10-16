# Offline content pipeline (Track A)

Python jobs that build everything about the ayahs and the background library once, so the app does no AI work at
runtime for them. Every step is idempotent and resumable, runs on its own, and keeps its work under `cache/`
(downloads, local vectors, every Luna answer) and its results under `out/`. Re-running a step re-uses the cache, so a
crashed or stopped run costs nothing to continue.

```
cd pipeline
../.venv/bin/python a1_ayahs.py            # then a2, a3, a4_*, a5 in order
```

Keys come from `../.env` (`OPENROUTER_API_KEY`, `ADMIN_TOKEN`, `PIXABAY_API_KEY`, optional `PEXELS_API_KEY`) and are
never printed. The Worker URL defaults to the deployed dev Worker (`QURAN_DESIGN_URL` overrides it). Wrangler needs
`CLOUDFLARE_ACCOUNT_ID` (or the id file named in `common.py`), otherwise it waits on an account picker.

`--subset` on any step runs the small version (surahs 1, 2, 17, 31, 94, 103, 112-114, ~80 clips) into `out/subset/`
and never publishes: `a3_topics`, `a4_publish` and `a5_suggest` leave `apps/web/public/data/`, R2, D1 and the clips
index alone in subset mode (`a1`/`a2` build the same full ayah data in both modes).
`./run_all.sh [--subset]` runs the whole chain; the full run is meant to be started detached:
`nohup ./run_all.sh > out/logs/full.log 2>&1 &`.

| Step | Script | Writes (published to `apps/web/public/data/`) | Cost |
|---|---|---|---|
| A1 | `a1_ayahs.py` | `surahs.json`, `ayahs-en.json` (+ `out/ayah_docs.json`, the context documents) | free |
| A1b | `a1b_ayah_groups.py` | `out/ayah_groups.json` + `.csv`: per ayah, alone or the range a video must show. Final range from the AI review in `data/ayah_groups_ai.jsonl` (Claude read each ayah with its neighbours and Tafsir al-Muyassar, rules in `data/ayah_groups_ai_instructions.md`); rule result alongside (IndoPak waqf marks, en.sahih sentence ends, "Except..." openings, Alif-Lam-Meem letters, a short hand-checked list); review flags, tafsir-review flag, Ibn Kathir context range | free (AI review stored) |
| A2 | `a2_index.py` | Vectorize `quran-design-ayahs-v2` (6,236 vectors), `out/ayah_index_vectors.npy` | ~$0.19 once (embeddings, cached) |
| A3 | `a3_topics.py` | `topics.json` (300 topics x 30 ranked refs) | Luna ~$1 |
| A4 | `a4_candidates.py`, `a4_screen.py`, `a4_encode.py`, `a4_publish.py` | `clips.json`, R2 media, Vectorize `quran-design-clips-v2`, D1 `clips` rows | Luna ~$0.9, embeddings ~$0.09 |
| A5 | `a5_suggest.py` | `bg/{surah}.json` x 114, `out/sensitive_review.json` | Luna ~$1.2 per full run |
| - | `translations.py` | `translations.json`: the translations the app offers (alquran.cloud's, and the Quran Foundation's that are not the same text), each loaded and checked; needs `QF_CLIENT_ID` / `QF_CLIENT_SECRET` | free |
| - | `ml_lalithasaram.py` | `out/lalithasaram/ml.lalithasaram.json` (Malayalam Lalithasaram text, the text its voice reads, footnotes, surah intros, recording ids) and `ml.lalithasaram.words.json` (word meanings); used with the publisher's permission | free |
| - | `ml_thafheem.py` | `out/thafheem/ml.thafheem.json` (Thafheemul Quran Malayalam: per-ayah translation and short explanation, surah intros, Thafheem's translation blocks) and `ml.thafheem.tafsir.json` (the numbered notes with the ayahs they explain), for the Malayalam tafsir; used with the publisher's permission; paced under their 120/minute limit, about an hour uncached | free |
| - | `spa5k_tafsirs.py` | `fetch` / `qa` / `upload`: 41 candidate editions of spa5k/tafsir_api (pinned commit; Al-Mukhtasar in 30 languages, Al-Sa'di, Ibn Kathir tr/ru, Jalalayn) into `out/spa5k/<id>/<n>.json`; `qa` is the quality gate (coverage ≥ 97%, no U+FFFD or mojibake, expected script, no duplicates) and writes `out/spa5k/manifest.json` and `apps/api/src/lib/owntafsir-editions.ts`; `upload` puts `tafsir/<id>/v1/<n>.json` in R2 (Worker: `lib/owntafsir.ts`) | free |
| - | `validate.py` | checks every published file against `contracts/types.ts` | free |
| - | `eval/search_eval.py` | hit@3 per language for the search eval set | Luna pennies |
| - | `eval/embed_models.py` | `eval/embed_models.md`: the embedding model, sizes and query formats for ayahs and clips | cents (cached) |

## Money and quotas (read this before running anything)

* **Luna** (OpenRouter Decisions): every request goes through `common.luna()`, which caches the answer on disk, writes
  the billed `usage.cost` to `out/costs.jsonl` (summary in `out/costs.json`) and refuses to start a request once total
  spend reaches `LUNA_BUDGET_USD` (default 15). A step that hits the budget stops and says so; nothing is lost.
  Requests that time out client-side may still be billed by OpenRouter without us seeing the cost, so the ledger is a
  lower bound.
* **Embeddings** (`google/gemini-embedding-2` through OpenRouter, 384-d Matryoshka; the Worker embeds search queries
  with the same model, formats and size, `apps/api/src/lib/embed.ts`): `common.embed_remote()` (text) and
  `common.embed_images()` (images) call OpenRouter directly with `OPENROUTER_API_KEY`, cache every input in
  `cache/openrouter_embed.sqlite` (768-d; any `EMBED_DIM` up to that is a prefix, re-normalised, identical to what the
  API returns for that size) and log the spend to `out/embed_costs.jsonl` (OpenRouter reports cost 0 for this model, so
  the ledger is tokens x list price: text $0.20/M, images 258 tokens each at $0.45/M). Batches only go to Google AI
  Studio, whose shared quota sometimes answers HTTP 429; such a batch is retried one input at a time (also served by
  Vertex, same vectors). The prompt formats are `common.EMBED_FORMATS` and must match `FORMATS` in the Worker. Until
  2026-10-08 this was Workers AI EmbeddingGemma 300m (256-d), whose 10,000 neurons/day free allocation kept running out;
  its cached vectors stay in `cache/remote_embed.sqlite`.
* Pixabay: the API list calls are cached in `cache/pixabay/`; only the first <= 12 s of each *kept* clip is read.

## A1 ayahs

Surah list and `en.sahih` from alquran.cloud by ayah number (nothing is generated). Context document per ayah:

```
Surah Al-Baqara (The Cow), verse 153: <ayah>
Before: <end of previous ayah, <= 200 chars>
After: <start of next ayah, <= 200 chars>
```

## A2 search index

`a2_index.py` embeds every ayah twice with gemini-embedding-2 (`kind: "document"`, `title: none | text: ...`) - the
context document and the plain text - adds the two unit vectors, normalises, and upserts `{id: ref, values (384),
metadata: {ref}}` into `quran-design-ayahs-v2` through the Worker. The sum keeps context for short ayahs and the ayah's
own words for long ones. Search queries are embedded as `task: search result | query: Quran verses about <q>`: on
`eval/search_eval.json` that gives hit@3 93 %, hit@10 and hit@30 100 % at 384-d, against 74 % / 92 % / 98 % for the
plain `task: search result | query: <q>` (`eval/embed_models.md`). `python a2_index.py --verify` checks that the
Worker's `/admin/api/ingest/embed` returns the same query vectors as the pipeline and compares the top 5 of a local
cosine search with a direct `wrangler vectorize query`.

## A3 topics

`taxonomy.py` holds 300 topics (id + English label: God and faith, mercy and forgiveness, hardship and emotions,
worship, character, family and society, the afterlife, prophets, nature and signs, law and belief). For each topic:

1. **Shortlist 100** with EmbeddingGemma 2 (local): the topic label and "Quran verses about <label>" as `SearchQuery`
   against the context documents *and* the plain ayah texts, fused with reciprocal-rank fusion.
2. **Luna scores** every shortlisted ayah in one request (a 5-level "how well does this verse speak about the topic"
   score question per ayah). A single 100-way *choice* question returns only ~20 non-zero probabilities, a score per ayah
   ranks all of them for about the same price.
3. **Second round**: 100 more ayahs nearest to the centroid of the 8 best-scoring ones (many famous ayahs use other words
   than the label, e.g. "invocation" for dua) are scored the same way.
4. The best 30 of the 200, best first, go to `topics.json`.

`eval/search_eval.json` has 61 queries (English, Malayalam, Arabic, Urdu, Hindi, Indonesian) with well-known expected
ayahs; a query is a hit when an expected ref is in the top 3. `python eval/search_eval.py topics` simulates the generic
search path (Luna routes the query to a topic, the topic's list is the result), `python eval/search_eval.py embedding`
measures the Vectorize-only path.

## A4 backgrounds

1. `a4_candidates.py` - ~65 queries over 60 calm themes (`THEMES`) on Pixabay (Pexels too when `PEXELS_API_KEY` is set;
   that code path is untested because the key is empty). Drops clips < 6 s, flagged low quality, creators who opted out of
   AI use, and sources that would need > 1.25x upscaling for 720x1280 / 1280x720 (so 1080p sources; 720p ones would give a
   blurry portrait crop). Picks the smallest rendition that fits.
2. `a4_screen.py` - downloads only the small preview frame, embeds frame + tags with EmbeddingGemma 2, and asks Luna in
   one request: people (incl. silhouettes, hands), animals, text/logo/watermark, other-faith symbols, immodest content,
   a book or religious object being burned/torn/disrespected (reject at 0.3), green/blue-screen or overlay assets on a
   flat key colour (reject at 0.5, like text/logo), "abstract or dark" (the only clips sensitive ayahs may use), and a calm/beautiful/
   text-friendly score. Selects the best N (`--keep`, default 1200) with a per-theme cap, near-duplicate removal and a
   reserved share of abstract clips, plus 15 % spares. Clips whose Pixabay *tags* name people, animals or other faiths
   (`BLOCKED_TAG`: bird, fish, couple, silhouette, christmas..., green screen, chroma) are never selected: the tags
   catch what a single preview frame misses (a far-away bird, a couple on a beach). `REMOVED` in `a4_screen.py` lists
   clips a person removed after looking at them; they are never selected, encoded or published again.
3. `a4_encode.py` - `ffmpeg -t 12 -i <source url>` (range requests; only the first 12 s are fetched), crop/scale to both
   orientations in one pass, H.264 CRF 28, no audio, faststart, last second cross-faded into the first. Posters are the
   frame at 1 s, thumbnails 240x426 WebP. Then the encoded clip is checked again: a pixel test rejects posters that
   are more than half saturated key green (green-screen assets Luna can miss), and Luna answers the safety questions
   on three frames (a preview frame cannot show what appears later). Spares replace rejected clips. A clip encoded
   before a safety question was added is checked again with the current questions on the next run (`checked` in
   `cache/encoded/<id>.json`). The current library (`out/encoded.json`) always goes first in the queue, so a rerun
   never drops a clip that passes the checks; without `--keep` the target is the current library size.
4. `a4_publish.py` - uploads to R2 via the ingest endpoint (skips what `out/uploaded.json` already lists), writes
   `clips.json`, embeds each clip (see below) and upserts the `clips` index, and applies
   `out/clips.sql` with `wrangler d1 execute --remote`. **D1 note:** `video_key` and `poster_key` hold the JSON string
   `{"portrait": "...", "landscape": "..."}`, `thumb_key` is the plain key. Existing rows keep their `status` (an admin
   may have hidden or rejected a clip). Active clips that left the library are set to `rejected` and listed in
   `out/retired.json`; only clips on that list are set back to `active` when they return, so an admin's decision is
   never undone. The tag `ai generated` is dropped from
   `caption`/`tags` (Pixabay's label for generated footage, not something the UI should show) and clips that
   `tag_blocked()` flags are left out.

   Clip vectors (`clip_vectors()`): the unit sum of the landscape poster's image embedding and the `caption + theme
   words` text embedding, both gemini-embedding-2. Library search embeds the user's text as
   `task: search result | query: <q>`. Measured on 14 library queries (`eval/embed_models.md`, contact sheets checked
   by eye): image + caption 98 % of the top 8 fitting, caption alone 92 % (misses "calm abstract"), image alone 73 %
   (misses e.g. mosques). They run last and can be rerun alone: `python a4_publish.py --vectors-only`.
   `./retry_vectors.sh` was for the Workers AI daily quota and is no longer needed.

Library size: the first selection (`--keep 800` over the 3,504 candidates screened at that point) gave 798 clips, of
which 715 survived encoding (42 had fewer than 6 s of real video, 41 were rejected on the three encoded frames) and 686
survived the tag filter. On 2026-10-08 the full library was checked again with the burned-book and key-colour
questions: two clips were removed by hand (`REMOVED`) and four overlay/green-screen clips failed the new checks
(pb121583, pb2369, pb26962, pb40810); four spares replaced them, so the library is 684 clips. **`out/encoded.json` is
the library** (best first); `out/selected.json` is only the latest
selection (re-run over all 5,980 screened candidates) and lists clips that were never encoded. To grow the library to
N clips: `python a4_screen.py --keep N` (free, from the cache), `a4_encode.py --keep N` (the current library is kept
and reused; only new clips are encoded), `a4_publish.py`, `a5_suggest.py`. To add clips only from chosen themes
(e.g. the `GAP_THEMES` in `a4_candidates.py`: gardens, fruit, crops, shade, night/day, space and science, added
2026-10-08): `a4_candidates.py`, then `a4_screen.py --themes gap --keep N` (N = clips to add), then
`a4_encode.py --keep <library size + N>`. To remove a clip for good, hide it in
admin right away, then add it to `REMOVED` and rerun `a4_encode.py`, `a4_publish.py`, `a5_suggest.py`.

`clips.json` follows `contracts/types.ts` exactly; source, author, page URL, safety numbers and quality are only in D1
and `out/clips_meta.json`.

## A5 per-ayah backgrounds

For each ayah: query "A calm, beautiful video background that fits the mood of this verse: <text>" (the context document
for ayahs shorter than 40 characters) vs the clip vectors, corrected for hubness (a clip that matches everything gets
a penalty), shortlist 24 (14 by meaning, the rest abstract/dark clips), then **one** Luna request with the 24 thumbnails
(160 px wide) - `pick` (choice, best background) and `sensitive` (noul: punishment, Hellfire, war, death). Ranking =
Luna's probabilities, then embedding order. Sensitive (>= 0.5) ayahs keep only abstract/dark clips. A clip already in the
top 8 of `cap` ayahs goes last, so a few favourites do not appear everywhere. If Luna fails for an ayah (4 s timeout,
then 8 s, 15 s) it is treated as sensitive (abstract clips by meaning) and listed in `out/bg_report.json`; rerunning the
step retries only those. `out/sensitive_review.json` is the list for the human review in Phase 5.

Full run (684 clips): 6,236 ayahs, 570 clips used in some top 8, 1,404 ayahs flagged sensitive, no Luna failures, no
ayah with fewer than 4 suggestions. About a fifth of the Qur'an is flagged because the question is broad (any punishment,
war or death); the flag only restricts the suggestions to calm/abstract clips, so it errs on the safe side. Review the
list in `out/sensitive_review.json` (best first, with Luna's probability) before launch.

## Files you may want

* `out/costs.json` - Luna spend by step. `out/logs/` - logs of detached runs.
* `out/clips_meta.json`, `out/clips.sql` - what went into D1.
* `out/sensitive_review.json`, `out/bg_report.json` - A5 review lists and coverage.
