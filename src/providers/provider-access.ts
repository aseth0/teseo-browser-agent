// The provider's site is granted at runtime (Test connection in Settings, or from the chat, once); and
// the provider for a request made outside a chat's run, through the word blacklist.
import type { AccessRequest } from '../core/types';
import { hasAccess, providerAccess } from '../page/access';
import { createProvider } from './registry';
import type { ProviderConfig } from '../storage/settings';
import { blacklistGate } from '../word-blacklist/gate';
import { loadBlacklist } from '../word-blacklist/store';

const canReach = (cfg: ProviderConfig) => hasAccess(cfg.baseURL).catch(() => false);

// Granted, or asked for now (from the chat): false when the user does not allow it.
export const reachOrAsk = async (cfg: ProviderConfig, ask: (access: AccessRequest) => Promise<boolean>) =>
  (await canReach(cfg)) || ask(providerAccess(cfg));

// Where nothing can be asked (a compaction's summary, the page widget): why it cannot run.
export const unreachable = async (cfg: ProviderConfig) =>
  (await canReach(cfg)) ? undefined : `No access to ${providerAccess(cfg).site}: allow it with Test connection in Settings → Providers.`;

// Its requests masked as the word blacklist says (word-blacklist/gate), with the terms as saved now.
export const gatedProvider = async (cfg: ProviderConfig, opts: Parameters<typeof blacklistGate>[1]) =>
  blacklistGate(await loadBlacklist(), opts).provider(createProvider(cfg), cfg.id);
