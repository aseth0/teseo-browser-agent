# Contributing

Thank you for your interest in Teseo. This page covers building it, testing it, the project's
conventions and where each part lives. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md);
security problems go privately through [SECURITY.md](SECURITY.md), never in a public issue.

## Building from source

Requirements: Node 22 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm build      # → dist/chrome-mv3
```

Load `dist/chrome-mv3` unpacked (`chrome://extensions` → Developer mode → **Load unpacked**) and click ↻ on its
card after every build. The output goes to `dist/` rather than `.output/` because the macOS folder picker hides
dot folders. The card's version says which branch and commit the build comes from (`0.66.0 (feat/x @ 1a2b3c4)`,
with `+` when it has changes not yet committed), as the icon's tooltip does; a release's, built from its tag, has
neither. The extension's id, and with it its settings, stays the same.

`pnpm dev` builds `dist/chrome-mv3-dev` and rebuilds it as you edit; it does not open a browser, so load that
folder yourself.

**A provider from the environment.** An extension cannot read the shell's environment, so the build injects it:
with `EXTERNAL_MODEL_API_KEY` set (and optionally `EXTERNAL_MODEL_BASE_URL`, `EXTERNAL_MODEL_NAME`), the build
adds a preconfigured *Environment* provider. The key is compiled into the background worker only, never into
files web pages can load; `dist/` is git-ignored, and such a build must not be shared. CI never sets it.

**The project's links.** Every link out of the extension (Settings → About, the notices of what a version leaves
out) comes from `src/core/links.ts`, built on the repository in `package.json` (`repository`, else `homepage`). A
fork sets `TESEO_REPO_URL` for its build instead: a GitHub repository, in any form git takes (it is made https,
and anything else stops the build). Releases link to `/releases/latest`; the docs, to the version's tag in a
release's build (made from its `vX.Y.Z` tag in that same repository: a tag pushed to another copy does not count) and
to the default branch in any other. A test fails when a
link in the docs points to another repository.

**Firefox's build (a trial).** `pnpm zip:firefox` (`wxt zip -b firefox --mv3`) builds `dist/firefox-mv3` with its
own manifest (`src/core/firefox-manifest.ts`) and makes two zips: the add-on,
`dist/teseo-browser-agent-X.Y.Z-firefox.zip` (unsigned: Firefox loads it only as a temporary add-on, from
`about:debugging`), and the sources addons.mozilla.org asks for when code is bundled,
`dist/teseo-browser-agent-X.Y.Z-firefox-sources.zip`. The sources zip holds the files git tracks, the tests left
out, and nothing else: no `dist/`, no `node_modules/`, nothing ignored or untracked. To rebuild the add-on from it,
with the Node major version in `.nvmrc` and the pnpm version in `package.json`'s `packageManager`, and without
`EXTERNAL_MODEL_API_KEY`:

```bash
pnpm install --frozen-lockfile
pnpm zip:firefox    # → dist/firefox-mv3 and dist/teseo-browser-agent-X.Y.Z-firefox.zip
```

That gives the same files as a release's only built as the release was (its links point at its tag: see above), so
for the release of `vX.Y.Z` set what GitHub Actions sets:

```bash
GITHUB_REF_TYPE=tag GITHUB_REF_NAME=vX.Y.Z GITHUB_REPOSITORY=aseth0/teseo-browser-agent pnpm zip:firefox
```

Mozilla's linter, `pnpm dlx web-ext lint --source-dir dist/firefox-mv3`, finds no errors in it; its warnings
(`innerHTML`, `Function`, a dynamic `import()`) are all in bundled libraries: Readability, React, pdf.js, micromark,
highlight.js and zod.

## Testing

```bash
pnpm compile    # typecheck
pnpm lint       # eslint: hooks and promises
pnpm security   # Semgrep's security rules and pnpm audit (needs semgrep, uvx or pipx)
pnpm test       # vitest (tests/**/*.test.ts)
```

**End to end.** `pnpm e2e` builds the extension and loads it into Playwright's Chromium against a mock
OpenAI-compatible server (streaming, non-streamed JSON, reasoning, errors), MCP servers and test pages. It runs
headless and never opens a window; `E2E_HEADED=1` shows it. Stable Chrome no longer loads extensions from the
command line, so point `CHROMIUM_PATH` at a Chromium build if Playwright's is not cached:

```bash
CHROMIUM_PATH=/path/to/chromium node tests/e2e/sidepanel.e2e.mjs [scenario,…]
```

Build without `EXTERNAL_MODEL_API_KEY` for it: the e2e refuses such a build. `E2E_LIVE=1 … web-live` searches the
web for real. The maintainers run it before each release.

**Firefox.** `pnpm e2e:firefox` builds Firefox's version and runs a smoke test of it in a headless Firefox, against
the same mock server: it installs, the chat answers (in a tab and in the sidebar) and reads a page, a script tool
runs, Settings and the popup render, and what Firefox's version lacks or leaves out says so; any error the extension logs
fails it (it lets a page go quiet before closing it, so Firefox's notes about a closed page's pending work do not). It uses
Playwright's Firefox build, downloaded once, and a new profile each run (never your Firefox's):

