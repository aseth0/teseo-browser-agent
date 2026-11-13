import type { Message } from '../../../core/types';
import { labelOf, modelCalls, NO_TIMING } from '../turn-steps';

// Each model call a bar on the turn's clock (from your message), and what ran between them: the
// tools the call before asked for, and before the first, reading the page and getting ready.
export function ganttOf(messages: Message[]): { source?: string; none?: string } {
  const calls = modelCalls(messages);
  if (!calls.length) return { none: NO_TIMING };
  const ms = (n: number) => Math.max(0, Math.round(n));
  const model: string[] = [];
  const between: string[] = [];
  let end = 0;
  calls.forEach((c, i) => {
    const start = ms(c.meta.sinceStartMs - c.meta.ms);
    if (start - end > 50) {
      const before = i === 0 ? 'Reading the page' : labelOf(calls[i - 1]!.tools.join(', ') || 'Waiting', 28, { colon: true });
      between.push(`${before} :b${i}, ${end}, ${start}`);
    }
    const what = c.tools.length ? `${c.tools.length} ${c.tools.length === 1 ? 'tool' : 'tools'}` : 'text';
    model.push(`Model ${i + 1} · ${what} · ${(c.meta.ms / 1000).toFixed(1)} s :m${i}, ${start}, ${ms(c.meta.sinceStartMs)}`);
    end = ms(c.meta.sinceStartMs);
  });
  return { source: ['gantt', 'dateFormat x', 'axisFormat %S.%L s', 'section Model', ...model, ...(between.length ? ['section Tools and page', ...between] : [])].join('\n') };
}
