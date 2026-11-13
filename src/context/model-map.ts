// A number per model (core/util modelKey) under one storage.local key, learned from the model's
// calls: read, watched, and changed one at a time (the chat and the agents it asks learn at once).
// What is not a number there (a build that wrote it otherwise) counts as not learned: the budget
// never gets NaN.
import { browser } from 'wxt/browser';
import { isObject, modelKey } from '../core/util';
import { storageGet } from '../storage/area';
import { serialized } from '../storage/serial';
import { watchKey } from '../storage/watch';

const numbers = (v: unknown): Record<string, number> =>
  isObject(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]))) : {};

export function modelMap(key: string) {
  const all = async (): Promise<Record<string, number>> => numbers(await storageGet<unknown>('local', key));
  const changing = serialized(key);
  return {
    all,
    of: async (providerId: string, model: string): Promise<number | undefined> => (await all())[modelKey(providerId, model)],
    // The model's value made from the one there (none: left as it is).
    change: (providerId: string, model: string, next: (before: number | undefined) => number | undefined): Promise<void> =>
      changing(async () => {
        const values = await all();
        const at = modelKey(providerId, model);
        const value = next(values[at]);
        if (value !== undefined && value !== values[at]) await browser.storage.local.set({ [key]: { ...values, [at]: value } });
      }),
    // The value of one model (by its modelKey) forgotten.
    forget: (key_: string): Promise<void> =>
      changing(async () => {
        const values = await all();
        if (!(key_ in values)) return;
        const { [key_]: _gone, ...rest } = values;
        await browser.storage.local.set({ [key]: rest });
      }),
    onChanged: (cb: (values: Record<string, number>) => void) => watchKey('local', key, (c) => cb(numbers(c.newValue))),
  };
}
