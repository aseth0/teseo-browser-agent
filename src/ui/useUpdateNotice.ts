// The "new version available" notice (core/update-check), wired to the browser: what was last found,
// followed as it changes, and the check itself, which only the toolbar popup starts (`check`), once its
// settings are read (they may turn it off) and after it has rendered. Where the build does not check
// (a dev build, the Chrome Web Store's, a repository not on GitHub) nothing is read, stored or asked.
import { useEffect } from 'react';
import { browser } from 'wxt/browser';
import { STORE_BUILD } from '../core/build';
import { installedVersion, links, releaseBuild } from '../core/links';
import { githubSlug } from '../core/repo-url';
import {
  checkForUpdate, dismissedState, UPDATE_CHECKED_KEY, UPDATE_KEY, updateCheckAllowed, updateCheckOn, updateView, type UpdateState, type UpdateView,
} from '../core/update-check';
import { storageGet } from '../storage/area';
import { watchKey } from '../storage/watch';
import type { Settings } from '../storage/settings-types';
import { useLive } from './useLive';

const slug = () => githubSlug(links().repo);
export const updateCheckHere = (): boolean => updateCheckAllowed({ release: releaseBuild(), store: STORE_BUILD, slug: slug() });

const load = () => storageGet<UpdateState>('local', UPDATE_KEY);
const save = (state: UpdateState) => browser.storage.local.set({ [UPDATE_KEY]: state });

export interface UpdateNotice extends UpdateView {
  dismiss: () => void; // closes the popup's notice for the version it shows
}

export function useUpdateNotice(settings: Settings | null | undefined, { check = false }: { check?: boolean } = {}): UpdateNotice {
  const allowed = updateCheckHere();
  const state = useLive<UpdateState | undefined>(
    () => (allowed ? load() : Promise.resolve(undefined)),
    (set) => (allowed ? watchKey('local', UPDATE_KEY, (c) => set(c.newValue as UpdateState | undefined)) : () => {}),
    undefined,
    '[update]',
    allowed,
  );
  const enabled = updateCheckOn(settings);
  const ready = !!settings;
  useEffect(() => {
    if (!check || !allowed || !ready || !enabled) return;
    void checkForUpdate({
      allowed, enabled, slug: slug(),
      fetch: (url, init) => fetch(url, init),
      checked: async () => (await storageGet<boolean>('session', UPDATE_CHECKED_KEY)) === true,
      markChecked: () => browser.storage.session.set({ [UPDATE_CHECKED_KEY]: true }),
      load, save,
    });
  }, [check, allowed, ready, enabled]);
  const view = updateView({ allowed, enabled, installed: installedVersion(), state });
  const dismiss = () => {
    const latest = view.popup?.latest;
    if (latest) void load().then((s) => save(dismissedState(s, latest))).catch((e: unknown) => console.error('[update]', e));
  };
  return { ...view, dismiss };
}
