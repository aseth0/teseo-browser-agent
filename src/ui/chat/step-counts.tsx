// A turn's steps counted, as the chat's step boxes and turn diagrams say them in their line.
import { Fragment, type ReactNode } from 'react';
import { Icon } from '../chat-icons';
import { plural } from '../../core/util';

// Each count there is, with its icon (agents have none).
export const stepCounts = (c: { thoughts: number; tools: number; agents?: number; errors: number }): ReactNode[] =>
  [
    c.thoughts > 0 && <><Icon name="thought" size={12} /> {plural(c.thoughts, 'thought')}</>,
    c.tools > 0 && <><Icon name="tool" size={12} /> {plural(c.tools, 'tool')}</>,
    !!c.agents && plural(c.agents, 'agent'),
    c.errors > 0 && <><Icon name="error" size={12} /> {plural(c.errors, 'error')}</>,
  ].filter((s) => s !== false);

// Parts of a line, between dots.
export const DotLine = ({ parts }: { parts: ReactNode[] }) => <>{parts.map((s, i) => <Fragment key={i}>{i > 0 && ' · '}{s}</Fragment>)}</>;
