// The replies of speech.say (speech/tool), which reads a text aloud with the agent's voice profile.

import type { TextDef } from './types';

export const SPEECH_TEXTS = {
  'result.speech_reading': { group: 'replies', tool: 'speech.say', label: 'Reply', text: 'It is being read aloud to the user.' },
  'error.speech_not_read': { group: 'replies', tool: 'speech.say', label: 'Not read', when: 'it could not be read aloud', text: 'It was not read aloud: {error}' },
} satisfies Record<string, TextDef>;
