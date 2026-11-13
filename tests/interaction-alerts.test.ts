import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

// Alerts for what waits for the user (core/interaction-kinds, background/alerts): each kind's level,
// nothing while the chat is in view, the badge and the notification, cleared once answered.
const notifications = { create: vi.fn(async () => ''), clear: vi.fn(async () => true), onClicked: fakeEvent<(id: string) => void>() };
vi.mock('wxt/browser', () => ({ browser: { notifications, runtime: { getURL: (p: string) => p }, tabs: {}, windows: {} } }));
let stored: Record<string, unknown> = {};
vi.mock('../src/background/settings', () => ({ settingsNow: async () => stored }));
const setBadgePart = vi.fn();
vi.mock('../src/background/badge', () => ({ setBadgePart }));
vi.mock('../src/background/panel-mode', () => ({ panelFollowsNow: () => true }));
vi.mock('../src/background/panel-windows', () => ({ panelShownIn: () => false }));

const { INTERACTION_KINDS, alertOf, levelOf } = await import('../src/core/interaction-kinds');
const { alertLevel } = await import('../src/storage/settings-select');
const { alertRaised, clearAlert, raiseAlert } = await import('../src/background/alerts');
const { questionAlert } = await import('../src/background/question-kinds');
const { sessionAlerts } = await import('../src/background/session-alerts');
const { createQuestions } = await import('../src/core/questions');

const where = { windowId: 1, sidePanel: true };
const badgeNow = () => setBadgePart.mock.calls.at(-1)?.[1] as boolean | undefined;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  stored = {};
  notifications.create.mockClear();
  notifications.clear.mockClear();
  setBadgePart.mockClear();
});

describe('the alert levels', () => {
  it('by urgency, by default: what stops a run notifies, what waits to be looked at marks the badge', () => {
    const levels = Object.fromEntries(INTERACTION_KINDS.map((k) => [k, levelOf(undefined, k)]));
    expect(levels).toEqual({
      action: 'notify', access: 'notify', ask: 'notify', 'sign-in': 'notify', pick: 'notify', 'agent-waiting': 'notify',
      'out-of-steps': 'badge', 'step-limit': 'badge', recording: 'badge',
    });
  });
  it("the user's level, else the default; an unknown value reads as the default", () => {
    expect(alertLevel({ interactions: { action: 'silent' } }, 'action')).toBe('silent');
    expect(alertLevel({ interactions: { recording: 'notify' } }, 'recording')).toBe('notify');
    expect(alertLevel({ interactions: { ask: 'loud' as never } }, 'ask')).toBe('notify');
    expect(alertLevel({}, 'step-limit')).toBe('badge');
  });
  it('nothing while the chat is in view; notify is the badge and a notification', () => {
    expect(alertOf('notify', true)).toEqual({ badge: false, notify: false });
    expect(alertOf('notify', false)).toEqual({ badge: true, notify: true });
    expect(alertOf('badge', false)).toEqual({ badge: true, notify: false });
    expect(alertOf('silent', false)).toEqual({ badge: false, notify: false });
  });
});

describe('what a question is', () => {
  it('by its card; in the Agents Panel, that panel agent waiting', () => {
    expect(questionAlert({ type: 'confirm', id: 'q', summary: 'Click "Buy"', host: 'shop.example.com' })).toEqual({ kind: 'action', message: 'Click "Buy" (shop.example.com)' });
    expect(questionAlert({ type: 'more-steps', id: 'q', agent: 'Researcher', steps: 15 })?.kind).toBe('out-of-steps');
    expect(questionAlert({ type: 'user-request', id: 'q', request: { kind: 'ask', questions: [{ question: 'Which one?', type: 'text' }] } })).toEqual({ kind: 'ask', message: 'Which one?' });
    expect(questionAlert({ type: 'user-request', id: 'q', request: { kind: 'pick', prompt: 'The price' } })?.kind).toBe('pick');
    expect(questionAlert({ type: 'user-request', id: 'q', request: { kind: 'sign-in', url: 'https://example.com', tabId: 3 } })?.kind).toBe('sign-in');
    expect(questionAlert({ type: 'confirm', id: 'q', summary: 'x', host: '' }, true)?.kind).toBe('agent-waiting');
    expect(questionAlert({ type: 'user-closed', id: 'q' })).toBeUndefined();
  });
});

