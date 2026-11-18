// Keeps the tools' vectors current for matching them by meaning (Settings → Tools → Matching, with
// Memory's Semantic search): embeds the tools whose text is missing or changed, in batches, saving each,
// so a failure or a dead worker loses nothing. Never on a message's path: a run starts it once its
// message is matched (by words, and by meaning for the tools already indexed), and Settings → Tools →
// Matching shows how far it went and starts it too. A tool's text is its own name as words, without its
// server's name, and its description (tools/match): measured, the server's name in every tool of a server
// pulled them all alike towards a message naming it. As the word blacklist leaves them, after the model's
// prefix for documents. Its vectors live in their own database (tools/match-meaning TOOL_VECTOR_DB).
import { browser } from 'wxt/browser';
import { errorText } from '../core/errors';
import { stripMarks } from '../core/model-texts';
import { hostOf } from '../core/util';
import { indexRunner, MEMORY_INDEX_BATCH, MEMORY_INDEX_TIMEOUT_MS } from '../memory/indexer';
import { endpointHash, isFresh, semanticTarget, textHash, type SemanticTarget } from '../memory/semantic';
import { vectorDb, type VectorRecord } from '../memory/vector-db';
import { hasAccess } from '../page/access';
import { embedTexts } from '../providers/embeddings';
import type { Settings } from '../storage/settings-types';
import { loadBlacklist } from '../word-blacklist/store';
import { withoutGroupName, type MatchGroup } from './match';

export const TOOL_VECTOR_DB = 'browser-agent-tool-vectors';
export const toolVectors = vectorDb(TOOL_VECTOR_DB);
export const TOOL_INDEX_STATUS_KEY = 'toolIndexStatus'; // in storage.local: the last run's, for Settings

export interface ToolIndexStatus {
  indexed: number; // of the tools that run was given
  total: number;
  running?: boolean;
  error?: string;
}

// A tool as it is embedded, by its dotted name.
export interface ToolDoc {
  name: string;
  sent: string;
  hash: string;
}

// The texts of the groups' tools as they are sent, with their hashes.
export async function toolDocs(groups: MatchGroup[], target: SemanticTarget): Promise<ToolDoc[]> {
  const mask = (await loadBlacklist())?.blacklist.mask ?? ((s: string) => s);
  return Promise.all(
    groups.flatMap((g) =>
      g.each.map(async (t) => {
        const words = withoutGroupName(g, t.words);
        const sent = (target.semantic.documentPrefix ?? '') + mask(stripMarks(words ? `${words}\n${t.about}` : t.about));
        return { name: t.name, sent, hash: await textHash(sent) };
      }),
    ),
  );
}

// The vectors that stand for these texts now, by tool name.
export async function freshVectors(docs: ToolDoc[], target: SemanticTarget): Promise<Map<string, VectorRecord>> {
  const endpoint = await endpointHash(target.provider.baseURL);
  const stored = new Map((await toolVectors.read()).map((r) => [r.itemId, r]));
  return new Map(
    docs.flatMap((d): [string, VectorRecord][] => {
      const r = stored.get(d.name);
      return r && isFresh(r, { providerId: target.provider.id, model: target.model, endpoint }, d.hash) ? [[d.name, r]] : [];
    }),
  );
}

// What Settings shows; a page that cannot write it (a test, a closing worker) indexes all the same.
const report = async (status: ToolIndexStatus) => {
  try {
    await browser.storage.local.set({ [TOOL_INDEX_STATUS_KEY]: status });
  } catch {
    // shown as counted from the vectors
  }
  return status;
};

// `keepGoing`: asked before each batch, false once a newer run is waiting (indexRunner).
export async function syncToolIndex(settings: Settings, groups: MatchGroup[], keepGoing: () => boolean = () => true): Promise<ToolIndexStatus> {
  const total = groups.reduce((n, g) => n + g.tools.length, 0);
  const target = semanticTarget(settings);
  if (!target || !total) return { indexed: 0, total };
  const { provider, model } = target;
  let indexed = 0;
  try {
    const docs = await toolDocs(groups, target);
    const endpoint = await endpointHash(provider.baseURL);
    const fresh = await freshVectors(docs, target);
    let pending = docs.filter((d) => !fresh.has(d.name));
    indexed = total - pending.length;
    if (!pending.length) return await report({ indexed, total });
    if (!(await hasAccess(provider.baseURL))) return await report({ indexed, total, error: `No access to ${hostOf(provider.baseURL)}: allow it with Test in Settings → Memory.` });
    await report({ indexed, total, running: true });
    while (pending.length && keepGoing()) {
      const batch = pending.slice(0, MEMORY_INDEX_BATCH);
      const vectors = await embedTexts(provider, model, batch.map((d) => d.sent), AbortSignal.timeout(MEMORY_INDEX_TIMEOUT_MS));
      await toolVectors.write(batch.map((d, n) => ({ itemId: d.name, providerId: provider.id, model, endpoint, dimensions: vectors[n]!.length, hash: d.hash, vector: Float32Array.from(vectors[n]!) })));
      pending = pending.slice(batch.length);
      indexed = total - pending.length;
      await report(pending.length ? { indexed, total, running: true } : { indexed, total });
    }
    return { indexed, total };
  } catch (e) {
    return report({ indexed, total, error: e instanceof DOMException && e.name === 'TimeoutError' ? 'The provider did not answer in time.' : errorText(e) });
  }
}

// One run at a time in this page or worker, with the latest groups asked for: a run's message starts it
// (background/agent-run) once it went by what was indexed, never waiting for it.
let latest: { settings: Settings; groups: MatchGroup[] } | undefined;
const runner = indexRunner(async (keepGoing) => (latest ? syncToolIndex(latest.settings, latest.groups, keepGoing) : undefined));
export function indexToolsLater(settings: Settings, groups: MatchGroup[]): void {
  latest = { settings, groups };
  runner();
}
