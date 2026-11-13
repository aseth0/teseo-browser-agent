import { setLimitOverrides } from '../core/limits';
import { setTextOverrides } from '../core/model-texts';
import type { Settings } from '../storage/settings-types';
import { setDedupe } from './dedupe';

// What applyModelSettings sets, as one key: applied again only once it changes.
export const modelSettingsKey = (settings: Settings) => JSON.stringify([settings.promptTexts ?? {}, settings.limits ?? {}, settings.context?.dedupe ?? {}]);

// The texts, the size limits and what is not sent again, as edited in Settings. Module state in each
// extension context: set before building anything with them.
export function applyModelSettings(settings: Settings): void {
  setTextOverrides(settings.promptTexts);
  setLimitOverrides(settings.limits);
  setDedupe(settings.context?.dedupe);
}
