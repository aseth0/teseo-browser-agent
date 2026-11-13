// A Lucide icon (ISC license) as React draws it: in the current color, on a 24 × 24 grid. Settings
// draws its icons with it, one set throughout; the page widget's bubble too.
import type { IconNode } from 'lucide';

export function LucideIcon({ node, size = 20 }: { node: IconNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {node.map(([tag, attrs], i) => {
        const Tag = tag as 'path';
        return <Tag key={i} {...(attrs)} />;
      })}
    </svg>
  );
}
