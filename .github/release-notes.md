<!--
The body of each GitHub release (its title is "Teseo X.Y.Z"), filled by scripts/release-notes.mjs:
  {{version}} 0.72.0 · {{tag}} v0.72.0 · {{repo}} the repository's https URL (package.json, or TESEO_REPO_URL)
  {{zip}} / {{storeZip}} the downloadable and the Chrome Web Store zip's names
  {{changes}} the version's section of CHANGELOG.md · {{checksums}} the zips' SHA-256
This comment is left out of the release. Keep each paragraph on one line: the release shows line breaks. Preview: node scripts/release-notes.mjs 0.72.0
-->
## Download

| Version | For | Leaves out | Download | How to install |
|---|---|---|---|---|
| **Downloadable** | Chrome, Vivaldi, Edge, Brave and other Chromium browsers with side panels. Every feature, loaded unpacked. Its extension id is fixed: the same from any folder, so an update keeps your settings. | Nothing, but it does not update itself: download the next release, or use the `dist` branch. | [{{zip}}]({{repo}}/releases/download/{{tag}}/{{zip}}) | [Install steps]({{repo}}/blob/{{tag}}/docs/guide/getting-started.md#the-downloadable-version) |
| **Chrome Web Store** | The same build submitted to the Chrome Web Store. | The [Chromium DevTools engine]({{repo}}/blob/{{tag}}/docs/guide/devtools-engine.md). It has its own extension id, so its settings are separate from the downloadable version's; loaded unpacked from this zip, that id depends on the folder it is in. | [{{storeZip}}]({{repo}}/releases/download/{{tag}}/{{storeZip}}) | [Install steps]({{repo}}/blob/{{tag}}/docs/guide/getting-started.md#the-chrome-web-store-version) |
| **Source** | Development: clone at the tag `{{tag}}`, then `pnpm install` and `pnpm build`. | Nothing: you build it. | [Source code (zip)]({{repo}}/archive/refs/tags/{{tag}}.zip) | [Building from source]({{repo}}/blob/{{tag}}/CONTRIBUTING.md#building-from-source) |

The `dist` branch holds the downloadable version unzipped, ready to load: clone it once (`git clone --branch dist --single-branch {{repo}}.git teseo-browser-agent-dist`) and update it with `git pull`.

Firefox is not supported.

## What's new

{{changes}}

## SHA-256

{{checksums}}
