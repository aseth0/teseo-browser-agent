// "Make a tool…" puts its message in the box: the whole box when it is empty, else after what is
// written there, on a new line (a half-written message is not lost).
export const withMakeTool = (input: string, ask: string) => (input.trim() ? `${input.replace(/\s+$/, '')}\n${ask}` : ask);
