// What web.search returns, as pure functions (web/tools runs the searches).
import { stripMarks } from '../core/model-texts';

export const DEFAULT_RESULTS = 5;
export const MAX_RESULTS = 10;

// "https://www.bing.com/search?q=%s" with the query in it.
export const searchUrl = (engineUrl: string, query: string) => engineUrl.replace('%s', encodeURIComponent(query));

// The first `n` results of a template's output: a result starts with a "- " line, and the lines
// under it go with it.
export function firstResults(output: string, n: number): { results: string; count: number } {
  const kept: string[] = [];
  let count = 0;
  for (const line of output.split('\n')) {
    if (stripMarks(line).startsWith('- ')) {
      if (count === n) break;
      count++;
    }
    kept.push(line);
  }
  return { results: kept.join('\n').trim(), count };
}
