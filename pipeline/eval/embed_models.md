# Embedding model eval: google/gemini-embedding-2

Written by `eval/embed_models.py` (2026-10-08). Owner decision: gemini-embedding-2 (OpenRouter) is the one embedding model for ayah search and the background library (text queries vs ayah text and clip poster images), replacing Workers AI EmbeddingGemma 300m, whose 10,000 neurons/day free allocation kept running out. The other OpenRouter candidates were not run.

## Decision

- Size: **384-d** (Matryoshka; OpenRouter passes `dimensions` through and the result equals the re-normalised prefix of the 3072-d vector). It matches 512-d and 768-d on hit@10/hit@30, beats 256-d, and 6,236 ayahs + ~690 clips = 2.66 M stored dimensions fit the Vectorize free 5 M next to the old 256-d indexes.
- Ayah query format: `task: search result | query: Quran verses about <q>`; documents `title: none | text: <text>`. Google's plain `task: search result | query: <q>` template ranked famous ayahs much lower, especially for one-word and non-English queries (table below).
- Clips: vector = unit sum of the landscape poster's image embedding and the caption + theme words' text embedding; library queries are `task: search result | query: <q>`. The image alone was weakest (mosque, mountains, waterfall), the caption alone missed "calm abstract", one combined image + caption input too; the sum was best on the tag check and by eye.
- OpenRouter routing: a request with more than one input can only go to Google AI Studio, whose shared quota answered HTTP 429 during the bulk run; single inputs also go to Vertex. Both return the same vectors (cosine 1.0000), so the pipeline retries a 429 batch one input at a time and the Worker sends one query per request. `input_type: search_query` gives the same vector as the `task: search result | query:` prefix.

## Ayah search

61 queries from `search_eval.json` (en 26, ml/ar/ur/hi/id 7 each) and the owner's 5 queries. Index vector = unit sum of the context document and the plain ayah, each `title: none | text: ...`. hit@k = an expected ref in the top k; Luna reranks the top 30-40, so hit@30 matters most.

