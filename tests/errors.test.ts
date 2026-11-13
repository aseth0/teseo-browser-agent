import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).inertBrowser());
const callPage = vi.fn();
vi.mock('../src/page/bridge', async (importOriginal) => ({ ...(await importOriginal<object>()), callPage: (...args: unknown[]) => callPage(...args) }));

const { bestEffort, errorText } = await import('../src/core/errors');
const { signInAsked } = await import('../src/web/tools');
const { readPageValues } = await import('../src/context/pipeline');

describe('errorText', () => {
  it('says the message without its error type', () => {
    expect(errorText(new TypeError('TypeError: failed to fetch'))).toBe('failed to fetch');
    expect(errorText('plain')).toBe('plain');
  });
});

describe('bestEffort', () => {
  it('settles with undefined, saying nothing of the expected failures and logging the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await bestEffort(Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')), 't')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(await bestEffort(Promise.reject(new Error('quota exceeded')), 't')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[t]', expect.any(Error));
    expect(await bestEffort(Promise.resolve(3), 't')).toBe(3);
    warn.mockRestore();
  });
});

describe('signInAsked', () => {
  const navigating = () => Promise.reject(new Error('The message port closed before a response was received.'));

  it('asks again, once loaded, a page that was navigating', async () => {
    const settle = vi.fn(async () => undefined);
    const ask = vi.fn().mockImplementationOnce(navigating).mockResolvedValueOnce(true);
    expect(await signInAsked(ask, settle)).toBe(true);
    expect(settle).toHaveBeenCalledOnce();
  });

  it('takes a page still navigating after that for one without a sign-in form', async () => {
    expect(await signInAsked(navigating, async () => undefined)).toBe(false);
  });

  it('lets any other failure through instead of reading the page as is', async () => {
    const denied = () => Promise.reject(new Error('No permission to read the tab'));
    await expect(signInAsked(denied, async () => undefined)).rejects.toThrow('No permission');
  });
});

describe('readPageValues', () => {
  it('says why the values could not be read', async () => {
    callPage.mockRejectedValueOnce(new Error('The page did not respond'));
    expect(await readPageValues(1, ['{{meta:title}}'])).toEqual({ values: {}, error: 'The page did not respond' });
  });

  it('reads them, and asks nothing for none', async () => {
    callPage.mockResolvedValueOnce({ '{{meta:title}}': { text: 'T' } });
    expect(await readPageValues(1, ['{{meta:title}}'])).toEqual({ values: { '{{meta:title}}': { text: 'T' } } });
    expect(await readPageValues(1, [])).toEqual({ values: {} });
  });
});
