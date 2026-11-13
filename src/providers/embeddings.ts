// A provider's embeddings endpoint (POST {baseURL}/embeddings, as OpenAI-compatible servers have it):
// texts in, their vectors out, in the same order. With the provider's key and extra headers, never its
// extra body: that one holds fields for a chat request. An answer that cannot be used throws: who asked
// decides what to do without it (memory/query-meaning, memory/indexer).
import type { ProviderConfig } from '../storage/settings-types';
import { buildHeaders } from './headers';

// Settings → Memory's model list: the ones whose names look like embeddings first. Short family names
// count only whole (not in "economic" or "subgen"), and a reranker of such a family (bge-reranker) cannot embed.
const EMBEDDINGS_LOOKING = /embed|minilm|mpnet|(?<![a-z0-9])(?:bge|e5|gte|nomic)(?![a-z0-9])/i;
const looksLikeEmbeddings = (id: string) => EMBEDDINGS_LOOKING.test(id) && !/rerank/i.test(id);

export const rankEmbeddingModels = (ids: string[]): string[] => [...ids.filter(looksLikeEmbeddings), ...ids.filter((id) => !looksLikeEmbeddings(id))];

const isVector = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

export async function embedTexts(cfg: Pick<ProviderConfig, 'baseURL' | 'apiKey' | 'extraHeaders'>, model: string, input: string[], signal?: AbortSignal): Promise<number[][]> {
  const res = await fetch(`${cfg.baseURL.replace(/\/+$/, '')}/embeddings`, {
    method: 'POST',
    headers: buildHeaders(cfg.apiKey, cfg.extraHeaders),
    body: JSON.stringify({ model, input }),
    signal,
  });
  if (!res.ok) throw new Error(`The embeddings request failed: the server answered ${res.status}.`);
  const body = (await res.json()) as { data?: { index?: number; embedding?: unknown }[] };
  const data = Array.isArray(body?.data) ? body.data : [];
  const vectors = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
  if (vectors.length !== input.length || !vectors.every(isVector) || new Set(vectors.map((v) => v.length)).size > 1) {
    throw new Error('The embeddings answer cannot be used: expected one list of numbers per text, all as long.');
  }
  return vectors;
}
