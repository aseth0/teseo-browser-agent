import { afterEach, describe, expect, it } from 'vitest';
import { formatPageContext } from '../src/context/page-context';
import { fill, markPageData, markValue, originRuns, placeholdersOf, setTextOverrides, setValueMarking, stripMarks, text, TEXT_DEFS, withMarkedValues, withMarker } from '../src/core/model-texts';
import { toOpenAIMessages } from '../src/providers/wire';
import { buildSystemPrompt, excludedTools, systemPromptSections } from '../src/context/request';
import type { Skill } from '../src/skills/types';
import type { Settings } from '../src/storage/settings';

const settings: Settings = { providers: [], systemPrompt: 'Be brief.', disabledTools: ['browser.find'], history: { enabled: false }, memory: { enabled: false } };
const general: Skill = { id: 'g', name: 'summarize-page', description: 'Summarize.', matches: [], body: '', references: [], enabled: true };

describe('request assembly', () => {
  it('system prompt = your prompt + page instructions + plan + skills, in that order', () => {
    expect(systemPromptSections({ settings, skills: [general], templates: [] }).map((s) => s.label)).toEqual(['Your system prompt', 'Page instructions', 'Plan', 'Skills']);
    // The plan line only while user.plan is offered.
    expect(systemPromptSections({ settings: { ...settings, disabledTools: ['user.plan'] }, skills: [], templates: [] }).map((s) => s.label)).not.toContain('Plan');
    expect(systemPromptSections({ settings, skills: [], templates: [], agent: { name: 'Shop', instructions: '', tools: ['browser.find'] } }).map((s) => s.label)).not.toContain('Plan');
    const system = buildSystemPrompt({ settings, skills: [general], templates: [] });
    expect(system.startsWith('Be brief.\n')).toBe(true);
    expect(system).toContain(text('system.page'));
    expect(system).toContain('- summarize-page: Summarize.');
    expect(buildSystemPrompt({ settings, skills: [], templates: [] })).not.toContain('## Skills'); // no empty section
  });

  it('tells the model about saved conversations while it can get them', () => {
    const withHistory = { ...settings, history: {}, memory: {} };
    expect(buildSystemPrompt({ settings: withHistory, skills: [], templates: [] })).toContain('<untrusted_saved_conversation>');
    expect(excludedTools(withHistory, [general])).toEqual(['browser.find']);
    // Off: no text, no tools.
    expect(buildSystemPrompt({ settings, skills: [], templates: [] })).not.toContain('saved_conversation');
    expect(excludedTools({ ...settings, memory: {} }, [general])).toEqual(['browser.find', 'history.search', 'history.read']);
    // Tools and mentions off: no text either.
    expect(buildSystemPrompt({ settings: { ...withHistory, disabledTools: ['history.search', 'history.read'], mentions: { history: false } }, skills: [], templates: [] })).not.toContain('saved_conversation');
  });

  it('skills tools are only offered when there is a general skill', () => {
    const memory = ['memory.search', 'memory.list', 'memory.read', 'memory.save', 'memory.delete']; // memory is off in these settings
    expect(excludedTools(settings, [])).toEqual(['browser.find', 'skills.load', 'skills.read_reference', 'history.search', 'history.read', ...memory]);
    expect(excludedTools(settings, [general])).toEqual(['browser.find', 'history.search', 'history.read', ...memory]);
  });

  it('formats the page block from fields, so placeholders render the template', () => {
    const text = formatPageContext({ url: '{url}', title: '{title}', lang: '{language}', viewport: '{viewport}', scroll: '{scroll}', selection: '{selected_text}', snapshot: '{visible_elements}' });
    expect(text).toBe(
      '<untrusted_page_content url="{url}">\n### Page\nurl: {url}\ntitle: {title}\nlanguage: {language}\nviewport: {viewport} · scroll: {scroll}\n\n' +
        '### Text selected by the user\n{selected_text}\n\n### Visible elements\n{visible_elements}\n</untrusted_page_content>',
    );
  });

  it('skips the selection section when there is none', () => {
    const text = formatPageContext({ url: 'u', title: 't', lang: '', viewport: '', scroll: '', selection: '', snapshot: 's' });
    expect(text).not.toContain('### Text selected');
  });
});

