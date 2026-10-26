# Publishing an offline pack

Packs are NOT stored in the repo. They live as assets on one rolling GitHub Release tagged `packs`, and the app downloads them on demand.

## One-time setup
1. Install the GitHub CLI (`winget install GitHub.cli`) and run `gh auth login`. (You can do everything in the web UI instead; steps are noted.)
2. Create the release once, as NOT the latest release, so it never shows up as the app's version:
   `gh release create packs --repo chris-g37/curious-dictionary-desktop --title "Offline packs" --notes "Offline dictionary data packs. Derived from Wiktionary via kaikki.org, CC BY-SA 4.0 / GFDL." --latest=false`
   Web UI: Releases > Draft a new release > tag `packs` > untick "Set as the latest release" > Publish.

## Every time you publish or update a pack
1. Build: `node tools/build-pack.js --profile core` (and `--profile full` if you want both). Needs data/kaikki-english.jsonl.
2. Prepare: `npm run pack:release`. This creates dist-pack/release/ with the .gz files, manifest.json and NOTICE.txt.
3. Check the numbers it printed (sizes). Keep every single file well under GitHub's per-asset limit (about 2 GB; verify in GitHub's docs).
4. Upload (overwrites older versions of the same files):
   `gh release upload packs dist-pack/release/* --repo chris-g37/curious-dictionary-desktop --clobber`
   Web UI: open the `packs` release > Edit > drag the files in > Update release.
5. Verify in a browser: open https://github.com/chris-g37/curious-dictionary-desktop/releases/download/packs/manifest.json and check the version and urls.
6. Verify the download: download one .gz by hand and run
   `Get-FileHash -Algorithm SHA256 .\curious-en-core.db.gz`
   and compare with `sha256_gz` in the manifest.
7. Test in the app with `npm start` (never the packaged exe in an automated way): Settings > Offline pack > Download, then look up a word with the network off.

## Rules
- Upload NOTICE.txt every time; it carries the required attribution. The pack data stays CC BY-SA 4.0 / GFDL (share-alike).
- Never upload anything derived from Merriam-Webster.
- Bump `version` in the manifest whenever the pack content changes; the app only offers an update when the version is newer.
- Keep old packs only if you need them: the manifest points at the current ones.
