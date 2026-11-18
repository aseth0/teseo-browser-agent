import { describe, expect, it } from 'vitest';
import { FIREFOX_DATA_COLLECTION, firefoxManifest } from '../src/core/firefox-manifest';

// Firefox's manifest (core/firefox-manifest), from the one every build shares (wxt.config.ts).
const shared = () => ({
  name: 'Teseo',
  key: 'PUBLIC-KEY',
  permissions: ['storage', 'sidePanel', 'offscreen', 'debugger', 'favicon', 'tabCapture', 'tts', 'tabs', 'identity'],
  optional_permissions: ['bookmarks'],
  commands: { 'audio-toggle': {}, 'speak-toggle': {}, 'float-chat': { description: 'Open or fold the chat floating on this page' }, 'open-side-panel': {} },
  web_accessible_resources: [{ resources: ['floating.html'], matches: ['<all_urls>'] }],
});

describe("Firefox's manifest", () => {
  it('drops what Firefox has no API for, the key and the floating chat', () => {
    const m: Record<string, unknown> = shared();
    firefoxManifest(m);
    expect(m.permissions).toEqual(['storage', 'tabs', 'identity']);
    expect(m.key).toBeUndefined();
    expect(Object.keys(m.commands as object)).toEqual(['float-chat', 'open-side-panel']);
    expect((m.commands as Record<string, { description: string }>)['float-chat']!.description).toBe('Open the chat full screen in a tab');
    expect(m.web_accessible_resources).toBeUndefined();
  });

  it('never runs in private windows', () => {
    const m: Record<string, unknown> = shared();
    firefoxManifest(m);
    expect(m.incognito).toBe('not_allowed');
  });

  it("declares every kind of data it sends, in Mozilla's categories, all required", () => {
    const m: Record<string, unknown> = shared();
    firefoxManifest(m);
    const gecko = (m.browser_specific_settings as { gecko: Record<string, unknown> }).gecko;
    expect(gecko).toMatchObject({ id: 'teseo-browser-agent@aseth0', strict_min_version: '140.0' });
    expect(gecko.data_collection_permissions).toEqual({ required: FIREFOX_DATA_COLLECTION });
    expect([...FIREFOX_DATA_COLLECTION].sort()).toEqual([
      'authenticationInfo', 'bookmarksInfo', 'browsingActivity', 'personalCommunications', 'personallyIdentifyingInfo', 'searchTerms', 'websiteActivity', 'websiteContent',
    ]);
    // Mozilla's names (MDN, browser_specific_settings): `technicalAndInteraction` may only be optional, and none here is.
    const MOZILLA = ['authenticationInfo', 'bookmarksInfo', 'browsingActivity', 'financialAndPaymentInfo', 'healthInfo', 'locationInfo', 'personalCommunications', 'personallyIdentifyingInfo', 'searchTerms', 'websiteActivity', 'websiteContent'];
    for (const c of FIREFOX_DATA_COLLECTION) expect(MOZILLA).toContain(c);
  });
});
