# Notices

The source code in this repository is licensed under the [GNU AGPL-3.0](LICENSE). The content the app shows is not:
it comes from the sources below, each under its own terms. Most of it is not stored in this repository; the app or
the [pipeline](pipeline/README.md) fetches it. If you run your own copy, check each source's terms for your use.

## Quran text, translations and tafsir

- Arabic text and translations: [AlQuran Cloud API](https://alquran.cloud) (Tanzil Uthmani text and the translations
  it carries, each under its translator's or publisher's terms).
- Tafsir and reflections: [Quran Foundation API](https://quran.foundation) (QuranReflect; the QuranReflect mark in
  `apps/web/public/quranreflect-mark.svg` belongs to Quran Foundation), and editions from
  [spa5k/tafsir_api](https://github.com/spa5k/tafsir_api).
- Malayalam tafsirs (Thafheem, Amani): see `pipeline/ml_thafheem.py` and `pipeline/ml_amani.py` for their sources.
- Tafsir book covers are not included in this repository (they are not freely licensed).
  `apps/web/public/tafsir-covers/manifest.json` lists where each one comes from; the app shows a plain mark without them.

## Recitations and voices

- Per-ayah recitations: [EveryAyah](https://everyayah.com).
- Badr Al-Turki: whole-surah recordings from [mp3quran.net](https://mp3quran.net), cut into ayahs by
  `pipeline/own_reciter.py`.
- Translation voices: [Islamic Network CDN](https://cdn.islamic.network) (listed in `contracts/voices.ts`).
- Malayalam translation and voice: Quran Lalithasaram (Muhammad Karakunnu & Vanidas Elayavoor), used by AyahShare with
  the publisher's permission. That permission does not extend to other deployments: get your own before using it.

## Background videos

Background clips come from [Pixabay](https://pixabay.com) (and optionally [Pexels](https://www.pexels.com)) under their
content licenses. Clip ids are in `apps/web/public/data/bg/`; the video files themselves are not in this repository.

## Fonts

Quran and interface fonts (Amiri Quran, Scheherazade New, Noto Naskh Arabic, Inter, Figtree, Montserrat, Noto Sans and
the translation fonts) are loaded from Google Fonts under the SIL Open Font License.

## Trademarks

"AyahShare" and the AyahShare logo (`apps/web/public/brand`, the app icons in `apps/web/public/icons` and
`apps/mobile`) are trademarks of the project's maintainers. They are not licensed under the AGPL. Forks and other
deployments must use their own name and logo.
