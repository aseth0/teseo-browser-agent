// Matching memory by meaning (Settings → Memory → Semantic search), what needs nobody to answer: whether
// it is on and with what, what an item sends, whether a stored vector still stands for it, and how close
// two vectors are. Off by default; an item passes by its words or by its meaning (memory/prompt).
import { stripMarks } from '../core/model-texts';
import { memoryOn } from '../storage/settings-select';
import type { ProviderConfig, SemanticSettings, Settings } from '../storage/settings-types';
import type { MemoryItem } from './store';
import type { VectorRecord } from './vector-db';

export const MEANING_THRESHOLD = 55; // Settings → Memory's "Meaning needed", when not set

export interface SemanticTarget {
  provider: ProviderConfig;
  model: string;
  threshold: number;
  semantic: SemanticSettings;
}

// With what it runs; none while off, with memory off, or with no provider or model to use (one deleted,
// or named by an imported setting).
export function semanticTarget(settings: Settings): SemanticTarget | undefined {
  const semantic = settings.memory?.semantic;
  const model = semantic?.model?.trim();
  if (!semantic?.enabled || !model || !memoryOn(settings)) return undefined;
  const provider = settings.providers.find((p) => p.id === semantic.providerId);
  return provider && { provider, model, threshold: semantic.threshold ?? MEANING_THRESHOLD, semantic };
}

// Those that can match by meaning. A pinned item always goes whole, so it is never sent.
export const indexable = (m: MemoryItem) => m.enabled && !m.pinned && !!m.text.trim();

// What is sent for an item: its title and text, as the word blacklist leaves them (`mask`), after the
// model's prefix for documents.
export function documentText(m: Pick<MemoryItem, 'title' | 'text'>, prefix: string | undefined, mask: (s: string) => string): string {
  const title = m.title?.trim();
  return (prefix ?? '') + mask(stripMarks(title ? `${title}\n${m.text}` : m.text));
}

export async function textHash(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The server a vector came from: a short hash of the provider's address, so that vectors of the same
// size from another server are not scored against its queries.
export const endpointHash = async (baseURL: string) => (await textHash(baseURL.trim().replace(/\/+$/, ''))).slice(0, 16);

// Whether a stored vector stands for this text with this model on this server; if not, the item goes by its
// words until it is embedded again. A record without a server (an older build's) counts as this one's,
// so that nothing is sent again only for the upgrade. `dimensions`: the length vectors are expected to
// have, when known.
export interface FreshTarget {
  providerId: string;
  model: string;
  endpoint: string;
  dimensions?: number;
}
export const isFresh = (r: VectorRecord, target: FreshTarget, hash: string) =>
  r.providerId === target.providerId && r.model === target.model && r.hash === hash &&
  (r.endpoint === undefined || r.endpoint === target.endpoint) &&
  (target.dimensions === undefined || r.dimensions === target.dimensions);

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

// Several best-first orders as one (reciprocal rank fusion): BM25's match and cosine are on different
// scales, so only their places are compared. On a tie, the first order's place decides.
const FUSION_K = 60;
export function fuseRanks(orders: string[][]): string[] {
  const scores = new Map<string, number>();
  for (const order of orders) order.forEach((id, place) => scores.set(id, (scores.get(id) ?? 0) + 1 / (FUSION_K + place + 1)));
  const first = new Map<string, number>();
  orders.flat().forEach((id, i) => first.has(id) || first.set(id, i));
  return [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)! || first.get(a)! - first.get(b)!);
}
