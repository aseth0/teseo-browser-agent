import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'wxt';
import { firefoxManifest } from './src/core/firefox-manifest';
import { isReleaseBuild, repoUrlOf } from './src/core/repo-url';

// Provider preloaded from the environment of the shell that runs the build.
// The key ends up embedded in dist/ (git-ignored): for personal builds only. Only in the worker
// (__ENV_API_KEY__, read by background/env-key alone), never in the pages' chunks; the provider's URL
// and model (__ENV_PROVIDER__) go everywhere. No web page can read either: the chunks are not
// web-accessible (web_accessible_resources below).
const envApiKey = () => process.env.EXTERNAL_MODEL_API_KEY || null;

// The Chrome Web Store's build (`pnpm zip:store`): no `key` (the store refuses one and gives the
// extension its own id), no debugger permission (the DevTools engine is left out: core/build), and
// never a key from the environment.
const STORE = process.env.STORE === '1';
if (STORE && envApiKey()) throw new Error('STORE=1: build without EXTERNAL_MODEL_API_KEY in the environment.');

// The project's repository, where every link out of the extension points (core/links): package.json's,
// or TESEO_REPO_URL's for a fork. A release's build (release.yml, from its tag vX.Y.Z, in that same
// repository) links the docs at that tag; any other build, at the default branch.
const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { version: string; repository?: { url?: string }; homepage?: string };
const REPO_URL = repoUrlOf(pkg, process.env);
const RELEASE_BUILD = isReleaseBuild(pkg.version, REPO_URL, process.env);

function envProvider() {
  if (!envApiKey()) return null;
  return {
    baseURL: process.env.EXTERNAL_MODEL_BASE_URL ?? '',
    defaultModel: process.env.EXTERNAL_MODEL_NAME ?? '',
  };
}

// The branch and commit a build comes from, as `feat/x @ 1a2b3c4` (`+` once it has changes not yet
// committed), shown beside its version in chrome://extensions and on the icon's tooltip, to tell
// which one is loaded. Not on a release's: built from its tag, out of any branch. Neither changes the
// extension's id (the manifest's `key` below), so the settings stay.
function buildSource(): string | undefined {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    if (branch === 'HEAD') return undefined;
    return `${branch} @ ${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain', '--untracked-files=no') ? '+' : ''}`;
  } catch {
    return undefined; // not a git checkout
  }
}

// The sources zip that `wxt zip -b firefox` makes beside the add-on (`pnpm zip:firefox`), for
// addons.mozilla.org's review of bundled code: only the files git tracks (never an ignored or untracked
// one: no dist/, node_modules/, local notes or anything holding a key), less the tests. The dotfiles
// among them too (.nvmrc, .npmrc: the build's Node and pnpm settings). Outside a git checkout (built from
// that zip itself), WXT's default: every file but dotfiles, node_modules/ and dist/.
function trackedSources(): string[] | undefined {
  try {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
    // As glob patterns: a character that means something there, escaped.
    return files.filter((f) => !f.startsWith('tests/')).map((f) => f.replace(/[()[\]{}*?!+@]/g, '\\$&'));
  } catch {
    return undefined; // not a git checkout
  }
}
const TRACKED_SOURCES = trackedSources();