describe('an alert', () => {
  it('none while the chat is in view', async () => {
    await raiseAlert('a1', 'action', { message: 'm', where, inView: true });
    expect(notifications.create).not.toHaveBeenCalled();
    expect(setBadgePart).not.toHaveBeenCalled();
    expect(alertRaised('a1')).toBe(false);
  });
  it('notify: the "!" and a silent notification, both cleared once answered', async () => {
    await raiseAlert('a2', 'action', { message: 'Click "Buy"', where, inView: false });
    expect(badgeNow()).toBe(true);
    expect(notifications.create).toHaveBeenCalledWith('ba-alert:a2', expect.objectContaining({ message: 'Click "Buy"', silent: true }));
    clearAlert('a2');
    expect(badgeNow()).toBe(false);
    expect(notifications.clear).toHaveBeenCalledWith('ba-alert:a2');
  });
  it('badge: no notification; silent: nothing', async () => {
    await raiseAlert('a3', 'step-limit', { message: 'm', where, inView: false });
    expect(badgeNow()).toBe(true);
    expect(notifications.create).not.toHaveBeenCalled();
    clearAlert('a3');
    stored = { interactions: { action: 'silent' } };
    setBadgePart.mockClear();
    await raiseAlert('a4', 'action', { message: 'm', where, inView: false });
    expect(setBadgePart).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });
  it('the badge stays while another still waits', async () => {
    await raiseAlert('b1', 'ask', { message: 'm', where, inView: false });
    await raiseAlert('b2', 'pick', { message: 'm', where, inView: false });
    clearAlert('b1');
    expect(badgeNow()).toBe(true);
    clearAlert('b2');
    expect(badgeNow()).toBe(false);
  });
  it('answered before its level was read: never raised', async () => {
    const raising = raiseAlert('c1', 'action', { message: 'm', where, inView: false });
    clearAlert('c1');
    await raising;
    expect(notifications.create).not.toHaveBeenCalled();
    expect(setBadgePart).not.toHaveBeenCalled();
  });
});

describe("a chat session's alerts", () => {
  const confirm = (id: string) => ({ type: 'confirm' as const, id, summary: 'Click', host: 'example.com' });
  const session = () => {
    const alerts = sessionAlerts(undefined);
    const questions = createQuestions((q: ReturnType<typeof confirm>) => alerts.sent(q), alerts.settled);
    return { alerts, questions };
  };

  it('none while its chat says it shows', async () => {
    const { alerts, questions } = session();
    alerts.view({ shown: true, windowId: 1 });
    void questions.ask((id) => confirm(id), false);
    await flush();
    expect(notifications.create).not.toHaveBeenCalled();
  });
  it('one while it does not, cleared once answered', async () => {
    const { alerts, questions } = session();
    alerts.view({ shown: false, windowId: 1 });
    let id = '';
    void questions.ask((qid) => confirm((id = qid)), false);
    await flush();
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(alertRaised(id)).toBe(true);
    questions.answer(id, 'confirm', true);
    expect(alertRaised(id)).toBe(false);
    expect(badgeNow()).toBe(false);
  });
  it('cleared too when the run stops and every question is denied', async () => {
    const { alerts, questions } = session();
    alerts.connected(false);
    let id = '';
    void questions.ask((qid) => confirm((id = qid)), false);
    await flush();
    expect(alertRaised(id)).toBe(true);
    questions.denyAll();
    expect(alertRaised(id)).toBe(false);
  });
  it('the step limit: a badge until the chat shows', async () => {
    const { alerts } = session();
    alerts.view({ shown: false });
    alerts.sent({ type: 'step-limit', steps: 30 });
    await flush();
    expect(badgeNow()).toBe(true);
    alerts.view({ shown: true });
    expect(badgeNow()).toBe(false);
  });
});
