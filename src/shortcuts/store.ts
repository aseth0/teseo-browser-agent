// The keys set in Settings → Shortcuts as stored (storage.local, where the pages they are pressed in read
// them): read back only as keys (another version may have written them), and kept whole on each change.
import { browser } from 'wxt/browser';
import { PAGE_KEYS_KEY } from '../storage/keys';
import { watchKey } from '../storage/watch';
import { isPageKeys, type PageKeys } from './keys';

const asKeys = (v: unknown): PageKeys => (isPageKeys(v) ? v : {});

export const loadPageKeys = async (): Promise<PageKeys> => asKeys((await browser.storage.local.get(PAGE_KEYS_KEY))[PAGE_KEYS_KEY]);
export const savePageKeys = (keys: PageKeys): Promise<void> => browser.storage.local.set({ [PAGE_KEYS_KEY]: keys });
// Returns the unsubscribe.
export const onPageKeysChanged = (cb: (keys: PageKeys) => void): (() => void) => watchKey('local', PAGE_KEYS_KEY, (change) => cb(asKeys(change.newValue)));
