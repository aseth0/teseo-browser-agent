import { describe, expect, it } from 'vitest';
import { stripMarks } from '../src/core/model-texts';
import { recordingBlock } from '../src/recording/block';
import { detectVariables, kindsFor, placeText, routeText, variablesOf } from '../src/recording/variables';
import { HIDDEN, type RecordedCall, type Recording } from '../src/recording/recording';

const call = (id: string, change: Partial<RecordedCall>): RecordedCall => ({ id, method: 'GET', url: '', at: 0, included: true, status: 200, ...change });
// A wiki: the page read, a plugin's dataset looked up, the page saved with the macro and the next version.
const wikiPage = (): Recording => ({
  tabId: 1, site: 'wiki.example.com', startedAt: 0, hidden: [],
  calls: [
    call('1', { url: 'https://wiki.example.com/rest/api/content/12345?expand=body.storage,version', responseBody: '{"id":"12345","type":"page","title":"Sales","version":{"number":7}}' }),
    call('2', { url: 'https://wiki.example.com/plugins/charts/api/datasets?q=revenue', responseBody: '{"items":[{"key":"ds-revenue-2026","label":"Revenue"}]}' }),
    call('3', { method: 'POST', url: 'https://wiki.example.com/rest/analytics/event', requestBody: '{"name":"edit"}', included: false }),
    call('4', {
      method: 'PUT', url: 'https://wiki.example.com/rest/api/content/12345',
      requestBody: '{"id":"12345","type":"page","title":"Sales","version":{"number":8},"body":{"storage":{"representation":"storage","value":"<ac:structured-macro ac:name=\\"chart\\"><ac:parameter ac:name=\\"dataset\\">ds-revenue-2026</ac:parameter></ac:structured-macro>"}}}',
    }),
  ],
});

describe('the variables of a recording', () => {
  it('finds values from an answer, computed ones and parameters, each with a name and where it goes', () => {
    const vars = detectVariables(wikiPage());
    const brief = vars.map((v) => `${v.name}=${v.value}:${v.kind}${v.from ? `<${placeText(v.from)}` : ''}>${v.uses.map(placeText).join(', ')}`);
    // #3 is the save: the analytics call is not ticked. The title goes back as the page had it.
    expect(brief).toEqual([
      'contentId=12345:answer<#1 answer (id)>#3 URL (after content), #3 sent (id)',
      'contentTitle=Sales:answer<#1 answer (title)>#3 sent (title)',
      'itemsKey=ds-revenue-2026:answer<#2 answer (items[0].key)>#3 sent (body.storage.value)',
      'versionNumber=8:computed<#1 answer (version.number)>#3 sent (version.number)',
      'q=revenue:parameter>#2 query (q)',
    ]);
  });
  it('leaves out the calls unticked, the values hidden, constants and what is too short', () => {
    const r = wikiPage();
    const values = detectVariables({ ...r, hidden: ['revenue'] }).map((v) => v.value);
    expect(values).not.toContain('edit'); // only in the call unticked
    expect(values).not.toContain('revenue');
    expect(values).not.toContain('storage'); // a constant of the API
    expect(values).not.toContain('page');
    const short = detectVariables({ ...r, calls: [call('1', { url: 'https://wiki.example.com/x?a=1&b=no&c=true', requestBody: `{"p":"${HIDDEN}"}` })] });
    expect(short).toEqual([]);
  });
  it('takes the user\'s changes: a name or another kind; one taken out by an older build goes as recorded', () => {
    const r = { ...wikiPage(), vars: { '12345': { name: 'pageId' }, revenue: { kind: 'fixed' as const }, 'ds-revenue-2026': { kind: 'removed' as const } } };
    const vars = variablesOf(r);
    expect(vars.map((v) => `${v.name}:${v.kind}`)).toEqual(['pageId:answer', 'contentTitle:answer', 'itemsKey:fixed', 'versionNumber:computed', 'q:fixed']);
  });
  it('offers the kinds as what happens when the tool runs', () => {
    const [answer, , , computed, parameter] = detectVariables(wikiPage());
    const labels = (v: Parameters<typeof kindsFor>[0]) => kindsFor(v).map((k) => `${k.value}:${k.label}`);
    expect(labels(answer!)).toEqual(['parameter:You give it each time', "answer:From #1's answer", 'fixed:Always as recorded']);
    expect(labels(computed!)).toEqual(['parameter:You give it each time', 'computed:Worked out (+1)', 'fixed:Always as recorded']);
    expect(labels(parameter!)).toEqual(['parameter:You give it each time', 'fixed:Always as recorded']);
  });
});

// The docs' example: a search, the product it found, and the product saved with its next version.
const oakChair = (): Recording => ({
  tabId: 1, site: 'shop.example.com', startedAt: 0, hidden: [],
  calls: [
    call('1', { url: 'https://shop.example.com/api/search?q=oak+chair', responseBody: '{"items":[{"id":"p-8812"}]}' }),
    call('2', { url: 'https://shop.example.com/api/products/p-8812', responseBody: '{"version":{"number":7}}' }),
    call('3', { method: 'PUT', url: 'https://shop.example.com/api/products/p-8812', requestBody: '{"version":{"number":8}}' }),
  ],
});

describe('where a variable comes from and is used, as the review says it', () => {
  it('from an answer, worked out, or given each time; the calls of one place together', () => {
    expect(detectVariables(oakChair()).map((v) => `${v.name}=${v.value}: ${routeText(v)}`)).toEqual([
      'itemsId=p-8812: from #1 items[0].id · used in #2, #3 URL',
      'versionNumber=8: #2 version.number (7) + 1 · used in #3 sent version.number',
      'q=oak chair: used in #1 query q',
    ]);
  });
  it('given each time or as recorded, it says only where it is used', () => {
    const [id] = variablesOf({ ...oakChair(), vars: { 'p-8812': { kind: 'parameter' } } });
    expect(routeText(id!)).toBe('used in #2, #3 URL');
  });
});

describe('the variables the model gets', () => {
  it('with Make a tool…, after the calls: those kept, where each comes from and goes; the fixed ones left as recorded', () => {
    const block = stripMarks(recordingBlock({ ...wikiPage(), tool: true, vars: { revenue: { kind: 'fixed' }, '12345': { name: 'pageId' } } }));
    expect(block).toContain('Variables, as the user marked them: make each parameter an input of the tool');
    expect(block).toContain('- pageId = 12345: from the answer of #1 (id); in #3 URL (after content), #3 sent (id)');
    expect(block).toContain('- versionNumber = 8: the answer of #1 (version.number) + 1; in #3 sent (version.number)');
    expect(block).not.toContain('- q = ');
    expect(block.indexOf('Variables,')).toBeLessThan(block.indexOf('</untrusted_page_content>'));
  });
  it('attached alone, none', () => {
    expect(stripMarks(recordingBlock(wikiPage()))).not.toContain('Variables,');
  });
});