```bash
pnpm exec playwright-core install firefox
pnpm e2e:firefox    # or: node tests/e2e/firefox-smoke.mjs [check,…] [--port N]
```

`FIREFOX_PATH` points it at another Firefox (Nightly or Developer Edition); `E2E_DEBUG=1` also prints the errors it
expects and Firefox's own output on a failure. Build without `EXTERNAL_MODEL_API_KEY` here too. It does not cover
permission prompts, keyboard shortcuts, OAuth sign-ins for MCP servers or real input in the sidebar: those still
need a person in Firefox.

**Documentation screenshots.** The pictures in `docs/images/` are made from the build with a scripted model, a demo
store and a few demo sites, all served locally under `example.com` names. It runs headless; build without
`EXTERNAL_MODEL_API_KEY` (the script refuses to run with it set):

```bash
pnpm build && CHROMIUM_PATH=/path/to/chromium node scripts/docs-screenshots/index.mjs
```

## Conventions

- **English only**: code, comments, UI strings, tests, fixtures and docs.
- **OpenAI-compatible providers only** (`/chat/completions`). A server's quirks go in a provider's extra headers or
  body, never in a new provider kind. The model's reasoning stays visible in the chat.
- **Texts sent to the model** live in `TEXT_DEFS` (`src/core/texts/defs-*.ts`) so that Settings → Prompt preview
  shows them and lets users edit them. Propose a new or changed text (its wording and where it goes) in the pull
  request description. Concrete error messages are exempt.
- **Nothing personal, nothing from a company**: no real hosts, names, paths, accounts, tokens, screenshots or logs
  in code, tests, docs or commits. Examples use `example.com` or `.test` hosts.
- **Dependencies pinned** to exact versions.
- The side panel never shows native `confirm()` / `alert()`: it confirms inside its own UI.

## Workflow

1. Work on a branch; `master` and the version tags are the maintainers'.
2. Keep each change focused, with tests for what it changes, and `pnpm compile && pnpm lint && pnpm test` green.
3. Check the change in a browser before asking for a review: `pnpm build`, then load `dist/chrome-mv3` unpacked
   (or click ↻ on its card in `chrome://extensions`).
4. Add a line to `CHANGELOG.md` under the next version (*Changed*, *Fixed*, …).

**Releases.** To make one:

1. Set `version` in `package.json` to `X.Y.Z` and rename `CHANGELOG.md`'s *Unreleased* section to `## X.Y.Z`.
   That section becomes the release's *What's new*: a release without it fails.
2. Preview the release page: `node scripts/release-notes.mjs X.Y.Z` prints it (`.github/release-notes.md` filled
   with the version, the changelog section, the zips' names and links built from the repository in `package.json`,
   or `TESEO_REPO_URL`).
3. Push the commit, then the tag `vX.Y.Z`.

The tag runs `release.yml`, one job after another:

