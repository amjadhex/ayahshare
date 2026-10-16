# Contributing to AyahShare

Thank you for helping. This is a Quran app, so accuracy comes first: a wrong ayah, a wrong translation or a cut-off
recitation is a serious bug. Please report anything like that, even if you cannot fix it.

## Reporting

- **Bugs:** open an issue with the device and browser (or app version), the verse and design, what you expected and
  what happened. A screenshot or the share link helps.
- **Content errors** (text, translation, recitation timing, tafsir): name the surah:ayah, the edition or reciter, and
  what is wrong.
- **Security issues:** do not open a public issue; see [SECURITY.md](SECURITY.md).

## Making a change

1. Fork, create a branch from `main`.
2. Keep the change focused: one fix or feature per pull request. Match the surrounding code's style and comment density.
3. Run the checks for the app you touched:

   ```sh
   cd apps/web && npm test && npm run build     # tests + strict type check + build
   cd apps/api && npm test && npm run typecheck
   cd apps/admin && npm run build
   ```

4. Add or update tests for behaviour you change. UI changes: include before/after screenshots in the pull request.
5. Open the pull request with what changed and why.

## Ground rules

- The web app's logic stays framework-free: only `apps/web/src/ui/` (and `main.tsx`) use React
  (`src/frameworkFree.test.ts` checks this), so the mobile apps can reuse it.
- Never commit keys or secrets. Local keys live in `.env` / `.dev.vars` (ignored by git); production secrets are set with
  `wrangler secret put`.
- Do not add Quran text, translations, recordings, images or fonts to the repository unless their license allows it;
  say where they come from in [NOTICE.md](NOTICE.md).
- User-visible strings live in `apps/web/src/strings.ts`.

By contributing, you agree that your contribution is licensed under the [GNU AGPL-3.0](LICENSE).
