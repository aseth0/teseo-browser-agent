// The memory items' vectors kept current from the worker (memory/indexer): at its start, as one that died
// goes on where it stopped, and when the items, the settings it depends on or the word blacklist change.
import { indexInputsChanged, indexRunner, syncMemoryIndex } from '../memory/indexer';
import { loadMemory, memoryStore } from '../memory/store';
import { onSecretChanged } from '../storage/secrets';
import { loadSettings } from '../storage/settings';
import { SETTINGS_KEY } from '../storage/settings-types';
import { watchKey } from '../storage/watch';
import { onBlacklistChanged } from '../word-blacklist/store';

export function listenMemoryIndex(): void {
  const trigger = indexRunner(async (keepGoing) => syncMemoryIndex(await loadSettings(), await loadMemory(), keepGoing));
  memoryStore.onChanged(trigger);
  watchKey('local', SETTINGS_KEY, ({ oldValue, newValue }) => indexInputsChanged(oldValue, newValue) && trigger());
  onBlacklistChanged(trigger);
  onSecretChanged('settings', trigger); // a provider's key: one fixed, after batches that failed
  trigger();
}
