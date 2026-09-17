# Releasing LazyMapLayers

## Cut a release

1. **Version.** Set the new version in `package.json`, `package-lock.json`, `CSXS/manifest.xml` and
   `src/host/00-namespace.jsx`. The build also writes it into `dist/`.
2. **Checks.** Run `npm run verify`. It includes `npm run check:expressions`, which runs every
   generated expression in an ES3 engine like After Effects' Legacy ExtendScript expression engine.
3. **Release code inside After Effects.** Users get minified code, so run the in-AE tests on it:

   ```
   node tools/build.mjs --dev --minify
   npm run ae:spikes -- --only R1,G2,E1,X1,D1,D1L
   npm run build:dev
   ```

4. **Docs.** Update `docs/CHANGELOG.md`, the README and the status board in `docs/PLAN.md`.
5. **Package.** Run `node tools/package-zxp.mjs`. It builds into a temporary folder, so `dist/` is not
   touched, then signs with a timestamp, verifies, and writes `LazyMapLayers-vX.Y.zip` to
   `D:\GitHub\00. Install from here`. It replaces the older LazyMapLayers zip there and prints the
   SHA-256.
   - The first time on a machine, run `node tools/package-zxp.mjs --cert`, or restore the backed-up
     `Signing key (do not share)` folder. Keep the same key for every release.
   - ZXPSignCmd lives in `tools/vendor/`. Get it with `node tools/get-zxpsigncmd.mjs`.
6. **Test the installer** on the development PC (below).
7. **Publish**, only with Sohan's go-ahead:
   - Commit and push as Raisul Sohan.
   - Create a GitHub release with tag `vX.Y.Z` and title "LazyMapLayers X.Y".
   - Write notes with three sections: Download & install, What's new, and the SHA-256.
   - Attach the zip as the release asset.

## Test a release on the development PC

On the development PC, `%APPDATA%\Adobe\CEP\extensions\com.sohan.LazyMapLayers` is a link to `dist/`,
and Adobe's PlayerDebugMode is on. The scripts in `tools/release-test/` switch the PC to the setup a
user has, then switch it back. Close After Effects before each step.

1. **`1 Install the release for testing.bat`**
   - Saves the current setup (the link and every PlayerDebugMode value) to
     `%LOCALAPPDATA%\LazyMapLayers release test\state.json`.
   - Unzips the newest release zip into `%TEMP%` and opens the folder.
   - Then double-click **Install LazyMapLayers.bat** there, as a user would.
2. **Try the release** in After Effects:
   - [ ] Window > Extensions > LazyMapLayers opens, and the log says "LazyMapLayers X.Y.Z".
   - [ ] The preview map shows the world.
   - [ ] **World flight sample** builds without red lines in the log, and After Effects shows no
     expression errors. Try it once in a project from File > New > New Project too: with a project
     template, that project may use the Legacy ExtendScript expression engine.
   - [ ] **Render** finishes, and the comp plays the globe, the flight to Paris, the route and Tokyo.
   - [ ] **Auto labels** with another language, **Fly here**, and Alt+click all work.
3. **`2 Turn on the signature check.bat`** (optional but recommended)
   - Sets PlayerDebugMode to 0, so After Effects checks signatures as on a user's computer.
   - Start After Effects: the panel must open, not blank.
   - Unsigned panels, such as other development links, do not load during this session.
   - If the panel is blank, do not run "Fix a blank panel". Keep the
     `%TEMP%\CEPHtmlEngine12-*.log` files for diagnosis.
4. **`3 Back to development.bat`**
   - Removes the release install and links `dist/` again.
   - Puts every PlayerDebugMode value back.
   - Deletes the unzipped copy.

`Show test status.bat` shows at any time which setup is active. Downloaded regions in
`%APPDATA%\LazyMapLayers` are never touched by these scripts.
