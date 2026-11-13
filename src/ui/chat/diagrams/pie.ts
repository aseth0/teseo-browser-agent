import type { Message } from '../../../core/types';
import { labelOf, modelCalls, NO_TIMING } from '../turn-steps';

// The tokens each model call took, in and out together, with what it went on to do.
export function pieOf(messages: Message[]): { source?: string; none?: string } {
  const calls = modelCalls(messages);
  if (!calls.length) return { none: NO_TIMING.replace('its timing', 'its token counts') };
  const approx = calls.every((c) => c.meta.reported) ? '' : ' (estimated)';
  return {
    source: [
      'pie showData',
      `title Tokens by model call, in + out${approx}`,
      ...calls.map((c, i) => `"Call ${i + 1} → ${c.tools.length ? labelOf(c.tools.join(', '), 24) : 'text'}" : ${c.meta.input + c.meta.output}`),
    ].join('\n'),
  };
}
