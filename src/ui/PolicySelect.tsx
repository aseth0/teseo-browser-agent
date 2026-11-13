// What the agent may do on a site (or an MCP server): ask, act without asking, read only.
import { POLICY_LABELS, type SitePolicy } from '../core/site-policy';

export function PolicySelect({ value, onChange, label, title }: { value?: SitePolicy; onChange: (p: SitePolicy) => void; label: string; title?: string }) {
  return (
    <select aria-label={label} title={title} value={value ?? 'ask'} onChange={(e) => onChange(e.target.value as SitePolicy)}>
      {Object.entries(POLICY_LABELS).map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  );
}
