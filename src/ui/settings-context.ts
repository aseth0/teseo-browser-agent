import { createContext, useContext } from 'react';
import type { Settings } from '../storage/settings';
import type { SettingsSave, SettingsUpdate } from './useSettings';

// The page's settings and how to change them (ui/useSettings), set by the side panel's App and the
// options page once they are read: what they hold takes them from here instead of through every level.
// `save`: the same change as `update`, done once it is stored (what must wait for it, e.g. moving an
// MCP server's keys after its rename).
export interface SettingsValue {
  settings: Settings;
  update: SettingsUpdate;
  save: SettingsSave;
}
export const SettingsContext = createContext<SettingsValue | null>(null);

export function useSettingsContext(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettingsContext outside SettingsContext');
  return value;
}
