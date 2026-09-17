# LazyMapLayers — working rules

Free, open-source (MIT) map design and map animation extension for After Effects (CEP panel). Part of
Raisul Sohan's Lazy suite. It replaces GEOlayers 3 for motion designers worldwide, and every
final output should be better. Build for a global audience; no single country is the focus.
Bundle id: `com.sohan.LazyMapLayers`.

## Read at the start of every session

1. This file.
2. `docs/PLAN.md`: pillars, quality bar, architecture, phases, status board.
3. `docs/DECISIONS.md` and `docs/CHANGELOG.md`, if they exist.
4. `git status` and `git log --oneline -15`, if the folder is a git repo.

## Working with Sohan

- Reply in Bengali. Code, comments, docs, commit messages, and file names are in English.
- Do the work yourself. Do not start subagents or workflows.
- Tools and features use the "Lazy" prefix, never "Quick".
- Ask before launching After Effects. Headless runs use `AfterFX.com -r <script>`.
- Ask before downloading data or packages. Name the source and the size.
- Never add Claude or AI co-author lines to commits, PRs, or releases.

## Clean-room rule

- `research/` holds private notes. It is git-ignored. Never commit it or quote it in public files.
- Only ideas may carry over from other products. Write every line of code fresh, and describe other
  tools in public docs only by what their users can see.

## Hard rules

1. **Free forever.** No accounts, keys, trials, or telemetry. A data source must allow free
   commercial use with attribution. Anything else is bring-your-own.
2. **Undo.** Every host action runs inside `app.beginUndoGroup("LazyMapLayers: …")` and ends in
   `finally { app.endUndoGroup(); }`. Never purge undo caches.
3. **Tagging.** Every generated comp or layer carries an `LML:` marker in its comment. Regeneration
   only touches tagged items. The user's own layers are never modified, deleted, or reordered.
4. **Linking.** Link layers with Layer Control effects, not layer names inside expression strings.
5. **Core stays pure.** `src/core/**` is pure TypeScript with no DOM, Node, network, or CEP APIs, and
   it has unit tests. Use erasable TypeScript only (no enums, namespaces, or parameter properties),
   so Node can run the tests directly.
6. **Maths lives in core.** Geographic and camera maths lives in core. The host receives prepared
   numbers and builds AE objects.
7. **No fake features.** An unfinished path throws or returns `{ok:false, error:{code:"NOT_IMPLEMENTED"}}`
   and is listed under known limitations.
8. **Dependencies.** Only packages approved in `docs/PLAN.md` §5. Anything else needs an entry in
   `docs/DECISIONS.md`.

## ExtendScript (host) rules — AE runs ES3

- Sources live in `src/host/*.jsx` and are concatenated in file-name order into
  `dist/host/lazymaplayers.jsx`, all under the global `LML` namespace.
- Forbidden:
  - `let`/`const`, arrow functions, template literals, classes, destructuring, spread, and default
    parameters.
  - Trailing commas.
  - `Array.prototype.map/forEach/filter/indexOf`, `Object.keys`, and `String.prototype.trim`, unless
    they come from our polyfill file.
- Before calling `open()` on a file, set `file.encoding = "UTF-8"`. Never use `alert()` on
  production paths.
- Generated AE expressions (`src/core/ae/`) follow the same ES3 rules, and also avoid
  `Math.fround` and chained conditional operators, because projects on the Legacy ExtendScript
  expression engine run them as ES3 (DECISIONS D14). `npm run check:expressions` enforces it.

## Commands

```
npm test                  # core unit tests (node --test)
npm run verify            # tests, typecheck, dev build, ES3 host check, ES3 expression check
npm run ae:spikes -- --only SH1   # in-AE tests (ask Sohan first); --ui drives the panel (U1)
node tools/serve-panel.mjs        # the panel's interface in a normal browser, without After Effects
```
