// speech.say: an agent reads a text aloud on its own, with its voice profile (or the default one), when
// its switch is on (Settings → Agents; background/run-setup offers it only then). Its effect is `read`
// and it touches no site (`siteless`): it only produces sound, changes no page and sends nothing to a
// site the page chose, so it goes through no confirmation. The text goes to the user's own provider of
// the voice, as reading an answer aloud from the panel does. It returns once the first piece is back.
import { text } from '../core/model-texts';
import type { Tool } from '../core/types';
import { fields, optString } from '../tools/define';
import { SAY_TOOL, type SpeakStarted } from './protocol';

export type Say = (text: string, agentId: string | undefined, tabId: number | undefined) => Promise<SpeakStarted>;

export function speechTools(say: Say): Tool[] {
  return [
    {
      name: SAY_TOOL,
      description:
        'Reads a text aloud to the user with your voice. Use it when the user asks to hear something. Write the text as it should be said, ' +
        'without Markdown. It plays in the background; a new text replaces the one being read.',
      inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'What to say' } }, required: ['text'] },
      source: 'speech',
      effect: 'read',
      siteless: true,
      async run(raw, ctx) {
        const said = optString(fields(raw).text)?.trim() ?? '';
        const r = await say(said, ctx.agentId, ctx.tabId);
        return 'error' in r ? { type: 'text', text: text('error.speech_not_read', { error: r.error }), isError: true } : { type: 'text', text: text('result.speech_reading') };
      },
    },
  ];
}
