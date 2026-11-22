// Which build this is, and what it and the browser it runs in can do: the features a build may lack,
// each with why (the browser has no API for it, or the Chrome Web Store's or Firefox's build leaves it out), what it
// does and the page of the docs about it. The UI tells the user the same way wherever one is missing
// (ui/FeatureNotice): a section's page, a greyed row with its mark, and Settings → About's summary.
// This is what each build can do; nothing here turns a feature on or off by itself.
import { browser } from 'wxt/browser';
import type { DocsPage } from './links';

export const STORE_BUILD = typeof __STORE__ !== 'undefined' && __STORE__;
// Firefox's build (`wxt build -b firefox`: wxt.config.ts sets __FIREFOX__, as it gives that build its own
// manifest). For what no API's presence tells apart (floatingChat below).
export const firefoxBuild = (): boolean => typeof __FIREFOX__ !== 'undefined' && __FIREFOX__;

export type FeatureId = 'devtools' | 'speak' | 'systemVoice' | 'tabAudio' | 'floatingChat' | 'customToolSources';
export type MissingReason = 'browser' | 'store' | 'firefox';

export interface Feature {
  id: FeatureId;
  name: string;
  about: string; // what it does, in one line
  docs: DocsPage;
  available: boolean;
  reason?: MissingReason; // when not available
}

// What the Chrome Web Store's build (`pnpm zip:store`, wxt.config.ts) leaves out, by choice: the sources
// of custom tools (tools/custom/sources: tools, their scripts too, kept in sync with a file at a URL, which
// the store's rule against remotely hosted code may count as such). A one-time import from a URL, which the
// user starts and reviews, stays. The DevTools engine is in it: its manifest asks for the debugger permission.
export const STORE_LEAVES_OUT: readonly FeatureId[] = ['customToolSources'];

// What Firefox's build leaves out by choice, besides what Firefox has no API for: the sources of custom
// tools, for Mozilla's add-on policies (an add-on is self-contained and loads no remote code to run; a
// source keeps tools, their scripts too, in sync with a file at a URL). The one-time import from a URL stays.
export const FIREFOX_LEAVES_OUT: readonly FeatureId[] = ['customToolSources'];

type Api = Record<string, unknown> | undefined;
const api = (): Api => browser;

// `needs`: whether the browser can, from its API (`b`) or, where no API tells, from the build (`firefox`).
const DEFS: Record<FeatureId, { name: string; about: string; docs: DocsPage; needs: (b: Api, firefox: boolean) => boolean }> = {
  // devtools/cdp: the debugger API (Firefox has none).
  devtools: {
    name: 'Chromium DevTools engine',
    about: 'Real clicks, keys and typing, hover, drag and screenshots of any tab.',
    docs: 'docs/guide/devtools-engine.md',
    needs: (b) => !!b?.debugger,
  },
  // background/speech-host plays in the offscreen document: Firefox has none.
  speak: {
    name: 'Speak',
    about: "Reads answers and pages aloud with a provider's voice.",
    docs: 'docs/guide/speak.md',
    needs: (b) => !!b?.offscreen,
  },
  // speech/system-voice: chrome.tts, besides Speak's offscreen document.
  systemVoice: {
    name: 'System voice',
    about: "Reads aloud with your system's voice, without a provider.",
    docs: 'docs/guide/speak.md#reading',
    needs: (b) => !!b?.tts && !!b?.offscreen,
  },
  // The popup's Audio line, background/audio-host: tabCapture and an offscreen document.
  tabAudio: {
    name: "A tab's audio",
    about: "Captures and transcribes a tab's audio from the toolbar button.",
    docs: 'docs/guide/tab-audio.md',
    needs: (b) => !!b?.tabCapture && !!b?.offscreen,
  },
  // widget/ui/floating-chat: the floating chat's page (floating.html) in an iframe of the web page. Firefox
  // gives an extension page framed by a web page only a content script's APIs (runtime, storage: no tabs,
  // windows…), which the chat calls everywhere. Not an API check: the extension's own pages, where this is
  // asked, have every API in both browsers; only the frame lacks them, and the page cannot ask from there.
  // So the build says it, as its manifest does (wxt.config.ts).
  floatingChat: {
    name: 'Floating chat',
    about: 'The chat floating on the page, from its bubble, the popup or a shortcut.',
    docs: 'docs/guide/chat-windows.md#floating-on-the-page',
    needs: (_b, firefox) => !firefox,
  },
  // tools/custom/sources: a fetch, nothing a browser lacks; the store's and Firefox's builds leave it out.
  customToolSources: {
    name: 'Custom tool sources',
    about: 'Keeps custom tools in sync with a file at a URL.',
    docs: 'docs/guide/custom-tools.md#sources-tools-shared-by-a-team',
    needs: () => true,
  },
};

export const FEATURE_IDS = Object.keys(DEFS) as FeatureId[];

// A feature in a build: `store` whether it is the store's, `leavesOut` what that one leaves out, `browser`
// the browser's API, `firefox` whether it is Firefox's build (`firefoxLeavesOut` what that one leaves out by
// choice: FIREFOX_LEAVES_OUT). A build's choice is the reason first.
export function featureIn(id: FeatureId, build: { store: boolean; leavesOut: readonly FeatureId[]; browser: Api; firefox?: boolean; firefoxLeavesOut?: readonly FeatureId[] }): Feature {
  const { needs, ...def } = DEFS[id];
  const reason: MissingReason | undefined = build.store && build.leavesOut.includes(id)
    ? 'store'
    : build.firefox && (build.firefoxLeavesOut ?? FIREFOX_LEAVES_OUT).includes(id)
      ? 'firefox'
      : !needs(build.browser, !!build.firefox) ? 'browser' : undefined;
  return { id, ...def, available: !reason, ...(reason && { reason }) };
}

// The feature in this build and browser.
export const feature = (id: FeatureId): Feature => featureIn(id, { store: STORE_BUILD, leavesOut: STORE_LEAVES_OUT, browser: api(), firefox: firefoxBuild(), firefoxLeavesOut: FIREFOX_LEAVES_OUT });
export const features = (): Feature[] => FEATURE_IDS.map(feature);
export const missingFeatures = (): Feature[] => features().filter((f) => !f.available);

// The readers callers had before the registry, unchanged in what they answer.
export const tabAudioAvailable = (): boolean => feature('tabAudio').available;
export const speakAvailable = (): boolean => feature('speak').available;
// The debugger API itself: Firefox has none.
export const debuggerAvailable = (): boolean => DEFS.devtools.needs(api(), firefoxBuild());
export const customToolSourcesAvailable = (): boolean => feature('customToolSources').available;
// Whether the chat can float on a page; where not, the page opens it full screen in a tab (background/widget-host).
export const floatingChatAvailable = (): boolean => feature('floatingChat').available;