export default defineConfig({
  srcDir: 'src',
  // Visible folder: the macOS "Load unpacked" picker hides .output/
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // pdf.js's data, from the package (its version pinned), to read attached PDFs: the cmaps of CJK
    // fonts, the standard fonts, the wasm image decoders and the color profiles.
    'build:publicAssets': (_wxt, files) => {
      for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        const from = path.resolve('node_modules/pdfjs-dist', dir);
        // Not quickjs-eval: it runs a PDF's own scripts, which only pdf.js's viewer does.
        for (const name of fs.readdirSync(from).filter((n) => !n.startsWith('quickjs-eval'))) files.push({ absoluteSrc: path.join(from, name), relativeDest: `pdfjs/${dir}/${name}` });
      }
      // The script engine of custom tools (script/quickjs), read by its path.
      files.push({ absoluteSrc: path.resolve('node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm'), relativeDest: 'quickjs/emscripten-module.wasm' });
    },
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.browser === 'firefox') return firefoxManifest(manifest);
      const source = buildSource();
      if (!source || STORE) return;
      manifest.version_name = `${manifest.version} (${source})`;
      if (manifest.action) manifest.action.default_title = `Teseo · ${source}`;
    },
  },
  // `pnpm dev` never opens a browser: load dist/chrome-mv3-dev in yours once, and it updates live.
  webExt: { disabled: true },
  zip: {
    // The store's zip beside the release's, not over it.
    ...(STORE && { artifactTemplate: '{{name}}-{{version}}-{{browser}}-store.zip' }),
    // Firefox's sources (trackedSources above): teseo-browser-agent-X.Y.Z-firefox-sources.zip.
    sourcesTemplate: '{{name}}-{{packageVersion}}-firefox-sources.zip',
    ...(TRACKED_SOURCES && { includeSources: TRACKED_SOURCES, dotSources: true }),
  },
  // __FIREFOX__: Firefox's build, for what no API tells apart (core/build).
  vite: (env) => ({
    define: { __FIREFOX__: JSON.stringify(env.browser === 'firefox'), __ENV_PROVIDER__: JSON.stringify(envProvider()), __ENV_API_KEY__: JSON.stringify(envApiKey()), __STORE__: JSON.stringify(STORE), __REPO_URL__: JSON.stringify(REPO_URL), __RELEASE_BUILD__: JSON.stringify(RELEASE_BUILD) },
    // No <link rel="modulepreload">: extension files are local, and Chrome discards those
    // preloads with a "cross-world extension resource mismatch" warning.
    build: { modulePreload: false },
    resolve: {
      alias: [
        // The MCP SDK's Ajv validator cannot run in an extension (CSP): a stand-in that leaves Ajv out.
        { find: /^\.\.\/validation\/ajv-provider\.js$/, replacement: path.resolve('src/mcp/no-ajv.ts') },
        // The Markdown parser's entity decoder, in its browser build, makes a DOM element when it
        // loads: the background's service worker (it parses the page widget's Markdown) has no DOM,
        // so the build without one, its "worker" export.
        { find: /^decode-named-character-reference$/, replacement: path.resolve('node_modules/decode-named-character-reference/index.js') },
      ],
    },
  }),
  manifest: {
    name: 'Teseo - Browser Agent',
    short_name: 'Teseo',
    description: 'An AI assistant beside every page: it reads the page and acts on it with your permission. Bring your own model.',
    // Public key that pins the extension id (mbbkilkeecefpcgigpgbnghhajpjfdcn) wherever it is loaded
    // unpacked, instead of one derived from the folder's path: its settings, sign-ins and history
    // survive a move to another folder, and the OAuth redirect URL is the same on every machine.
    // The private key is not needed to load it unpacked and stays out of the repository.
    // Not in the store's build (STORE above).
    ...(STORE ? {} : { key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn46UbfcUg82ow+cHnmUZhOuVAD8akR0yfqqWrYmjsl8gtCSrvxHDIqb0VQZX329boEdec9VwVXJSTntfTRiz1ElFau2B3P+MIGyNZQTj/33dG4z44eP3YPtB+YTayJ4eCxkJAMGl4LiJi06FLHz6Df5C/iHSLMcYKlFOa+2C7f0N/2DmElU5HeyYrKbDM7206C3Xfa8wEWQZ0TBLkOk0D6qnp+2eP29mS4t7UqmWCxs2RkQf0R6jT/ZAUtPV860hbcS8IH0ufdM9YEMRQLhgXKwLAiPdH1f9ZX3p8LKqhYdDpHV1JpvH50CZovIo/CstRJTWZKeoUNkk6hpx9ABcRQIDAQAB' }),
    // unlimitedStorage: saved conversations carry the page content of every message.
    // identity: signing in to MCP servers with OAuth (launchWebAuthFlow). declarativeNetRequest…:
    // the requests to MCP servers without an Origin header (mcp/origin), only on sites with access.
    // cookies: an HTTP custom tool's header from a cookie of its site ({{cookie:NAME}}, a CSRF token).
    // webRequest: browser.site_access sees the names of the headers a site's own requests send.
    // offscreen: the document that records a tab's audio and plays what is read aloud (a service worker cannot); tabCapture: that audio, from the popup's Audio line (background/audio-host).
    // alarms: a tab watch ends at its time while the service worker sleeps; notifications: it tells
    // you it ended (background/watches). debugger: the devtools.* tools' real input and screenshots
    // (devtools/cdp, the only module that uses it), only while Settings → Chromium DevTools is on;
    // required, since the browser does not allow it as an optional permission. favicon: the icons of
    // the tabs in the page bar's tab picker (tab-picker faviconOf).
    permissions: ['storage', 'unlimitedStorage', 'sidePanel', 'tabs', 'scripting', 'activeTab', 'search', 'tabGroups', 'identity', 'declarativeNetRequestWithHostAccess', 'cookies', 'webRequest', 'offscreen', 'alarms', 'notifications', 'tts', 'debugger', 'favicon', 'tabCapture'],
    // Images in the extension's pages only from it or in memory (an attached image, a screenshot): a
    // URL in the model's text is never fetched (ui/Markdown), and markup it might slip into an SVG
    // (the turn diagram's) could neither post a form nor move the page's base URL.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; frame-src 'self'; img-src 'self' data: blob:; form-action 'none'; base-uri 'none'",
    },
    // Known cloud provider endpoints; any other baseURL is requested at runtime (Test connection, or
    // the chat's access card). Local servers too: a standing localhost grant (which Chrome matches on
    // every port) would let the model reach any local service without asking.
    host_permissions: ['https://api.openai.com/*', 'https://api.groq.com/*', 'https://openrouter.ai/*'],
    optional_host_permissions: ['<all_urls>'],
    optional_permissions: ['bookmarks'], // Settings → Bookmarks
    // The chat floating on a page (the page widget's "Open the chat here") is its own page, floating.html,
    // in an iframe there: the only file a web page can load, under the extension's fixed URL. Any page can
    // frame or open it, and so tell the extension is installed; but it shows nothing outside a page's
    // frame, nor there without a one-time ticket the widget asked the background for, for its own tab
    // (background/frame-tickets, sidepanel/ticket-gate). Every other page (sidepanel.html among them) and
    // file stays out of reach: a page that opens or frames one gets the browser's "blocked" page.
    // Not use_dynamic_url (a URL that changes each session): a Chromium-based browser (Vivaldi) refuses
    // to load the frame under it.
    // Nothing else listed: the frame's own scripts, styles and pdf.js's worker and data (pdfjs/) load
    // from its own origin, which the browser does not check against this list.
    // None in Firefox's build (core/firefox-manifest): no chat floating on a page there (core/build), nor its page.
    web_accessible_resources: [{ resources: ['floating.html'], matches: ['<all_urls>'], use_dynamic_url: false }],
    // Its popup (entrypoints/popup) says where the chat opens and takes screenshots into it; ⌥⇧A opens the
    // side panel (commands).
    action: { default_title: 'Teseo' },
    commands: {
      // Not _execute_action: the toolbar button opens a popup (entrypoints/popup); this opens the side panel.
      'open-side-panel': { suggested_key: { default: 'Alt+Shift+A' }, description: 'Open Teseo' },
      'toggle-page-widget': { suggested_key: { default: 'Alt+Shift+W' }, description: 'Show or hide the page widget on this site' },
      'float-chat': { suggested_key: { default: 'Alt+Shift+F' }, description: 'Open or fold the chat floating on this page' },
      // Screenshots into the chat (background/capture-host). The browser takes four suggested keys at most:
      // the other two have none until the user sets them (Settings → Shortcuts).
      'capture-section': { description: 'Screenshot a section of the page into the chat' },
      'capture-visible': { suggested_key: { default: 'Alt+Shift+S' }, description: 'Screenshot the visible part of the page into the chat' },
      'capture-full-page': { description: 'Screenshot the whole page into the chat' },
      // The recording of the page's requests (background/recording-host): no key until the user sets one.
      'record-toggle': { description: "Start or stop recording the page's requests" },
      // A tab's audio (background/audio-host): no key until the user sets one.
      'audio-toggle': { description: "Start or stop capturing the tab's audio (to where the popup's Audio line says)" },
      // Speak (background/speech-host): no key until the user sets one.
      'speak-toggle': { description: 'Read the selected text aloud, or stop reading' },
    },
  },
});
