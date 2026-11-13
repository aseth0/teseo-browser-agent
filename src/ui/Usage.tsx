// Token counts as the chat shows them, and where they come from: a bar with a segment per source,
// in the Layers colors (Settings → Appearance) and grays for what has no origin mark.
import type { SourceBreakdown, UsageSource } from '../core/types';
import { ORIGINS } from './origins';

export const fmtTokens = (n: number) => Math.round(n).toLocaleString('en-US');
export const shortTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${Math.round(n)}`);
export const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

// In the order of the Layers legend, then the text without a mark.
const SOURCES: { source: UsageSource; label: string }[] = [
  ...ORIGINS.map((o) => ({ source: o.origin, label: o.label })),
  { source: 'system', label: 'System prompt text' },
  { source: 'tools', label: 'Tool definitions' },
  { source: 'wrappers', label: 'Extension text around the context' },
  { source: 'answers', label: 'Model answers and tool calls' },
  { source: 'results', label: 'Other tool results' },
];

// The class that gives a source its color (--o).
const sourceClass = (source: UsageSource) => `source origin-${source}`;

export const sourceRows = (sources: SourceBreakdown) => SOURCES.filter((s) => (sources[s.source] ?? 0) > 0).map((s) => ({ ...s, tokens: sources[s.source]! }));

export function SourceBar({ sources, className = '' }: { sources: SourceBreakdown; className?: string }) {
  const rows = sourceRows(sources);
  if (!rows.length) return null;
  return (
    <span className={`source-bar ${className}`} aria-hidden="true">
      {rows.map((r) => <span key={r.source} className={sourceClass(r.source)} style={{ flexGrow: r.tokens }} title={`${r.label}: ~${fmtTokens(r.tokens)} tokens`} />)}
    </span>
  );
}

export const Swatch = ({ source }: { source: UsageSource }) => <span className={`swatch ${sourceClass(source)}`} aria-hidden="true" />;
