// Which build this is, and what it and the browser it runs in can do: the features a build may lack,
// each with why (the browser has no API for it, or the Chrome Web Store's build leaves it out), what it
// does and the page of the docs about it. The UI tells the user the same way wherever one is missing
// (ui/FeatureNotice): a section's page, a greyed row with its mark, and Settings → About's summary.
// This is what each build can do; nothing here turns a feature on or off by itself.
import { browser } from 'wxt/browser';
import type { DocsPage } from './links';

export const STORE_BUILD = typeof __STORE__ !== 'undefined' && __STORE__;

export type FeatureId = 'devtools' | 'speak' | 'systemVoice' | 'tabAudio' | 'customToolSources';
export type MissingReason = 'browser' | 'store';

export interface Feature {
  id: FeatureId;
  name: string;
  about: string; // what it does, in one line
  docs: DocsPage;
  available: boolean;
  reason?: MissingReason; // when not available
}

// What the Chrome Web Store's build (`pnpm zip:store`, wxt.config.ts) leaves out, by choice: the DevTools
// engine (its manifest has no debugger permission). Add 'customToolSources' here to leave out the sources
// of custom tools too (tools synced from a URL: tools/custom/sources); it stays in for now.
export const STORE_LEAVES_OUT: readonly FeatureId[] = ['devtools'];

type Api = Record<string, unknown> | undefined;
const api = (): Api => browser;

const DEFS: Record<FeatureId, { name: string; about: string; docs: DocsPage; needs: (b: Api) => boolean }> = {
  // devtools/cdp: the debugger API (Firefox has none; the store's build no permission).
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
  // tools/custom/sources: a fetch, nothing a browser lacks; only the store's build may leave it out.
  customToolSources: {
    name: 'Custom tool sources',
    about: 'Keeps custom tools in sync with a file at a URL.',
    docs: 'docs/guide/custom-tools.md#sources-tools-shared-by-a-team',
    needs: () => true,
  },
};

export const FEATURE_IDS = Object.keys(DEFS) as FeatureId[];

// A feature in a build: `store` whether it is the store's, `leavesOut` what that one leaves out, `browser`
// the browser's API. The store's choice is the reason first: its manifest has no permission for it either.
export function featureIn(id: FeatureId, build: { store: boolean; leavesOut: readonly FeatureId[]; browser: Api }): Feature {
  const { needs, ...def } = DEFS[id];
  const reason: MissingReason | undefined = build.store && build.leavesOut.includes(id) ? 'store' : !needs(build.browser) ? 'browser' : undefined;
  return { id, ...def, available: !reason, ...(reason && { reason }) };
}

// The feature in this build and browser.
export const feature = (id: FeatureId): Feature => featureIn(id, { store: STORE_BUILD, leavesOut: STORE_LEAVES_OUT, browser: api() });
export const features = (): Feature[] => FEATURE_IDS.map(feature);
export const missingFeatures = (): Feature[] => features().filter((f) => !f.available);

// The readers callers had before the registry, unchanged in what they answer.
export const tabAudioAvailable = (): boolean => feature('tabAudio').available;
export const speakAvailable = (): boolean => feature('speak').available;
// The debugger API itself (not the store's choice): settings-select devtoolsOn checks STORE_BUILD apart.
export const debuggerAvailable = (): boolean => DEFS.devtools.needs(api());
export const customToolSourcesAvailable = (): boolean => feature('customToolSources').available;
