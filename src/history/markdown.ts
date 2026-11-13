// A conversation as Markdown, to read or share: your messages and the model's answers, with the
// tools it used (the context attached to your messages and the reasoning are left out); a notice from an
// agent of the Agents Panel as a line of its own.
import { isPanelNotice, noticeLine, shownText } from '../core/messages';
import { stripMarks } from '../core/model-texts';
import type { Conversation } from './store';

export function conversationMarkdown(conv: Conversation): string {
  const lines = [`# ${conv.title}`, '', `${new Date(conv.createdAt).toLocaleString()}${conv.site ? ` · ${conv.site}` : ''}${conv.model ? ` · ${conv.model}` : ''}`];
  for (const m of conv.history) {
    if (m.role === 'tool') continue;
    if (isPanelNotice(m)) {
      lines.push('', `_${noticeLine(m)}_`);
      continue;
    }
    const texts = m.parts.flatMap((p) => (p.type === 'text' && !p.context && p.text.trim() ? [stripMarks(shownText(p)).trim()] : []));
    const calls = m.parts.flatMap((p) => (p.type === 'tool_call' ? [`\`${p.name}\``] : []));
    if (!texts.length && !calls.length) continue;
    lines.push('', m.role === 'user' ? '## You' : '## Assistant');
    if (texts.length) lines.push('', texts.join('\n\n'));
    if (calls.length) lines.push('', `_Tools: ${calls.join(', ')}_`);
  }
  return `${lines.join('\n')}\n`;
}
