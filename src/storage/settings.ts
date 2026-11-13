// Settings persisted in chrome.storage.local (never sync), but for their secrets (the providers' keys
// and headers, the MCP servers' headers and client secrets), kept in storage/secrets where no content
// script can read them; loadSettings puts them back, each for the URL it was saved for. What they are: storage/settings-types; their
// secrets: settings-secrets; older ones upgraded: settings-migrate; read by the chat: settings-select.
import { browser } from 'wxt/browser';
import type { KeyChange } from './watch';
import { WIDGET_SETTINGS_KEY } from './keys';
import { storageGet } from './area';
import { readSecret, secretChanged, updateSecret } from './secrets';
import { serialized } from './serial';
import { hasSecrets, hasUnbound, settleStoredSecrets, splitSecrets, withSecrets, type SettingsSecrets } from './settings-secrets';
import { ENV_PROVIDER_ID, envKeyInjected, injectedBaseURL, normalize } from './settings-migrate';
import { SETTINGS_KEY, type Settings } from './settings-types';
import { actionBoxesButton, canRead, planOptions, selectionButtonOn } from '../speech/settings';

// The types nearly every module uses, still from here.
export type { ProviderConfig, Settings } from './settings-types';

// What the page widget needs from the settings (storage/keys WIDGET_SETTINGS_KEY), written with them.
// speakButton: Settings → Speak's button beside a selection, on with a voice to read with (as speech/settings
// selectionButtonOn says); speakBoxes: its button on an action's text boxes (actionBoxesButton); canSpeak:
// Speak can read (canRead), for the actions whose boxes are read on their own, with the pieces' sizes
// (Settings → Speak: First piece, Other pieces), to read an answer as it streams.
export type WidgetSettings = Pick<Settings, 'appearance' | 'chatWindow' | 'pageWidget'> & { speakButton?: boolean; speakBoxes?: 'on' | 'setup'; canSpeak?: boolean; pieceSizes?: { first: number; rest: number } };
const widgetSettingsOf = (s: Partial<Settings> | undefined): WidgetSettings => {
  const speakBoxes = s && actionBoxesButton(s);
  const sizes = s && canRead(s) ? planOptions({ speak: s.speak, voice: s.voice }) : undefined;
  return {
    appearance: s?.appearance,
    chatWindow: s?.chatWindow,
    pageWidget: s?.pageWidget,
    ...(s && selectionButtonOn(s) && { speakButton: true }),
    ...(speakBoxes && { speakBoxes }),
    ...(sizes && { canSpeak: true, pieceSizes: { first: sizes.first, rest: sizes.rest } }),
  };
};

// The widget's key made again from the settings, when it does not match them: settings saved before
// it existed, or written to storage by something other than saveSettings.
export async function syncWidgetSettings(): Promise<void> {
  const [stored, widget] = await Promise.all([storageGet<Partial<Settings>>('local', SETTINGS_KEY), storageGet<WidgetSettings>('local', WIDGET_SETTINGS_KEY)]);
  if (stored === undefined) return;
  const now = widgetSettingsOf(stored);
  if (JSON.stringify(now) !== JSON.stringify(widget)) await browser.storage.local.set({ [WIDGET_SETTINGS_KEY]: now });
}

export async function loadSettings(): Promise<Settings> {
  await settleStoredSecrets();
  const stored = await storageGet<Partial<Settings>>('local', SETTINGS_KEY);
  const secrets = await readSecret<SettingsSecrets>('settings');
  return normalize(withSecrets(stored, secrets), await envKeyFor(stored, secrets));
}

// The key injected at build time, as the worker keeps it (background/env-key); none without one. Only
// for the URL the user saved for its provider (or the build's): a content script may change the URL.
async function envKeyFor(stored: Partial<Settings> | undefined, secrets: SettingsSecrets | undefined): Promise<string | undefined> {
  if (!envKeyInjected()) return undefined;
  const url = stored?.providers?.find((p) => p.id === ENV_PROVIDER_ID)?.baseURL;
  const saved = secrets?.providers?.[ENV_PROVIDER_ID]?.baseURL ?? injectedBaseURL();
  return !url || url === saved ? readSecret<string>('envKey') : undefined;
}

