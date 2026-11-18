// Whether a newer version of Teseo is out, for the downloadable build only: it is loaded unpacked and
// never updates itself (the Chrome Web Store's build is updated by the store, a dev build is the source).
// One request, the first time the toolbar popup opens after the browser starts (a marker in
// storage.session, gone with the browser): GitHub's latest release of the build's own repository, of
// which only its tag is read, kept as a version number. Nothing about the user goes, no credentials. A
// failure (the repository private, the rate limit, offline, an answer not understood) says nothing.
// What it found is kept (storage.local UPDATE_KEY) for the popup's notice, until closed for that version,
// and Settings → About, which says so for as long as the installed version is older. Settings → About
// turns it off (Settings updateCheck): no request then, and neither shows anything.
// The logic is here, with what touches the browser passed in; ui/useUpdateNotice wires it.

// storage.local: the latest version found, and the one whose popup notice was closed. A key of its own.
export const UPDATE_KEY = 'updateNotice';
// storage.session: set once this browser session has checked (or tried to).
export const UPDATE_CHECKED_KEY = 'updateChecked';

export interface UpdateState {
  latest?: string; // the latest release's version, as parseVersion gives it
  dismissed?: string; // the version whose popup notice was closed
}

// "v0.76.0" or "0.76.0" → "0.76.0"; anything else, undefined. Up to four whole numbers, as a manifest's
// version, none of them too long to compare as a number.
export function parseVersion(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^v?(\d{1,9}(?:\.\d{1,9}){0,3})$/.exec(v.trim());
  return m?.[1];
}

// Negative when `a` is older than `b`, 0 when the same (0.76 = 0.76.0), positive when newer. Each part as
// a number: 0.10.0 is newer than 0.9.0.
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// The version of GitHub's latest release, from its answer: its tag_name alone, as a version.
export const latestFromRelease = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? parseVersion((body as { tag_name?: unknown }).tag_name) : undefined;

// Whether this build checks at all: a release's build (core/links releaseBuild) that is not the store's,
// of a GitHub repository. Anything else never makes the request.
export const updateCheckAllowed = (build: { release: boolean; store: boolean; slug: string | undefined }): boolean =>
  build.release && !build.store && !!build.slug;

export const releasesApi = (slug: string): string => `https://api.github.com/repos/${slug}/releases/latest`;

// What shows: About, the installed version and the latest while older; the popup, the latest unless its
// notice was closed for it. Nothing where the build does not check, the setting is off, or nothing newer.
export interface UpdateView {
  about?: { installed: string; latest: string };
  popup?: { latest: string };
}
export function updateView({ allowed, enabled, installed, state }: { allowed: boolean; enabled: boolean; installed: string | undefined; state: UpdateState | undefined }): UpdateView {
  const now = parseVersion(installed);
  const latest = parseVersion(state?.latest);
  if (!allowed || !enabled || !now || !latest || compareVersions(latest, now) <= 0) return {};
  const dismissed = parseVersion(state?.dismissed);
  return { about: { installed: now, latest }, ...(dismissed !== latest && { popup: { latest } }) };
}

// The stored state once the popup notice is closed for `latest`.
export const dismissedState = (state: UpdateState | undefined, latest: string): UpdateState => ({ ...state, dismissed: latest });

// Settings updateCheck: on unless turned off.
export const updateCheckOn = (settings: { updateCheck?: boolean } | undefined | null): boolean => settings?.updateCheck !== false;

export interface UpdateCheckDeps {
  allowed: boolean;
  enabled: boolean;
  slug: string | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  // storage.session's marker: whether this browser session checked, and setting it.
  checked: () => Promise<boolean>;
  markChecked: () => Promise<void>;
  // storage.local's state.
  load: () => Promise<UpdateState | undefined>;
  save: (state: UpdateState) => Promise<void>;
  timeoutMs?: number;
}

// The check, once per browser session: the marker is set before the request, so a failure is not
// retried until the browser starts again. Resolves to the latest version found, or undefined (not
// checked, or failed). Never rejects.
export async function checkForUpdate(d: UpdateCheckDeps): Promise<string | undefined> {
  if (!d.allowed || !d.enabled || !d.slug) return undefined;
  try {
    if (await d.checked()) return undefined;
    await d.markChecked();
    const res = await d.fetch(releasesApi(d.slug), {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(d.timeoutMs ?? 10_000),
    });
    if (!res.ok) return undefined;
    const latest = latestFromRelease(await res.json());
    if (!latest) return undefined;
    const state = await d.load();
    if (state?.latest !== latest) await d.save({ ...state, latest });
    return latest;
  } catch {
    return undefined;
  }
}