| Job | Does |
|---|---|
| `version` | Stops at once unless the tag is `v` + `package.json`'s version |
| `checks` | Typecheck, lint, tests and security checks (`checks.yml`; the development repository runs it on every push too) |
| `build` · `build-store` · `build-firefox` | In parallel, each in its own runner: `pnpm zip` (the downloadable zip, everything), `pnpm zip:store` (the Chrome Web Store's: no manifest `key`, no sources of custom tools) and `pnpm zip:firefox` (Firefox's trial build, unsigned, and its sources zip for addons.mozilla.org: [Firefox's build](#building-from-source)) |
| `publish` | Creates the GitHub release `Teseo X.Y.Z` with the notes (the page above, plus the four zips' SHA-256) and attaches the four zips |
| `dist-branch` | Puts the downloadable build, unzipped, on the `dist` branch, one commit per version |

Re-running it on the same tag replaces the release's notes and zips and adds no commit to `dist` when the build is the
same. The store's zip is uploaded to the Chrome Web Store by hand; nothing is sent to addons.mozilla.org.

## Where to extend

| I want to add… | Touch |
|---|---|
| an LLM provider / server quirk | `src/providers/openai-compat.ts` + `createProvider` in `src/providers/registry.ts` |
| a new reasoning format | `src/providers/reasoning.ts` |
| a tool | implement `Tool` (`src/core/types.ts`) and `tools.register()` in `src/background/tool-catalog.ts`; write tools need `effect: 'write'` and a `describe()` for the confirmation |
| a page action | `PageAction` in `src/page/protocol.ts`, DOM code in `src/content/actions.ts` |
| how actions are authorized | `src/policy/engine.ts` (per-site policies, per agent, in `src/policy/store.ts`) |
| an agent with its own site policies | an entry in `AGENTS` (`src/agents/registry.ts`): its column in Settings → Website access |
| context accounting | `src/context/usage.ts` (per-call breakdown), `ContextMeter.tsx` |
| which tools the model is offered | `disabledTools` in settings; the catalog comes from the background (`LIST_TOOLS`), shown by `src/ui/Tools.tsx` |
| a panel↔background message | `src/core/protocol.ts` |
| a skill shipped with the extension | `skills/<name>/SKILL.md` (bundled at build time) |
| how skills reach the model | `src/skills/prompt.ts` (system prompt catalog, `<site_skill>` blocks) |
| a settings section | `SETTINGS_SECTIONS` in `src/ui/Settings.tsx` (shared UI lives in `src/ui/`) |
| a page operation | `src/page/protocol.ts` + `handle()` in `src/entrypoints/page-agent.ts` |
| a content extractor | `src/content/*.ts` (pure DOM, testable with jsdom); the visible elements in `src/content/a11y.ts` |
| what context travels with each message | `src/context/pipeline.ts` (budget in `budget.ts`) |
| saved conversations / how they are searched | `src/history/store.ts`, ranking in `src/history/rank.ts` (BM25: `src/search/bm25.ts`), auto-attach in `src/history/auto.ts` |
| compaction | `src/context/compaction.ts` (what is sent), when in `src/entrypoints/sidepanel/useCompaction.ts`, the summary in `src/background/summarize.ts`, Settings in `src/ui/CompactionSettings.tsx`; the model's window in `src/context/window.ts` |
| memory | `src/memory/` (store, what the model gets in `prompt.ts`, tools, JSON), Settings → Memory in `src/ui/Memory.tsx`, the side panel's list in `src/entrypoints/sidepanel/MemoryPanel.tsx` |
| the DevTools engine | `src/tools/browser/engine-tools.ts` and `engine.ts`, `keys.ts`; `src/devtools/cdp.ts` (every `chrome.debugger` call: the allowlist, per call, per tab); the page side in `src/content/locate.ts` and `src/content/mask.ts`; Settings in `src/ui/DevtoolsSettings.tsx` |
| recordings | the recorder in `src/recording/recorder.ts` (hosted by `src/background/recording-host.ts`: popup, shortcut, pill), its engines `devtools.ts` and `webrequest.ts` (bodies read, unpacked or marked binary by `bodies.ts`), presets in `presets.ts` applied by `filter.ts` (Settings in `src/ui/RecordingSettings.tsx`), the review's search in `search.ts`, `sensitive.ts`, `review.ts`, `pending-secrets.ts`, the page's steps in `src/content/steps.ts`; the review in `src/entrypoints/sidepanel/RecordingReview.tsx`; `{{secret:name}}` in `src/tools/secrets.ts` and `src/tools/custom/secrets.ts` |
| web search and reading | `src/web/tools.ts`; a search engine's results: a site template in `templates/*-search/`; background tabs in `src/page/background-tab.ts` |
| custom tools | `src/tools/custom/runtime.ts` (what one is in `types.ts`, checked in `validate.ts`), `src/tools/http.ts` (HTTP requests, `extractPath`), `src/tools/custom/manage.ts` (`custom_tools.*`; arguments in `schema.ts`, drafted in `draft.ts`), editor in `src/ui/custom-tools/`; scripts in `src/script/` (run in QuickJS, `src/script/quickjs.ts`) |
| agents | `src/agents/profiles.ts`, built-ins in `src/agents/builtins.ts`, Builder in `src/agents/builder.ts`, the run in `src/background/agent-run.ts` (`run-setup.ts`, `sub-agent.ts`), Settings in `src/ui/agents/`, the picker in `src/entrypoints/sidepanel/AgentPicker.tsx` |
| the page widget | `src/widget/` (actions, run, steps, `actions.save` in `tools.ts`), the bubble in `src/entrypoints/page-widget.ts` and `src/widget/ui/`, its look in `src/widget/bubble-look.ts`, Settings in `src/ui/bubble/` and `src/ui/widget-actions/` |
| the agent manager | `src/entrypoints/manager/`, its rows in `src/manager/`; each agent is the chat app in `MANAGER` mode (`src/entrypoints/sidepanel/manager-chat.tsx`) |
| a screenshot from the popup or a shortcut | `src/capture/` (what it captures in `run.ts`, which chat gets it in `plan.ts`), started by `src/background/capture-host.ts`, taken by the chat in `src/entrypoints/sidepanel/useHandoff.ts` (one hook for screenshots, recordings and the bubble's conversations, `src/core/handoff.ts`); the shortcuts in `wxt.config.ts` (`commands`), listed by Settings → Shortcuts (`src/ui/ShortcutsSettings.tsx`) |
| a key set in Settings → Shortcuts | `src/shortcuts/` (checked in `keys.ts`, heard by `listen.ts` in pages through `src/entrypoints/page-keys.ts`, registered by `script.ts`), run by `src/background/shortcuts.ts` like the browser's shortcuts |
| the full-screen chat | the chat app in `FULL` mode (`src/ui/floating-frame.ts`, `sidepanel/modes.ts`) |
| voice dictation | `src/voice/`, `src/entrypoints/sidepanel/useDictation.ts` and `Dictation.tsx`, the grant page in `src/entrypoints/mic/`, Settings in `src/ui/VoiceSettings.tsx` |
| MCP | `src/mcp/` (client, OAuth, the Origin rule), Settings in `src/ui/mcp/` |
| a use case or a candidate feature | `docs/use-cases/` (a file per case, the index table in its README) |

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