// The secrets of the settings as this page or worker knows them: the latest it wrote, or read since
// another one changed them. Merged with each change to the settings, so that the echo of its own
// save is what it saved.
let knownSecrets: Promise<SettingsSecrets | undefined> | undefined;

// Settings saved by another page (options ↔ side panel) or this one, or their secrets, normalized like
// loadSettings, in the order they were written; with the stamp of the save, when it was updateSettings'.
export function onSettingsChanged(cb: (s: Settings, stamp: string | undefined) => void): () => void {
  let delivered: Promise<unknown> = Promise.resolve();
  const listener = (changes: Record<string, KeyChange>, area: string) => {
    if (area !== 'local') return;
    const changed = changes[SETTINGS_KEY];
    const secretsChanged = secretChanged('settings', changes, { elsewhere: true });
    const keyChanged = secretChanged('envKey', changes);
    const rev = changes[SETTINGS_REV];
    const stamp = rev && rev.newValue !== rev.oldValue ? (rev.newValue as string | undefined) : undefined;
    if (!changed && !secretsChanged && !keyChanged && !stamp) return;
    if (secretsChanged || !knownSecrets) knownSecrets = readSecret<SettingsSecrets>('settings');
    const secrets = knownSecrets;
    const stored = changed ? Promise.resolve(changed.newValue as Partial<Settings> | undefined) : storageGet<Partial<Settings>>('local', SETTINGS_KEY);
    delivered = delivered
      .then(async () => {
        const open = await stored;
        let saved = await secrets;
        // Saved by an older build, without their URLs: bound to them first, or they would be refused.
        if (hasUnbound(saved, open)) {
          await settleStoredSecrets();
          saved = await (knownSecrets = readSecret<SettingsSecrets>('settings'));
        } else if (open && hasSecrets(open)) void settleStoredSecrets().catch((e: unknown) => console.error('[settings]', e));
        cb(normalize(withSecrets(open, saved), await envKeyFor(open, saved)), stamp);
      })
      .catch((e: unknown) => console.error('[settings]', e));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

// storage.local: the stamp of the latest save through updateSettings, written with it, so that a page
// tells the echo of its own saves apart. Older builds neither write nor read it.
export const SETTINGS_REV = 'settingsRev';

// Saves one at a time across the pages and the worker (Options, each window's panel): each reads the
// settings as stored inside its turn, so none writes back a copy older than another's save.
const settingsWrites = serialized('settings');

// Changes the settings as they are stored when the change is made (not as a page last saw them), and
// gives what was written. The secrets go to storage/secrets and the rest to storage.local in the same
// turn, the secrets first (as before: a page closed right after a change keeps it). The injected key
// is not stored: a later build without it must not keep using it. No change (the same settings
// back): nothing written. `stamp`: what the echo of this save is told by (onSettingsChanged).
export function updateSettings(change: (stored: Settings) => Settings, stamp: string = crypto.randomUUID()): Promise<Settings> {
  return settingsWrites(async () => {
    const stored = await loadSettings();
    const s = change(stored);
    if (s === stored) return s;
    const providers = envKeyInjected() ? s.providers.map((p) => (p.id === ENV_PROVIDER_ID ? { ...p, apiKey: '' } : p)) : s.providers;
    const { open, secrets } = splitSecrets({ ...s, providers });
    knownSecrets = Promise.resolve(secrets);
    await updateSecret<SettingsSecrets>('settings', (prev) => ({
      value: secrets,
      notify: JSON.stringify(prev ?? {}) !== JSON.stringify(secrets),
      also: { [SETTINGS_KEY]: open, [WIDGET_SETTINGS_KEY]: widgetSettingsOf(s), [SETTINGS_REV]: stamp },
    }));
    return s;
  });
}

// The whole settings saved as they are.
export async function saveSettings(s: Settings): Promise<void> {
  await updateSettings(() => s);
}
