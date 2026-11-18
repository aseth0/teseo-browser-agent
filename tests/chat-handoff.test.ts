import { describe, expect, it } from 'vitest';
import { isImagesPayload } from '../src/capture/protocol';
import { HANDOFF_MS, handoffStep } from '../src/core/handoff';
import { isChatHandoff, isConversationPayload } from '../src/widget/protocol';

const conversation = (extra = {}) => ({ kind: 'conversation', messages: [], ...extra });

describe('isChatHandoff', () => {
  it('takes a handoff as the extension writes it', () => {
    expect(isChatHandoff({ at: 1, payload: conversation() })).toBe(true);
    expect(isChatHandoff({ at: 1, payload: conversation({ conversationId: 'c1', send: 'Hi', shown: 'Hi', agentId: 'a1' }), tab: 3 })).toBe(true);
    expect(isChatHandoff({ at: 1, payload: conversation(), panelTab: 3 })).toBe(true);
  });

  it('refuses anything else read from storage', () => {
    expect(isChatHandoff(undefined)).toBe(false);
    expect(isChatHandoff('handoff')).toBe(false);
    expect(isChatHandoff({ payload: conversation() })).toBe(false);
    expect(isChatHandoff({ at: 1, messages: [] })).toBe(false); // an older build's, flat
    expect(isChatHandoff({ at: 1, payload: conversation({ messages: 'none' }) })).toBe(false);
    expect(isChatHandoff({ at: 1, payload: conversation(), tab: '3' })).toBe(false);
    expect(isChatHandoff({ at: 1, payload: conversation(), panelTab: '3' })).toBe(false);
    expect(isChatHandoff({ at: 1, payload: conversation({ send: 42 }) })).toBe(false);
    expect(isChatHandoff({ at: 1, payload: conversation({ send: 'Hi', shown: 1 }) })).toBe(false);
  });
});

describe('handoffStep, for a conversation', () => {
  const h = { at: 1000, payload: conversation() };
  const at: Parameters<typeof handoffStep>[2] = { tab: undefined, taken: 0, idle: true, now: 2000, waitMs: HANDOFF_MS };
  const step = (v: unknown, a: typeof at) => handoffStep(v, isConversationPayload, a);

  it('takes one meant for this chat, once', () => {
    expect(step(h, at)).toEqual({ step: 'take', handoff: h });
    expect(step(h, { ...at, taken: 1000 }).step).toBe('none');
    expect(step({ ...h, tab: 3 }, at).step).toBe('none');
    expect(step({ ...h, tab: 3 }, { ...at, tab: 3 }).step).toBe('take');
  });

  // The chat's pin off: one side panel per tab, each taking only what is handed to it; the window's
  // panel, only what is for none of them.
  it("takes one for a tab's own side panel only in that panel", () => {
    expect(step({ ...h, panelTab: 3 }, { ...at, panelTab: 3 }).step).toBe('take');
    expect(step({ ...h, panelTab: 3 }, { ...at, panelTab: 4 }).step).toBe('none');
    expect(step({ ...h, panelTab: 3 }, at).step).toBe('none');
    expect(step(h, { ...at, panelTab: 3 }).step).toBe('none');
    expect(step({ ...h, tab: 3 }, { ...at, panelTab: 3 }).step).toBe('none'); // the floating chat's
  });

  // Addressed by a click that woke the background before it read the pin: the tab's side panel or the
  // window's takes it, whichever the click (or the user, after) opened.
  it("takes one addressed before the pin was known in the tab's panel or the window's", () => {
    const any = { ...h, panelTab: 3, anyPanel: true };
    expect(isChatHandoff(any)).toBe(true);
    expect(step(any, { ...at, panelTab: 3 }).step).toBe('take');
    expect(step(any, at).step).toBe('take');
    expect(step(any, { ...at, panelTab: 4 }).step).toBe('none');
    expect(step(any, { ...at, tab: 3 }).step).toBe('none'); // the floating chat's
    expect(isChatHandoff({ ...h, anyPanel: 'yes' })).toBe(false);
  });

  // Where the chat cannot float (Firefox), the page opens it full screen in a tab (background/widget-host):
  // what it carries is for that chat alone, which takes nothing else (another chat's would be lost).
  it('takes one for the chat full screen in a tab only there', () => {
    const full = { ...h, full: true };
    expect(isChatHandoff(full)).toBe(true);
    expect(step(full, { ...at, full: true }).step).toBe('take');
    expect(step(full, at).step).toBe('none'); // the window's side panel
    expect(step(full, { ...at, panelTab: 3 }).step).toBe('none');
    expect(step(full, { ...at, tab: 3 }).step).toBe('none');
    expect(step(h, { ...at, full: true }).step).toBe('none');
    expect(step({ ...h, panelTab: 3, anyPanel: true }, { ...at, full: true }).step).toBe('none');
    expect(step(full, { ...at, full: true, idle: false }).step).toBe('wait');
    expect(isChatHandoff({ ...h, full: 'yes' })).toBe(false);
  });

  it('waits while a turn runs or the turns are compacted, and drops one too old', () => {
    expect(step(h, { ...at, idle: false }).step).toBe('wait');
    expect(step(h, { ...at, now: 1000 + HANDOFF_MS }).step).toBe('drop');
    expect(step(h, { ...at, idle: false, now: 1000 + HANDOFF_MS }).step).toBe('drop');
  });
});

// Screenshots from the popup or a shortcut, for the message box: routed as a conversation is, taken also
// while a turn runs (attaching does not disturb it).
describe('handoffStep, for images', () => {
  const a = { at: 1000, payload: { kind: 'images', images: [{ mediaType: 'image/jpeg', data: 'x' }] } };
  const at: Parameters<typeof handoffStep>[2] = { tab: undefined, taken: 0, now: 2000, waitMs: HANDOFF_MS };
  const step = (v: unknown, x: typeof at) => handoffStep(v, isImagesPayload, x);

  it('takes one meant for this chat, once, whether or not a turn runs', () => {
    expect(step(a, at)).toEqual({ step: 'take', handoff: a });
    expect(step(a, { ...at, taken: 1000 }).step).toBe('none');
  });
  it("leaves another chat's", () => {
    expect(step({ ...a, tab: 3 }, at).step).toBe('none');
    expect(step({ ...a, tab: 3 }, { ...at, tab: 3 }).step).toBe('take');
    expect(step({ ...a, panelTab: 3 }, { ...at, panelTab: 4 }).step).toBe('none');
    expect(step({ ...a, panelTab: 3 }, { ...at, panelTab: 3 }).step).toBe('take');
  });
  it('drops one too old, and refuses a conversation handoff', () => {
    expect(step(a, { ...at, now: 1000 + HANDOFF_MS }).step).toBe('drop');
    expect(step({ at: 1000, payload: conversation() }, at).step).toBe('none');
  });
});
