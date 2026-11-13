// The lines of an action's box (widget/actions), from the tool's answer or the model's: on their own,
// so that the steps' outputs (widget/steps) and the runs (widget/run) build them alike.
import { fillTemplate, wholePlaceholder } from '../tools/custom/values';
import { extractPath } from '../tools/http';
import { isObject } from '../core/util';
import type { ActionOutput } from './actions';

// One line of a box: its text and, when it has one, its link (only to a web page).
export interface OutputLine {
  text: string;
  href?: string;
}

const KEY = /\{([A-Za-z_]\w*)\}/g; // an answer's keys, as they come
const show = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// A link template with an element's keys in it, each encoded; one that is just "{url}" takes the
// value as it is.
const linkOf = (template: string, keys: Record<string, unknown>) => {
  const whole = wholePlaceholder(template, KEY);
  return whole ? show(keys[whole]) : fillTemplate(template, (k) => encodeURIComponent(show(keys[k])), KEY);
};

// The lines of a box from the tool's answer.
export function outputLines(answer: unknown, output: ActionOutput): OutputLine[] {
  const found = output.from?.trim() ? extractPath(answer, output.from.trim()) : answer;
  if (found === undefined || found === null || found === '') return [];
  return (Array.isArray(found) ? found : [found]).map((item) => {
    const keys: Record<string, unknown> = isObject(item) ? item : { value: item };
    const text = output.text?.trim()
      ? fillTemplate(output.text, (k) => show(keys[k]), KEY)
      : isObject(item) ? Object.values(item).map(show).join(' · ') : show(item);
    const href = output.link?.trim() ? linkOf(output.link.trim(), keys) : undefined;
    return { text, ...(href && /^https?:\/\//i.test(href) && { href }) };
  });
}
