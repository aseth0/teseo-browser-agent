import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate, compareVersions, dismissedState, latestFromRelease, parseVersion, updateCheckAllowed, updateCheckOn, updateView,
  type UpdateCheckDeps, type UpdateState,
} from '../src/core/update-check';

// The "new version available" notice of the downloadable build (core/update-check): one request to
// GitHub's latest release, the first time the popup opens after the browser starts.
const SLUG = 'owner.test/teseo';
const answer = (body: unknown, status = 200) => vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));

function deps(over: Partial<UpdateCheckDeps> = {}) {
  let marked = false;
  let state: UpdateState | undefined;
  const d: UpdateCheckDeps = {
    allowed: true,
    enabled: true,
    slug: SLUG,
    fetch: answer({ tag_name: 'v0.76.0' }),
    checked: async () => marked,
    markChecked: async () => void (marked = true),
    load: async () => state,
    save: async (s) => void (state = s),
    ...over,
  };
  return { d, state: () => state, setState: (s: UpdateState) => void (state = s) };
}

describe('versions', () => {
  it('reads a version with or without its v, and nothing else', () => {
    expect(parseVersion('v0.76.0')).toBe('0.76.0');
    expect(parseVersion(' 1.2 ')).toBe('1.2');
    for (const bad of ['', 'v', 'latest', '0.76.0-beta', '1.2.3.4.5', '<b>1</b>', '1..2', 1, null, undefined, '1234567890.0']) expect(parseVersion(bad)).toBeUndefined();
  });
  it('compares each part as a number', () => {
    expect(compareVersions('0.76.0', '0.75.3')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.76', '0.76.0')).toBe(0);
    expect(compareVersions('0.75.3', '1.0.0')).toBeLessThan(0);
  });
  it("reads only the release's tag_name, as a version", () => {
    expect(latestFromRelease({ tag_name: 'v0.76.0', name: 'Anything', body: '<script>' })).toBe('0.76.0');
    expect(latestFromRelease({ tag_name: 'nightly' })).toBeUndefined();
    expect(latestFromRelease({ name: 'v0.76.0' })).toBeUndefined();
    expect(latestFromRelease('v0.76.0')).toBeUndefined();
    expect(latestFromRelease(null)).toBeUndefined();
  });
});

describe('which builds check', () => {
  it('only a release build that is not the store build, of a GitHub repository', () => {
    expect(updateCheckAllowed({ release: true, store: false, slug: SLUG })).toBe(true);
    expect(updateCheckAllowed({ release: true, store: true, slug: SLUG })).toBe(false);
    expect(updateCheckAllowed({ release: false, store: false, slug: SLUG })).toBe(false);
    expect(updateCheckAllowed({ release: true, store: false, slug: undefined })).toBe(false);
  });
  it('the setting is on unless turned off', () => {
    expect(updateCheckOn(undefined)).toBe(true);
    expect(updateCheckOn({})).toBe(true);
    expect(updateCheckOn({ updateCheck: false })).toBe(false);
  });
});

describe('the check', () => {
  it("asks GitHub's latest release of the build's repository, without credentials, and keeps its version", async () => {
    const { d, state } = deps();
    expect(await checkForUpdate(d)).toBe('0.76.0');
    const fetch = d.fetch as ReturnType<typeof answer>;
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/owner.test/teseo/releases/latest');
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(state()).toEqual({ latest: '0.76.0' });
  });
  it('once per browser session', async () => {
    const { d } = deps();
    await checkForUpdate(d);
    expect(await checkForUpdate(d)).toBeUndefined();
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });
  it('the store build and a dev build make no request, nor with the setting off', async () => {
    for (const build of [{ release: true, store: true }, { release: false, store: false }]) {
      const { d } = deps({ allowed: updateCheckAllowed({ ...build, slug: SLUG }) });
      expect(await checkForUpdate(d)).toBeUndefined();
      expect(d.fetch).not.toHaveBeenCalled();
    }
    const off = deps({ enabled: false });
    expect(await checkForUpdate(off.d)).toBeUndefined();
    expect(off.d.fetch).not.toHaveBeenCalled();
    const noSlug = deps({ slug: undefined });
    expect(await checkForUpdate(noSlug.d)).toBeUndefined();
    expect(noSlug.d.fetch).not.toHaveBeenCalled();
  });
  it('a failure is silent, keeps what was found before, and is not retried in the same session', async () => {
    const failures: UpdateCheckDeps['fetch'][] = [
      answer({ message: 'Not Found' }, 404),
      answer({ message: 'API rate limit exceeded' }, 403),
      vi.fn(async () => { throw new TypeError('Failed to fetch'); }),
      vi.fn(async () => new Response('not json', { status: 200 })),
      answer({ tag_name: '<img src=x>' }),
      answer([]),
    ];
    for (const fetch of failures) {
      const { d, state, setState } = deps({ fetch });
      setState({ latest: '0.75.9', dismissed: '0.75.9' });
      await expect(checkForUpdate(d)).resolves.toBeUndefined();
      expect(state()).toEqual({ latest: '0.75.9', dismissed: '0.75.9' });
      expect(await d.checked()).toBe(true);
    }
  });
  it('a storage that fails is silent too', async () => {
    const { d } = deps({ checked: async () => { throw new Error('no session storage'); } });
    await expect(checkForUpdate(d)).resolves.toBeUndefined();
    expect(d.fetch).not.toHaveBeenCalled();
  });
});

describe('what shows', () => {
  const base = { allowed: true, enabled: true, installed: '0.75.3' };
  it('a newer version: the popup notice and About', () => {
    expect(updateView({ ...base, state: { latest: '0.76.0' } })).toEqual({ about: { installed: '0.75.3', latest: '0.76.0' }, popup: { latest: '0.76.0' } });
  });
  it('the same or an older one: nothing', () => {
    expect(updateView({ ...base, state: { latest: '0.75.3' } })).toEqual({});
    expect(updateView({ ...base, state: { latest: '0.75.0' } })).toEqual({});
    expect(updateView({ ...base, state: undefined })).toEqual({});
  });
  it('a dismissed version stays dismissed in the popup, About still says it; a newer one shows again', () => {
    const closed = dismissedState({ latest: '0.76.0' }, '0.76.0');
    expect(updateView({ ...base, state: closed })).toEqual({ about: { installed: '0.75.3', latest: '0.76.0' } });
    expect(updateView({ ...base, state: { ...closed, latest: '0.77.0' } })).toEqual({ about: { installed: '0.75.3', latest: '0.77.0' }, popup: { latest: '0.77.0' } });
  });
  it('nothing in a build that does not check, with the setting off, or with what is stored not a version', () => {
    expect(updateView({ ...base, allowed: false, state: { latest: '0.76.0' } })).toEqual({});
    expect(updateView({ ...base, enabled: false, state: { latest: '0.76.0' } })).toEqual({});
    expect(updateView({ ...base, state: { latest: 'javascript:alert(1)' } })).toEqual({});
    expect(updateView({ ...base, installed: undefined, state: { latest: '0.76.0' } })).toEqual({});
  });
});

afterEach(() => vi.restoreAllMocks());
