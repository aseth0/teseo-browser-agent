// Settings → About you: what the user wrote about themselves, put where {{about_user}} is in your
// system prompt and in an agent's instructions (context/request systemPromptParts). Nowhere else.
import { truncate } from '../core/truncate';

export const ABOUT_USER_VAR = '{{about_user}}';

// The text with the variable replaced at every place by what the user wrote (cut to its limit),
// as written: what it puts in is not looked at again. Without it, by nothing.
export function fillAboutUser(text: string, about: string | undefined): string {
  if (!text.includes(ABOUT_USER_VAR)) return text;
  const trimmed = about?.trim() ?? '';
  return text.split(ABOUT_USER_VAR).join(trimmed && truncate(trimmed, 'aboutUser'));
}

// Whether any of these prompts has the variable (Settings → About you says so when none has).
export const usesAboutUser = (texts: (string | undefined)[]) => texts.some((t) => t?.includes(ABOUT_USER_VAR));
