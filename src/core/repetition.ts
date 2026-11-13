// A model caught in a loop, writing the same thing again and again until it runs out of tokens: found at
// the end of the text or reasoning being streamed (core/parts-builder), so that the call is cut there. Two
// kinds: a short fragment (1–20 characters) at least 50 times in a row over at least 400 characters
// ("^*^*^*…"), and a line or sentence (21–300 characters) at least 8 times in a row. A fragment of only
// whitespace (indentation, blank lines) is no loop.
interface Loop {
  fragment: string; // what it repeats, from where it starts
  start: number; // where the repetition starts in the text
}

const TAIL = 2400; // what is looked at, from the end
const SHORT = 20;
const LONG = 300;

// Not itself a shorter fragment repeated ("^*^*" is "^*"): that one is judged by its own rule.
const primitive = (f: string) => {
  for (let d = 1; d * 2 <= f.length; d++) if (f.length % d === 0 && f.slice(0, d).repeat(f.length / d) === f) return false;
  return true;
};

const rule = (period: number) => (period <= SHORT ? { times: 50, least: Math.max(400, period * 50) } : { times: 8, least: period * 8 });

export function findLoop(text: string): Loop | undefined {
  const tail = text.slice(-TAIL);
  const n = tail.length;
  for (let period = 1; period <= LONG && period * 2 <= n; period++) {
    const { times, least } = rule(period);
    if (n < least) continue;
    // How far back the end keeps repeating itself every `period` characters.
    let same = 0;
    while (same < n - period && tail[n - 1 - same] === tail[n - 1 - same - period]) same++;
    const run = same + period;
    if (run < least || Math.floor(run / period) < times) continue;
    const from = n - run;
    const fragment = tail.slice(from, from + period);
    if (!fragment.trim() || !primitive(fragment)) continue;
    return { fragment, start: text.length - n + from };
  }
  return undefined;
}

// The text up to the loop, with a few of its repetitions so that it shows.
const KEPT_REPEATS = 3;
export const cutAt = (text: string, loop: Loop) => text.slice(0, loop.start + loop.fragment.length * KEPT_REPEATS);

// The fragment as the chat and the model are told it: at most 40 characters, line breaks as \n.
export const fragmentShown = (fragment: string) => {
  const one = fragment.replace(/\r?\n/g, '\\n');
  return one.length > 40 ? `${one.slice(0, 40)}…` : one;
};