describe('editable texts', () => {
  afterEach(() => setTextOverrides(undefined));

  it('fills placeholders in one pass, never expanding placeholders inside the values', () => {
    expect(fill('a {x} b {y}', { x: '{y}' })).toBe('a {y} b {y}');
    expect(placeholdersOf('{a} {b} {a}')).toEqual(['a', 'b']);
  });

  it('uses the overrides everywhere the text is built', () => {
    setTextOverrides({ 'page.meta': 'PAGE {url}', 'system.page': 'Custom page rules.', 'result.snapshot_truncated': ' [cut]' });
    expect(formatPageContext({ url: 'u', title: '', lang: '', viewport: '', scroll: '', selection: '', snapshot: '' })).toContain('PAGE u');
    expect(buildSystemPrompt({ settings: { ...settings, disabledTools: ['user.plan'] }, skills: [], templates: [] })).toBe('Be brief.\n\nCustom page rules.');
    expect(withMarker({ text: 'tree', truncated: true }, 'pageElements', 'result.snapshot_truncated')).toBe('tree [cut]');
  });

  it('every default only uses placeholders the code provides', () => {
    // A typo in a default would reach the model as a literal "{...}".
    const known = new Set(['skill_list', 'skill_name', 'skill_description', 'url', 'page_sections', 'title', 'language', 'viewport',
      'scroll', 'selected_text', 'visible_elements', 'skill_instructions', 'reference_paths', 'action_note', 'option', 'key',
      'direction', 'reason', 'host', 'page_markdown', 'query', 'description', 'tool', 'result', 'skill_values', 'variable', 'value', 'max_chars',
      'count', 'items', 'n', 'fields', 'field', 'more',
      'template_name', 'template_output', 'diagnosis', 'found', 'chars', 'url_patterns', 'replace_page', 'template_body', 'comment',
      'line', 'filter', 'argument', 'calls', 'error', 'lines', 'left_out', 'tool_names', 'answers', 'answer', 'question', 'element', 'ref', 'done', 'total', 'server', 'score', 'count', 'results', 'turns', 'snippet', 'date', 'site', 'transcript', 'text', 'tools', 'id', 'view_name', 'path', 'views', 'view_paths', 'view_body', 'tab_source', 'tab_id', 'mention', 'engine', 'name', 'base', 'status', 'body', 'sample', 'agent', 'instructions', 'caller', 'task', 'agent_name', 'keys', 'cookies', 'requests', 'seconds',
      'memory_index', 'memory_id', 'memory_text', 'memory_title', 'memory_items', 'memory_domains', 'memory_agents', 'pinned', 'from', 'to', 'offset',
      'summary', 'max_words', 'what', 'pending', 'definition', 'custom_tool_list', 'action_name', 'action_list', 'agent_list',
      'condition', 'minutes', 'after', 'end', 'steps', 'selector', 'attr', 'group', 'fragment', 'groups', 'ms', 'names', 'given', 'agents', 'shown', 'part', 'page', 'pages', 'other', 'kind', 'message', 'problems', 'changes',
      'template_catalog', 'template_list', 'template_description', 'view_description', 'rounds', 'plan_steps', 'duration',
      'row', 'rows', 'state', 'step', 'max_steps', 'when', 'skills', 'feature', 'context', 'constraints', 'report', 'failed', 'label']);
    for (const def of Object.values(TEXT_DEFS)) for (const p of placeholdersOf(def.text)) expect(known).toContain(p);
  });

  it('marks filled-in values only while building a preview, and never twice', () => {
    expect(fill('a {x}', { x: 'v' })).toBe('a v'); // real requests: no marks
    const built = withMarkedValues(() => fill('{list} / {page}', { list: fill('- {n}', { n: 'one' }), page: markValue('P', 'page') }));
    expect(built).toBe('- \uE002one\uE003 / \uE000P\uE001'); // composite and page values are not re-wrapped
    expect(stripMarks(built)).toBe('- one / P');
    expect(fill('{x}', { x: 'v' })).toBe('v'); // marking ends with the build
  });

  it('marks the real conversation in the background: page data as such, and never sends the marks', () => {
    expect(markPageData({ t: 'x' })).toEqual({ t: 'x' }); // not marking: unchanged
    setValueMarking(true);
    try {
      // Every string read from the page, nested too; a page cannot fake an origin with mark characters.
      expect(markPageData({ meta: { title: 'T' }, lines: ['a', 'b\uE001c'], n: 3 })).toEqual({
        meta: { title: '\uE000T\uE001' },
        lines: ['\uE000a\uE001', '\uE000bc\uE001'],
        n: 3,
      });
      const history = [
        { role: 'user' as const, parts: [{ type: 'text' as const, text: fill('Page: {p}', { p: markPageData('P') }) }] },
        { role: 'tool' as const, parts: [{ type: 'tool_result' as const, toolCallId: 'c', content: fill('{r}', { r: 'ok' }) }] },
      ];
      expect(toOpenAIMessages(fill('S {x}', { x: 'v' }), history)).toEqual([
        { role: 'system', content: 'S v' },
        { role: 'user', content: 'Page: P' },
        { role: 'tool', tool_call_id: 'c', content: 'ok' },
      ]);
      expect((toOpenAIMessages(undefined, history, { keepMarks: true })[0] as { content: string }).content).toBe('Page: \uE000P\uE001');
      expect(withMarkedValues(() => fill('{x}', { x: 'v' }))).toBe('\uE002v\uE003');
      expect(fill('{x}', { x: 'v' })).toBe('\uE002v\uE003'); // still marking after a preview build
    } finally {
      setValueMarking(false);
    }
  });

  it('mark each origin with its own pair, and read them back (the first two as before)', () => {
    const built = withMarkedValues(() =>
      [markValue('M', 'message'), markValue('S', 'skill'), markValue('T', 'template'), markValue('V', 'skillValues'), markValue('R', 'tool')].join(' '),
    );
    expect(originRuns(built).filter((r) => r.origin)).toEqual([
      { text: 'M', origin: 'message' },
      { text: 'S', origin: 'skill' },
      { text: 'T', origin: 'template' },
      { text: 'V', origin: 'skillValues' },
      { text: 'R', origin: 'tool' },
    ]);
    expect(stripMarks(built)).toBe('M S T V R');
    // Saved before: page and extension keep their characters.
    expect(originRuns('\uE000P\uE001\uE002E\uE003')).toEqual([{ text: 'P', origin: 'page' }, { text: 'E', origin: 'extension' }]);
    // Page data with its origin, and a page cannot fake another one.
    expect(withMarkedValues(() => markPageData('x\uE00Ay', 'tool'))).toBe('\uE008xy\uE009');
  });

  it('splits marked text into runs by origin, the innermost mark winning, across calls', () => {
    const s = 'a \uE002x \uE000P\uE001 y\uE003 b'; // a page value inside an extension value
    expect(originRuns(s)).toEqual([
      { text: 'a ', origin: undefined },
      { text: 'x ', origin: 'extension' },
      { text: 'P', origin: 'page' },
      { text: ' y', origin: 'extension' },
      { text: ' b', origin: undefined },
    ]);
    const stack: ('page' | 'extension')[] = [];
    expect(originRuns('\uE000cut', stack)).toEqual([{ text: 'cut', origin: 'page' }]);
    expect(originRuns('next node', stack)).toEqual([{ text: 'next node', origin: 'page' }]); // still open
  });
});
