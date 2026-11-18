// Firefox's manifest (`wxt build -b firefox --mv3`, a trial so far), made by wxt.config.ts from the one every
// build shares: an add-on id, the data it sends where (Firefox asks the user at install), private windows left
// out, and without the Chromium-only permissions and fields. No browser API here: it runs in Node, at build time.

// What Firefox has no API for (core/build).
export const FIREFOX_MISSING = ['sidePanel', 'offscreen', 'debugger', 'favicon', 'tabCapture', 'tts'];

// The data it sends out of the browser, in Mozilla's categories (Firefox's data collection consent), all needed
// to install it: nothing asks for one later (permissions.request's data_collection), so none is optional.
// websiteContent: a page's content, screenshots, PDFs, recorded requests, to the AI provider. websiteActivity:
// the clicks and typing the model makes on a page. browsingActivity: the tabs' URLs and titles.
// personalCommunications: the chat. searchTerms: web.search's queries, to the search engine. authenticationInfo:
// the API keys, MCP sign-ins and custom tools' secrets, each to its own service. bookmarksInfo: the bookmarks
// found, to the provider, once Settings → Bookmarks has the optional permission. personallyIdentifyingInfo: the
// voice that dictation sends to the provider to transcribe (sidepanel/useDictation: the page's own microphone,
// no offscreen document, so it can run there).
export const FIREFOX_DATA_COLLECTION = [
  'websiteContent', 'websiteActivity', 'browsingActivity', 'personalCommunications', 'searchTerms',
  'authenticationInfo', 'bookmarksInfo', 'personallyIdentifyingInfo',
];

type Manifest = Record<string, unknown>;

export function firefoxManifest(manifest: Manifest): void {
  manifest.permissions = (manifest.permissions as string[]).filter((p) => !FIREFOX_MISSING.includes(p));
  delete manifest.key;
  const commands = manifest.commands as Record<string, { description?: string }> | undefined;
  delete commands?.['audio-toggle']; // no tab audio there (core/build)
  delete commands?.['speak-toggle']; // nor Speak
  // No chat floating on a page there (core/build floatingChat): its key opens the chat full screen in a tab.
  const float = commands?.['float-chat'];
  if (float) float.description = 'Open the chat full screen in a tab';
  delete manifest.web_accessible_resources; // its only entry, the floating chat's page, is not built there
  // Never in private windows: conversations, memory and logs keep pages' content, and Mozilla's policies allow
  // no data of a private window to be stored. Firefox then neither offers to run it there nor runs it.
  manifest.incognito = 'not_allowed';
  manifest.browser_specific_settings = {
    gecko: {
      id: 'teseo-browser-agent@aseth0',
      strict_min_version: '140.0',
      data_collection_permissions: { required: [...FIREFOX_DATA_COLLECTION] },
    },
  };
}
