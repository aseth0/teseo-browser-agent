import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));

const { conversationPolicies, effectivePolicy } = await import('../src/policy/store');

describe('conversation policies', () => {
  beforeEach(() => storage.reset());

  it('allow a site for one conversation, not for others', async () => {
    await conversationPolicies('c1').set('shop.test', 'auto');
    expect(await conversationPolicies('c1').load()).toEqual({ 'shop.test': 'auto' });
    expect(await conversationPolicies('c2').load()).toEqual({});
  });

  it('can be taken back', async () => {
    const c1 = conversationPolicies('c1');
    await c1.set('shop.test', 'auto');
    await c1.set('mail.test', 'auto');
    await c1.set('shop.test', 'ask');
    expect(await c1.load()).toEqual({ 'mail.test': 'auto' });
  });

  it('come before the site policy, which applies elsewhere', () => {
    expect(effectivePolicy({ 'shop.test': 'auto' }, {}, 'shop.test')).toBe('auto');
    expect(effectivePolicy({}, { 'shop.test': 'read-only' }, 'shop.test')).toBe('read-only');
    expect(effectivePolicy({}, {}, 'shop.test')).toBe('ask');
  });
});
