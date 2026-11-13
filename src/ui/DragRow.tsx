import type { ReactNode } from 'react';
import { GripVertical } from 'lucide';
import { LucideIcon } from './LucideIcon';

// A row that moves: dragged by its handle, or with ↑ / ↓ on it. `over`: the row a drag would drop
// before (or after, the last one).
export function DragRow(props: { index: number; last: number; name: string; className?: string; dragging: number | null; over: number | null; onDrag: (i: number | null) => void; onOver: (i: number | null) => void; onMove: (from: number, to: number) => void; children: ReactNode }) {
  const { index, dragging, over } = props;
  const end = () => { props.onDrag(null); props.onOver(null); };
  const target = dragging !== null && over === index && dragging !== index ? (dragging < index ? ' drop-after' : ' drop-before') : '';
  return (
    <tr className={`${props.className ?? ''}${dragging === index ? ' dragging' : ''}${target}`}
      onDragOver={(e) => { if (dragging === null) return; e.preventDefault(); if (over !== index) props.onOver(index); }}
      onDrop={(e) => { e.preventDefault(); if (dragging !== null && dragging !== index) props.onMove(dragging, index); end(); }}>
      <td className="drag-col">
        <button type="button" className="drag-handle" draggable aria-label={`Move ${props.name}`} title="Drag to reorder (or ↑ / ↓)"
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', props.name); e.dataTransfer.setDragImage(e.currentTarget.closest('tr')!, 16, 16); props.onDrag(index); }}
          onDragEnd={end}
          onKeyDown={(e) => {
            const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1;
            if (to < 0 || to > props.last) return;
            e.preventDefault();
            props.onMove(index, to);
          }}>
          <LucideIcon node={GripVertical} size={16} />
        </button>
      </td>
      {props.children}
    </tr>
  );
}
