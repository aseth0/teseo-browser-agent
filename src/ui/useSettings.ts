import { useCallback, useEffect, useRef, useState } from 'react';
import { applyModelSettings } from '../context/model-settings';
import { loadSettings, onSettingsChanged, updateSettings, type Settings } from '../storage/settings';
import { errorText } from '../core/errors';
import { SETTINGS_EDIT } from '../core/protocol';
import { sendRuntime } from '../core/runtime';
import { applyEdit, diffEdit, patchEdit, type SettingsEdit } from '../storage/settings-edit';

// A change to the settings: the fields that change (the rest kept), or the next settings from the
// latest ones. Either way it applies on top of the changes made before it, even in the same tick.
export type SettingsChange = Partial<Settings> | ((prev: Settings) => Settings);
export type SettingsUpdate = (change: SettingsChange) => void;
// The same change, settled once it is stored (rejected when it could not be).
export type SettingsSave = (change: SettingsChange) => Promise<void>;

// What a Settings section changes: only the fields it sets, applied on top of the latest settings,
// so that two changes in the same tick both stay (a copy of the whole settings would undo the other).
// A field holding an object (chatView, history…) is replaced whole: a section builds it from what it
// rendered, so two changes to one such object in the same tick would keep only the last.
export type SettingsPatch = (patch: Partial<Settings>) => void;
// What most Settings sections take.
export interface PatchSectionProps {
  settings: Settings;
  onChange: SettingsPatch;
}
// A section may also be given the change as a function: one made after an await (a permission, a
// download) then applies to the settings as they are by then.
export interface SectionProps {
  settings: Settings;
  onChange: SettingsUpdate;
}

export const applySettingsChange = (prev: Settings, change: SettingsChange): Settings =>
  typeof change === 'function' ? change(prev) : { ...prev, ...change };

// The same change as data, to be applied to the settings stored by then, which another page may
// have changed since this one last saw them: a patch sets its fields; a function, what it changed
// here (storage/settings-edit diffEdit: a field of an object alone, a list whole).
const editOf = (prev: Settings, next: Settings, change: SettingsChange): SettingsEdit =>
  typeof change === 'function' ? diffEdit(prev, next) : patchEdit(change);

// Stored by the background, handed the change now, inside the click that made it: a page closed
// right after (the popup, a panel that moves) still has it stored, which a write of its own, after
// the lock and the reads it waits for, would not. Stored by this page when no worker answers.
function storeEdit(edit: SettingsEdit, stamp: string): Promise<void> {
  const here = () => updateSettings((stored) => applyEdit(stored, edit), stamp).then(() => undefined);
  let sent: Promise<{ ok: true } | { error: string } | undefined>;
  try {
    sent = sendRuntime({ type: SETTINGS_EDIT, edit, stamp });
  } catch (e) {
    sent = Promise.reject(e);
  }
  return sent.then(
    (reply) => {
      if (!reply) return here();
      if ('error' in reply) throw new Error(reply.error);
    },
    () => here(),
  );
}

// Settings shared by the side panel and the options page: each page sees the other's changes, and a
// save changes only what it changed, on the settings as stored (storage/settings updateSettings, run
// by the background for the page: storeEdit).
// `error`: the settings could not be read or saved.
export function useSettings(): [Settings | null, SettingsUpdate, string, SettingsSave] {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  // The latest settings, also those set in this tick and not rendered yet: the next change builds on them.
  const latest = useRef<Settings | null>(null);
  // The settings as last read or told, without this page's changes not stored yet.
  const stored = useRef<Settings | null>(null);
  // This page's saves whose echo has not come yet, oldest first, by their stamp: shown on top of the
  // settings told meanwhile, so that an earlier echo or another page's change does not undo them.
  const unsaved = useRef<{ stamp: string; change: SettingsChange }[]>([]);
  // The texts and limits they set are applied here, once per change, before anything renders with them.
  const take = useCallback((s: Settings) => {
    latest.current = s;
    applyModelSettings(s);
    setSettings(s);
  }, []);
  // The settings as stored, with this page's changes not stored yet on top.
  const takeStored = useCallback((s: Settings) => {
    stored.current = s;
    take(unsaved.current.reduce((acc, u) => applySettingsChange(acc, u.change), s));
  }, [take]);
  useEffect(() => {
    let current = true;
    loadSettings().then(
      // Another page's save may have come first: it is newer.
      (s) => current && !latest.current && takeStored(s),
      (e) => {
        console.error('[settings]', e);
        if (current) setError(`Could not read the settings: ${errorText(e)}`);
      },
    );
    // Every change told is taken, never skipped. The echo of an own save also says that it and the
    // saves before it are stored (they are written in turn): they are no longer put on top.
    const off = onSettingsChanged((s, stamp) => {
      const i = unsaved.current.findIndex((u) => u.stamp === stamp);
      if (i >= 0) unsaved.current = unsaved.current.slice(i + 1);
      takeStored(s);
    });
    return () => {
      current = false;
      off();
    };
  }, [takeStored]);
  const save = useCallback<SettingsSave>(
    (change) => {
      const prev = latest.current;
      if (!prev) return Promise.reject(new Error('The settings are not read yet.'));
      const next = applySettingsChange(prev, change);
      if (next === prev) return Promise.resolve();
      take(next);
      const stamp = crypto.randomUUID();
      unsaved.current = [...unsaved.current, { stamp, change }];
      // Once stored, its echo (if it has not come yet: a save that changed nothing has none) tells
      // what is stored now. One that failed is no longer shown.
      const done = () => (unsaved.current = unsaved.current.filter((u) => u.stamp !== stamp));
      const saving = storeEdit(editOf(prev, next, change), stamp);
      saving.then(
        () => {
          done();
          setError('');
        },
        (e) => {
          done();
          if (stored.current) takeStored(stored.current);
          console.error('[settings]', e);
          setError(`Could not save the settings: ${errorText(e)}`);
        },
      );
      return saving;
    },
    [take, takeStored],
  );
  // A failed save is shown (error), so the caller need not wait for it.
  const update = useCallback<SettingsUpdate>((change) => void save(change).catch(() => undefined), [save]);
  return [settings, update, error, save];
}
