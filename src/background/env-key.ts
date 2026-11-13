// The key injected at build time (EXTERNAL_MODEL_API_KEY, wxt.config.ts) is compiled into the worker
// alone: never into the pages' chunks, which are web-accessible (a page that learns their URL can
// read them). The worker keeps it in the extension's IndexedDB (storage/secrets), where the pages
// read it like any other key; a build without one deletes it.
import { updateSecret } from '../storage/secrets';

const injectedKey = () => (typeof __ENV_API_KEY__ !== 'undefined' ? __ENV_API_KEY__ : null);

export const keepEnvKey = (key = injectedKey() ?? undefined) =>
  updateSecret<string>('envKey', (prev) => ({ value: key, notify: key !== prev }));