| Variant | hit@3 | hit@10 | hit@30 | MRR | owner hit@10 | owner hit@30 |
|---|---|---|---|---|---|---|
| gemini-embedding-2 256-d, `task: search result \| query: Quran verses about ...` (deployed) | 85% | 98% | 100% | 0.83 | 80% | 100% |
| gemini-embedding-2 256-d, `task: search result \| query: ...` (Google's template) | 64% | 85% | 95% | 0.60 | 40% | 60% |
| gemini-embedding-2 256-d, raw query | 67% | 87% | 98% | 0.63 | 80% | 80% |
| gemini-embedding-2 384-d, `task: search result \| query: Quran verses about ...` (deployed) | 93% | 100% | 100% | 0.87 | 100% | 100% |
| gemini-embedding-2 384-d, `task: search result \| query: ...` (Google's template) | 74% | 92% | 98% | 0.65 | 40% | 60% |
| gemini-embedding-2 384-d, raw query | 79% | 87% | 98% | 0.66 | 40% | 80% |
| gemini-embedding-2 512-d, `task: search result \| query: Quran verses about ...` (deployed) | 93% | 100% | 100% | 0.88 | 100% | 100% |
| gemini-embedding-2 512-d, `task: search result \| query: ...` (Google's template) | 72% | 90% | 93% | 0.65 | 40% | 40% |
| gemini-embedding-2 512-d, raw query | 80% | 92% | 98% | 0.67 | 40% | 60% |
| gemini-embedding-2 768-d, `task: search result \| query: Quran verses about ...` (deployed) | 92% | 100% | 100% | 0.86 | 100% | 100% |
| gemini-embedding-2 768-d, `task: search result \| query: ...` (Google's template) | 80% | 95% | 97% | 0.67 | 60% | 60% |
| gemini-embedding-2 768-d, raw query | 80% | 98% | 100% | 0.72 | 60% | 100% |

Baseline (Workers AI EmbeddingGemma 300m): not measurable on the day of the switch. The query vectors were never cached and the account's Workers AI allocation was used up (AiError 4006) when this ran, which is the outage being fixed: live, fast search returned no results for every query.

Per language at the deployed size (384-d, deployed query format):

| Lang | n | hit@3 | hit@10 | hit@30 | MRR |
|---|---|---|---|---|---|
| ar | 7 | 86% | 100% | 100% | 0.81 |
| en | 26 | 96% | 100% | 100% | 0.91 |
| hi | 7 | 86% | 100% | 100% | 0.81 |
| id | 7 | 86% | 100% | 100% | 0.89 |
| ml | 7 | 100% | 100% | 100% | 0.90 |
| ur | 7 | 100% | 100% | 100% | 0.76 |

Owner queries: rank of the first expected ayah by index size, and the top 5 at the deployed size.

| Query | expected | 256-d | 384-d | 512-d | 768-d | top 5 (384-d) |
|---|---|---|---|---|---|---|
| spider web | 29:41 | 1 | 1 | 1 | 1 | 29:41, 29:44, 29:42, 22:73, 29:3 |
| honey as healing | 16:68, 16:69 | 1 | 1 | 1 | 1 | 16:69, 16:68, 17:82, 27:2, 27:77 |
| ജോലി നഷ്ടപ്പെട്ടപ്പോൾ ആശ്വാസം | 94:5, 94:6, 65:2, 65:3 | 5 | 9 | 7 | 6 | 12:86, 38:67, 2:155, 2:156, 19:9 |
| ക്ഷമ | 2:153, 2:155, 39:10, 3:200 | 2 | 3 | 3 | 3 | 70:5, 18:68, 2:153, 2:155, 11:11 |
| dealing with a difficult boss | 73:10, 16:127, 41:34 | 22 | 6 | 8 | 1 | 27:31, 40:44, 23:96, 16:126, 11:55 |

## Query latency and cost

Single query from this Mac (India) to OpenRouter at 384-d, 10 requests: median 1.10 s, p90 1.26 s, min 0.98 s, max 1.31 s. Live on 2026-10-08 (30 new queries, fast mode, from India): the Worker's wall time was median ~1.2 s, max 2.3 s with the embedding at most ~2 s (its timeout), the rest the Vectorize query (~0.25 s); a query whose vector is already in the colo's cache answers in ~0.3 s.

Price: $0.20 per million text tokens, images 258 tokens each at $0.45 per million (about $0.0001 per image). The ayah corpus (both documents per ayah) is about 0.9 M tokens, about $0.19 once; a search query is about 10 tokens ($0.000002).
Embedding spend recorded for this work (out/embed_costs.jsonl, tokens x list price; OpenRouter reported a cost of 0 for every request): $0.353.

Dimensions: Vectorize free tier = 5 M stored dimensions across all indexes. 6,236 ayahs + 686 clips = 6,922 vectors: 256-d = 1.77 M, 384-d = 2.66 M, 512-d = 3.54 M. The old 256-d indexes (1.77 M) stay until they are deleted, so 512-d would not fit next to them.

## Background clips (text query -> clip vectors)

| Variant | ocean | night sky | rain | desert | mountains | light | mosque | calm abstract | forest | clouds | sunset | flowers | snow | waterfall | mean |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| caption (text), task query | 100% | 100% | 100% | 100% | 100% | 100% | 88% | 0% | 100% | 100% | 100% | 100% | 100% | 100% | 92% |
| poster image, task query | 75% | 88% | 100% | 88% | 50% | 62% | 50% | 25% | 100% | 100% | 50% | 88% | 100% | 50% | 73% |
| poster image, raw query | 88% | 100% | 100% | 88% | 62% | 62% | 62% | 38% | 88% | 100% | 50% | 88% | 100% | 88% | 79% |
| image + caption (one input), task query | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 0% | 100% | 100% | 100% | 100% | 100% | 100% | 93% |
| image vec + caption vec, task query | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 88% | 100% | 100% | 88% | 100% | 100% | 100% | 98% |

tag p@8 counts a clip as fitting when its Pixabay tags contain a word for the query, so it favours the caption variants and misses fitting clips with poor tags; the contact sheets (`--sheets`, out/eval_clips/) were checked by eye.

Top 8 per library query (caption | poster image):

- **ocean**
  - caption (text): pb133217 (sea, ocean, sun, reflections, water surf); pb19609 (ocean, waves, splash, sea front, spray, ); pb217836 (ocean, shiny, sunlight, abstract, sea, w); pb187355 (ocean, sea, waves, sunset, sunrise, wate); pb87816 (sea, ocean, beach, waves, tourism, holid); pb174033 (ocean, sea, waves, moon, night, water); pb286278 (waves, water, sea, seascape, ocean, hori); pb74637 (ocean, sea, sky, calm, meditation, tranq)
  - poster image: pb286278 (waves, water, sea, seascape, ocean, hori); pb918 (blue, water, ray, sun, light); pb121576 (satellite, star, space, sky, astronomy, ); pb33194 (sea, iceland, ocean, water, sky, panoram); pb63560 (ocean, waves, sea, water, seascape, beam); pb74637 (ocean, sea, sky, calm, meditation, tranq); pb348911 (pebble, sunset, beach, sea, shore, wave); pb205704 (water, waves, glitter, sunbeams, sunny, )
  - image vec + caption vec: pb286278 (waves, water, sea, seascape, ocean, hori); pb19609 (ocean, waves, splash, sea front, spray, ); pb133217 (sea, ocean, sun, reflections, water surf); pb74637 (ocean, sea, sky, calm, meditation, tranq); pb348908 (ocean, remote, horizon, scenic, seascape); pb174033 (ocean, sea, waves, moon, night, water); pb217836 (ocean, shiny, sunlight, abstract, sea, w); pb63560 (ocean, waves, sea, water, seascape, beam)
- **night sky**
  - caption (text): pb159300 (sky, night, stars, nature); pb174750 (sky, stars, night, universe, motion, sci); pb121569 (night, space, star, stars, light, galaxy); pb35419 (star, guadarrama, madrid, sierra, sky, n); pb210492 (tent, camp, night, sky, stars, trees); pb14955 (starry sky, seis am schlern, south-tirol); pb134252 (stars, starry sky, polar star, night sky); pb176986 (stars, sky, space, galaxy, spin, night)
  - poster image: pb158166 (stars, beautiful wallpaper, falling star); pb176986 (stars, sky, space, galaxy, spin, night); pb23567 (clouds, stars, full moon, night sky, lig); pb15712 (glitter, sparkles, overlay, white, eleme); pb134252 (stars, starry sky, polar star, night sky); pb219754 (starry sky, night sky, moon, moonrise, m); pb115427 (glow, light, dark, abstract, space, star); pb27770 (space to view, space traveling, space tr)
  - image vec + caption vec: pb134252 (stars, starry sky, polar star, night sky); pb159300 (sky, night, stars, nature); pb176986 (stars, sky, space, galaxy, spin, night); pb219754 (starry sky, night sky, moon, moonrise, m); pb174750 (sky, stars, night, universe, motion, sci); pb115427 (glow, light, dark, abstract, space, star); pb210492 (tent, camp, night, sky, stars, trees); pb23567 (clouds, stars, full moon, night sky, lig)
- **rain**
  - caption (text): pb31393 (rain drops, rain, mud); pb144780 (rain, drops, puddle, road, weather); pb42902 (rain, water, yard, floors, wet, drops); pb191224 (rain, rainy, raindrops, rainstorm, rainy); pb9192 (rain, waterdrop, raindrop, water, foil, ); pb65684 (branch, drops, dewdrop, rain, wet, water); pb217713 (rain, puddle, water, raindrops, nature, ); pb114636 (rain, water, sorrow, calm, raining, car)
  - poster image: pb6847 (rain, field, wind, blow, storm, precipit); pb144780 (rain, drops, puddle, road, weather); pb217713 (rain, puddle, water, raindrops, nature, ); pb42902 (rain, water, yard, floors, wet, drops); pb219031 (rain, rainy, water, glass, window, storm); pb161060 (storm, thunder, wet, weather, overlay, r); pb85526 (tree, leaves, foliage, rain, drops, trop); pb114636 (rain, water, sorrow, calm, raining, car)
  - image vec + caption vec: pb42902 (rain, water, yard, floors, wet, drops); pb144780 (rain, drops, puddle, road, weather); pb31393 (rain drops, rain, mud); pb217713 (rain, puddle, water, raindrops, nature, ); pb161060 (storm, thunder, wet, weather, overlay, r); pb219031 (rain, rainy, water, glass, window, storm); pb114636 (rain, water, sorrow, calm, raining, car); pb9192 (rain, waterdrop, raindrop, water, foil, )
- **desert**
  - caption (text): pb108420 (desert, beautiful wallpaper, sand, dune,); pb94821 (sunset, desert, road, sun, landscape, li); pb92842 (sand, desert, dunes, beach, nature, trav); pb147667 (desert, dunes, fog, clouds, abstract, ab); pb189392 (desert, sand dunes, outdoor, nature, vie); pb16139 (dunes, desert, gobi, sahara, travel, adv); pb171249 (giraffes, sunset, tree, desert, africa); pb284568 (namibia, nature, africa, drone, desert, )
  - poster image: pb189392 (desert, sand dunes, outdoor, nature, vie); pb108420 (desert, beautiful wallpaper, sand, dune,); pb284568 (namibia, nature, africa, drone, desert, ); pb16139 (dunes, desert, gobi, sahara, travel, adv); pb92842 (sand, desert, dunes, beach, nature, trav); pb201409 (sunset, forest, lake, sun, dusk, trees); pb43953 (rock, formation, new mexico, desert, can); pb284559 (ocean, beach, dunes, namibia, africa, dr)
  - image vec + caption vec: pb92842 (sand, desert, dunes, beach, nature, trav); pb108420 (desert, beautiful wallpaper, sand, dune,); pb16139 (dunes, desert, gobi, sahara, travel, adv); pb189392 (desert, sand dunes, outdoor, nature, vie); pb147667 (desert, dunes, fog, clouds, abstract, ab); pb284568 (namibia, nature, africa, drone, desert, ); pb126788 (mosque, muslim, islam, desert, sunset, d); pb94821 (sunset, desert, road, sun, landscape, li)
- **mountains**
  - caption (text): pb134302 (mountains, peaks, summit, view, landscap); pb31174 (mountains, snow, nature, landscape, cold); pb22903 (mountain, snow, landscape, winter, natur); pb205116 (fields, snow, peaks, mountain, sky, clou); pb135181 (mountain landscape, cloudscape, nature, ); pb171240 (mountains, lake, snow, nature); pb204564 (mountain, peak, fog, mist, sky, nature); pb15347 (lake, snow mountain, landscape, nature, )
  - poster image: pb262156 (monte san salvatore, backlighting, lake,); pb35304 (mountains, stars, sky, georgia, gudaur, ); pb124291 (moon, full moon, rising moon, night, mou); pb133254 (blue sky, clouds, contrails, lovely, cum); pb201409 (sunset, forest, lake, sun, dusk, trees); pb65954 (mountain, stream, creek, grass, nature, ); pb2093 (white clouds, blue sky, beautiful wallpa); pb31174 (mountains, snow, nature, landscape, cold)
  - image vec + caption vec: pb31174 (mountains, snow, nature, landscape, cold); pb134302 (mountains, peaks, summit, view, landscap); pb135181 (mountain landscape, cloudscape, nature, ); pb204564 (mountain, peak, fog, mist, sky, nature); pb124291 (moon, full moon, rising moon, night, mou); pb22903 (mountain, snow, landscape, winter, natur); pb171240 (mountains, lake, snow, nature); pb205116 (fields, snow, peaks, mountain, sky, clou)
- **light**
  - caption (text): pb84893 (light, rays, laser, beam of light, lens ); pb29353 (light, flare, shiny, design, lightning, ); pb137009 (moonlight, night, moon, outlook, lightin); pb121783 (light, bright, ice, glow, star, design); pb203336 (particles, beautiful wallpaper, rays, bl); pb121461 (laser, light, fractal, lightning, digita); pb115427 (glow, light, dark, abstract, space, star); pb31579 (sunset, darling, landscape, nature, ligh)
  - poster image: pb84882 (leaf, foliage, green, jungle, tropical, ); pb201409 (sunset, forest, lake, sun, dusk, trees); pb23167 (bokeh, blender 3d, beautiful wallpaper, ); pb17070 (science, cosmos, space, galaxy, stars, c); pb228930 (trees, sunset, sunrise, sun, summer, for); pb27770 (space to view, space traveling, space tr); pb231939 (sky, sunset, clouds, evening atmosphere,); pb3787 (bokeh, light, blue, defocused, blurred, )
  - image vec + caption vec: pb84893 (light, rays, laser, beam of light, lens ); pb7805 (lights, bokeh, effect, lamp, lava lamp, ); pb121531 (ray, stingray, black, electric ray, text); pb29353 (light, flare, shiny, design, lightning, ); pb121806 (fantasy, light, space, art, design, beau); pb918 (blue, water, ray, sun, light); pb137009 (moonlight, night, moon, outlook, lightin); pb115427 (glow, light, dark, abstract, space, star)
- **mosque**
  - caption (text): pb203903 (mosque, pattern, frame, decorative, isla); pb85341 (paint, roller, painter, dye, repair, des); pb40704 (mosque, astana, religion, nur-sultan, mu); pb169475 (mosque, muslim, islam, islamic, arabic, ); pb201668 (ramadan, islam, mosque, prayer, pray, ar); pb131292 (mosque, islamic, quran, islam, muslim, r); pb201655 (islam, mosque, islamic, muslim, arabic, ); pb126788 (mosque, muslim, islam, desert, sunset, d)
  - poster image: pb40704 (mosque, astana, religion, nur-sultan, mu); pb203903 (mosque, pattern, frame, decorative, isla); pb133254 (blue sky, clouds, contrails, lovely, cum); pb201655 (islam, mosque, islamic, muslim, arabic, ); pb231939 (sky, sunset, clouds, evening atmosphere,); pb131292 (mosque, islamic, quran, islam, muslim, r); pb228930 (trees, sunset, sunrise, sun, summer, for); pb214784 (sky, blue sky, clouds, fluffy clouds, pa)
  - image vec + caption vec: pb40704 (mosque, astana, religion, nur-sultan, mu); pb203903 (mosque, pattern, frame, decorative, isla); pb201655 (islam, mosque, islamic, muslim, arabic, ); pb201668 (ramadan, islam, mosque, prayer, pray, ar); pb131292 (mosque, islamic, quran, islam, muslim, r); pb202964 (ramadan, islamic, islam, eid, mosque, ra); pb126788 (mosque, muslim, islam, desert, sunset, d); pb169475 (mosque, muslim, islam, islamic, arabic, )
- **calm abstract**
  - caption (text): pb74637 (ocean, sea, sky, calm, meditation, tranq); pb22713 (sunrise, calm sea, darling, landscape, b); pb351794 (calm, detail, beach, sea, ocean, sand); pb137126 (ocean, waves, relaxing, relax, calm, pla); pb87816 (sea, ocean, beach, waves, tourism, holid); pb169468 (sea, waves, beach, calm, ripples, austra); pb141426 (sea, beach, sunset, waves, calm down, br); pb121874 (park, trees, wood, forest, calm, peacefu)
  - poster image: pb121531 (ray, stingray, black, electric ray, text); pb12689 (sunrise, dawn, sea, heaven, fire red, mo); pb133896 (sunset, ocean, sea, beach, shore, waves); pb28417 (water, lake, water surface, lake surface); pb120769 (stars, beautiful wallpaper, space, snow,); pb47712 (wave, water, curve, deep, science, futur); pb231939 (sky, sunset, clouds, evening atmosphere,); pb23167 (bokeh, blender 3d, beautiful wallpaper, )
  - image vec + caption vec: pb74637 (ocean, sea, sky, calm, meditation, tranq); pb6266 (blue, lines, beautiful wallpaper, abstra); pb116618 (milk, liquid, abstract, pattern, texture); pb1221 (flight, mountains, radar, relief, dark, ); pb4866 (yellow, beautiful wallpaper, abstract, w); pb121531 (ray, stingray, black, electric ray, text); pb4382 (liquid, lights, intro, blue, blur, bokeh); pb18849 (plexus hd, beautiful wallpaper, abstract)
- **forest**
  - caption (text): pb32822 (forest, green, nature, landscape, enviro); pb379512 (forest, nature, trees, woods, landscape,); pb85837 (trees, woods, forest, sunlight, woodland); pb170202 (waterfall, forest, nature); pb136785 (path, forest, woods, steam, stump, natur); pb14710 (forest, trees, green, wood, season, wint); pb27045 (trees, softwood, conifers, forest, sunli); pb40034 (forest, rain, fog, trees, night, nature)
  - poster image: pb32822 (forest, green, nature, landscape, enviro); pb203449 (forest, trees, sunlight, old forest, dar); pb27045 (trees, softwood, conifers, forest, sunli); pb29716 (forest, grass, lake, trees, mountain, mo); pb121874 (park, trees, wood, forest, calm, peacefu); pb12768 (trees, forest, graveyard, nature, landsc); pb228930 (trees, sunset, sunrise, sun, summer, for); pb77855 (trees, leaves, rays, flare, tree tops, s)
  - image vec + caption vec: pb32822 (forest, green, nature, landscape, enviro); pb85837 (trees, woods, forest, sunlight, woodland); pb29716 (forest, grass, lake, trees, mountain, mo); pb12768 (trees, forest, graveyard, nature, landsc); pb379512 (forest, nature, trees, woods, landscape,); pb27045 (trees, softwood, conifers, forest, sunli); pb203449 (forest, trees, sunlight, old forest, dar); pb14710 (forest, trees, green, wood, season, wint)
- **clouds**
  - caption (text): pb217955 (clouds, sky, blue, beautiful, swelling c); pb46144 (winds, sky, clouds, storm, cloudy, rain); pb200537 (sky, clouds, weather, drone, aerial, clo); pb116039 (clouds, hover, move, heaven, nature, bea); pb280145 (cloudscape, sky, weather, atmosphere, cu); pb186245 (clouds, rain, storm, weather, sun, eveni); pb2166 (cloudscape, cloud, sunset, sunrise, sky,); pb33163 (sky, clouds, wind, blue)
  - poster image: pb116039 (clouds, hover, move, heaven, nature, bea); pb133254 (blue sky, clouds, contrails, lovely, cum); pb4071 (weather, sun rays, beautiful, beauty, be); pb90906 (clouds, cumulus, heaven, wind, the atmos); pb216929 (sky, clouds, wind, nature, forest, sun); pb214784 (sky, blue sky, clouds, fluffy clouds, pa); pb3281 (sky, clouds, red, dark, blue, atmosphere); pb4633 (sky, clouds, sunset, time, blue, white)
  - image vec + caption vec: pb46144 (winds, sky, clouds, storm, cloudy, rain); pb217955 (clouds, sky, blue, beautiful, swelling c); pb116039 (clouds, hover, move, heaven, nature, bea); pb33163 (sky, clouds, wind, blue); pb200537 (sky, clouds, weather, drone, aerial, clo); pb214784 (sky, blue sky, clouds, fluffy clouds, pa); pb14409 (heaven, clouds, cloudy, background of bl); pb90906 (clouds, cumulus, heaven, wind, the atmos)
- **sunset**
  - caption (text): pb264960 (beach, sunset, sky); pb228230 (sea, sunset, dusk, beach, ocean, sky); pb31579 (sunset, darling, landscape, nature, ligh); pb126920 (sunset, window, sun, sky, curtains, clou); pb231939 (sky, sunset, clouds, evening atmosphere,); pb210592 (sunset, night time, night lights, view, ); pb186714 (sunset, sky, clouds, fields, nature); pb116009 (sunset, waves, sea, water, wind, sun)
  - poster image: pb201409 (sunset, forest, lake, sun, dusk, trees); pb231939 (sky, sunset, clouds, evening atmosphere,); pb4071 (weather, sun rays, beautiful, beauty, be); pb3281 (sky, clouds, red, dark, blue, atmosphere); pb135921 (sunlight, beauty, horizon, light, skylin); pb14409 (heaven, clouds, cloudy, background of bl); pb44644 (sky, landscape, sunset, mountains, sunri); pb133548 (sunrise, sea, waves, water surface, sun)
  - image vec + caption vec: pb231939 (sky, sunset, clouds, evening atmosphere,); pb201409 (sunset, forest, lake, sun, dusk, trees); pb31579 (sunset, darling, landscape, nature, ligh); pb135921 (sunlight, beauty, horizon, light, skylin); pb264960 (beach, sunset, sky); pb39333 (sunset, buildings, sun, sky, red, nature); pb199468 (sky, clouds, sunset, dusk, sun, scenery); pb34623 (sunset, haze, sun, mood, light, sunlight)
- **flowers**
  - caption (text): pb149940 (flower, blossom, bloom, freesia, to flou); pb166585 (rose, flower, rose flower, blossom, bloo); pb222604 (flower, rose, yellow, blossom, rose flow); pb27689 (alpine meadow, alpine flowers, bloom, wi); pb267884 (tulip, blossom, bloom, flower, nature, t); pb164286 (magnolia, blossom, rose flower, bloom, r); pb355788 (bellflower, flower, blossom, bloom, plan); pb216101 (flower, bloom, blossom, sea, ocean, coas)
  - poster image: pb355423 (scabiosis, blossom, bloom, flower, natur); pb187246 (flower, silphie, blossom, bloom, yellow,); pb261106 (winterling, plant, nature, blossom, bloo); pb10745 (thunderstorm, rain, shower, cloudburst, ); pb291470 (vetch, flower, blossom, bloom, to flouri); pb355788 (bellflower, flower, blossom, bloom, plan); pb172980 (scumwort, flower, violet, wildflowers, m); pb100258 (akalei, flower, to flourish, bloom, blos)
  - image vec + caption vec: pb100258 (akalei, flower, to flourish, bloom, blos); pb74279 (flowers, cereal, dew drops, nature, spri); pb355788 (bellflower, flower, blossom, bloom, plan); pb355423 (scabiosis, blossom, bloom, flower, natur); pb291470 (vetch, flower, blossom, bloom, to flouri); pb267884 (tulip, blossom, bloom, flower, nature, t); pb27689 (alpine meadow, alpine flowers, bloom, wi); pb149940 (flower, blossom, bloom, freesia, to flou)
- **snow**
  - caption (text): pb9999 (snow, snowfall, snowflakes, snowflake, w); pb1222 (snowfall, winter, winter landscape, snow); pb190724 (snow, frost, winter, sky, falling, natur); pb171240 (mountains, lake, snow, nature); pb31174 (mountains, snow, nature, landscape, cold); pb82218 (trees, forest, snow, winter, nature, lan); pb253308 (trees, snow, adventure, winter, cold, wh); pb22903 (mountain, snow, landscape, winter, natur)
  - poster image: pb190724 (snow, frost, winter, sky, falling, natur); pb60780 (road, snow, pickup, aerial, landscape, w); pb253308 (trees, snow, adventure, winter, cold, wh); pb192042 (trees, snow, covered in snow, nature, wi); pb143637 (winter, icicle, snow, sunny, conifer, su); pb21554 (mystical, snow, fog, mountains, evening,); pb142579 (pine, forest, snow, winter, snowfall); pb31318 (winter, snow, night, holidays, house, hu)
  - image vec + caption vec: pb190724 (snow, frost, winter, sky, falling, natur); pb9999 (snow, snowfall, snowflakes, snowflake, w); pb1222 (snowfall, winter, winter landscape, snow); pb253308 (trees, snow, adventure, winter, cold, wh); pb60780 (road, snow, pickup, aerial, landscape, w); pb142579 (pine, forest, snow, winter, snowfall); pb192042 (trees, snow, covered in snow, nature, wi); pb107487 (nature, landscape, tree, snow, sleet, wi)
- **waterfall**
  - caption (text): pb170202 (waterfall, forest, nature); pb190325 (creek, waterfall, nature, landscape); pb170060 (waterfall, rocks, river, cascade, forest); pb131685 (waterfall, peace, relax, meditation, nat); pb183638 (waterfall, water, leaves, trees, jungle,); pb40744 (waterfall, small, bach, canyon, water, n); pb356398 (waterfall, river, view, nature, that, fl); pb314 (waterfall, tropical, iguazu falls, casca)
  - poster image: pb82973 (flower, yarrow, plant, waterfall, wild f); pb107976 (nature, waterfall, tropical, rain, storm); pb131685 (waterfall, peace, relax, meditation, nat); pb2093 (white clouds, blue sky, beautiful wallpa); pb228930 (trees, sunset, sunrise, sun, summer, for); pb214784 (sky, blue sky, clouds, fluffy clouds, pa); pb165071 (waterfall, canyon, rock wall, evergreen ); pb133254 (blue sky, clouds, contrails, lovely, cum)
  - image vec + caption vec: pb131685 (waterfall, peace, relax, meditation, nat); pb170202 (waterfall, forest, nature); pb183638 (waterfall, water, leaves, trees, jungle,); pb170060 (waterfall, rocks, river, cascade, forest); pb356398 (waterfall, river, view, nature, that, fl); pb190325 (creek, waterfall, nature, landscape); pb182177 (waterfall, sunset, sunrise, sun, nature,); pb40744 (waterfall, small, bach, canyon, water, n)
