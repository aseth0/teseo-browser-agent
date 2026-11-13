import { applyModelSettings, modelSettingsKey } from '../context/model-settings';
import { SETTINGS_EDIT } from '../core/protocol';
import { errorText } from '../core/errors';
import { onRuntime } from '../core/runtime';
import { isExtensionPage } from '../core/sender';
import { loadSettings, updateSettings } from '../storage/settings';
import { applyEdit, isSettingsEdit } from '../storage/settings-edit';

// The settings, with the texts, the limits and what is not sent again (as edited in Options) applied
// to this context's module state when they differ from those applied: on first use, since the worker
// may have restarted since the last chat (or never ran one), and after they change. Not on every
// call, so a run in progress keeps its texts while the settings stay the same.
let applied: string | undefined;
export const settingsNow = async () => {
  const settings = await loadSettings();
  const key = modelSettingsKey(settings);
  if (key !== applied) {
    applyModelSettings(settings);
    applied = key;
  }
  return settings;
};

// The settings' changes the extension's pages hand over as they make them (ui/useSettings), stored
// here: a page may close right after, before it could store them itself. Each is applied to the
// settings as stored when its turn comes, in the order they came. Listening from the worker's start.
export function listenSettingsEdits(): void {
  onRuntime(SETTINGS_EDIT, (msg, sender) => {
    if (!isExtensionPage(sender)) return;
    if (!isSettingsEdit(msg.edit) || typeof msg.stamp !== 'string') return { error: 'Not a change to the settings.' };
    const edit = msg.edit;
    return updateSettings((stored) => applyEdit(stored, edit), msg.stamp).then(
      () => ({ ok: true as const }),
      (e: unknown) => {
        console.error('[settings]', errorText(e));
        return { error: errorText(e) };
      },
    );
  });
}
