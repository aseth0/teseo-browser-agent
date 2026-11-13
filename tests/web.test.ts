// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runTemplate } from '../src/content/template-run';
import { stripMarks } from '../src/core/model-texts';
import { pickView } from '../src/templates/render';
import { parseTemplateMarkdown } from '../src/templates/store';
import { templateProblems } from '../src/templates/validate';
import { firstResults, searchUrl } from '../src/web/results';

const builtin = (name: string) => ({ ...parseTemplateMarkdown(readFileSync(`templates/${name}/TEMPLATE.md`, 'utf8')), id: name, enabled: true });

// The template's view for the URL, run over the HTML.
async function results(name: string, url: string, html: string): Promise<string> {
  const t = builtin(name);
  expect(templateProblems(t, [])).toEqual([]);
  const view = pickView(t, url)?.view;
  expect(view, `a view of ${name} for ${url}`).toBeDefined();
  document.body.innerHTML = html;
  return stripMarks((await runTemplate(document, Object.fromEntries(t.views.map((v) => [v.name, v.body])), view!.name)).output).trim();
}

describe('web search', () => {
  it('puts the query in the search URL', () => {
    expect(searchUrl('https://www.bing.com/search?q=%s', 'precio cable & usb')).toBe('https://www.bing.com/search?q=precio%20cable%20%26%20usb');
  });

  it('keeps the first results, each with the lines under it', () => {
    const output = '- a\n  more of a\n- b\n- c';
    expect(firstResults(output, 2)).toEqual({ results: '- a\n  more of a\n- b', count: 2 });
    expect(firstResults(output, 5).count).toBe(3);
    expect(firstResults('nothing listed', 3)).toEqual({ results: 'nothing listed', count: 0 });
  });

  it('reads DuckDuckGo results, and its HTML version', async () => {
    const ddg =
      '<article data-testid="result"><h2><a data-testid="result-title-a" href="https://en.wikipedia.org/wiki/Platypus"><span>Platypus - Wikipedia</span></a></h2>' +
      '<div data-result="snippet">The platypus is a semiaquatic mammal.</div></article>';
    expect(await results('duckduckgo-search', 'https://duckduckgo.com/?q=platypus&t=vivaldi&ia=web', ddg)).toBe(
      '- [Platypus - Wikipedia](https://en.wikipedia.org/wiki/Platypus) — The platypus is a semiaquatic mammal.',
    );
    const lite =
      '<div class="result result--ad"><a class="result__a" href="https://ads.test/">Ad</a></div>' +
      '<div class="result"><a class="result__a" href="https://animals.test/platypus">Platypus</a><a class="result__snippet">Lays eggs.</a></div>';
    expect(await results('duckduckgo-search', 'https://html.duckduckgo.com/html/?q=platypus', lite)).toBe('- [Platypus](https://animals.test/platypus) — Lays eggs.');
  });

  it('reads Bing and Google results', async () => {
    const bing =
      '<ol id="b_results"><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=1">Ornithorhynchus anatinus - Wikipedia</a></h2>' +
      '<cite>https://en.wikipedia.org › wiki</cite><div class="b_caption"><p>The platypus is a species of mammal.</p></div></li></ol>';
    expect(await results('bing-search', 'https://www.bing.com/search?q=platypus', bing)).toBe(
      '- [Ornithorhynchus anatinus - Wikipedia](https://www.bing.com/ck/a?u=1) · https://en.wikipedia.org › wiki — The platypus is a species of mammal.',
    );
    const google =
      '<div id="search"><div class="MjjYud"><a href="https://animals.test/platypus"><h3>Platypus</h3></a><div class="VwiC3b">Lays eggs.</div></div>' +
      '<div class="MjjYud"><div>People also ask</div></div></div>';
    expect(await results('google-search', 'https://www.google.com/search?q=platypus', google)).toBe('- [Platypus](https://animals.test/platypus) — Lays eggs.');
  });
});
