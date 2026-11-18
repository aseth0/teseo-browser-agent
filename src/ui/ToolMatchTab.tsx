// Settings → Tools → Matching (tools/match): which groups of tools reach the model. All of them (the
// default, as before), all with those your message matches recommended, or only those; the match
// needed by words and by meaning, how far the tools' vectors are indexed (tools/tool-index), a message to
// try them on, and the texts the model gets.
import { useEffect, useEffectEvent, useState } from 'react';
import type { ToolInfo } from '../core/protocol';
import { toWireName } from '../core/tool-registry';
import { semanticTarget } from '../memory/semantic';
import type { Settings, ToolMatchSettings } from '../storage/settings-types';
import { alwaysGroups, decideToolMatch, serverAbouts, groupModes, matchesAny, matchGroups, matchingTools, onDemandServers, ownChoiceServers, scoreGroups, toolMatchMode, toolMatchThreshold, toolMeaningLevel, MEANING_LEVELS, MEANING_STAND_OUT, TOOL_MATCH_THRESHOLD, type MeaningLevel, type MatchGroup, type ToolMatchMode } from '../tools/match';
import { toolMeaning } from '../tools/match-meaning';
import { freshVectors, indexToolsLater, toolDocs, TOOL_INDEX_STATUS_KEY, type ToolIndexStatus } from '../tools/tool-index';
import { MEANING_FAILED_NOTICE } from '../memory/query-meaning';
import { storageGet } from '../storage/area';
import { watchKey } from '../storage/watch';
import { toolGroupLabel } from '../core/tool-groups';
import { AttachPlayground, bandOf, MatchRange } from './AutoAttachBlock';
import { DrawnChoice, OUTLINE, type DrawnOption } from './DrawnChoice';
import { ModelTextsFold } from './PageModelTexts';
import { MatchCard, MatchCards, TryBelow } from './SectionParts';
import type { SettingsPatch } from './useSettings';

const DEFAULTS = { threshold: TOOL_MATCH_THRESHOLD, max: 99, most: 99 };
const TEXTS = ['tools.recommended', 'tools.recommended_group', 'tools.load_builtin'] as const;

// Six groups of tools as blocks: all offered; all, two marked; only the two, the others dashed.
const block = (i: number) => ({ x: 8 + (i % 3) * 50, y: 10 + Math.floor(i / 3) * 28, width: 44, height: 22, rx: 3 });
const BLOCKS = [0, 1, 2, 3, 4, 5];
const MATCHING = new Set([1, 3]);
const MODES: readonly DrawnOption<ToolMatchMode>[] = [
  { id: 'all', label: 'All tools', drawing: BLOCKS.map((i) => <rect key={i} {...block(i)} opacity={0.5} />) },
  {
    id: 'recommend',
    label: 'Recommended',
    drawing: BLOCKS.map((i) => <rect key={i} {...block(i)} opacity={MATCHING.has(i) ? 1 : 0.35} />),
  },
  {
    id: 'matching',
    label: 'Only matching',
    drawing: BLOCKS.map((i) => (MATCHING.has(i) ? <rect key={i} {...block(i)} /> : <rect key={i} {...block(i)} {...OUTLINE} strokeDasharray="3 2" opacity={0.6} />)),
  },
];
const ABOUT: Record<ToolMatchMode, string> = {
  all: 'Every tool switched on is offered with every message, as before. Nothing is matched.',
  recommend: 'Every tool is still offered; the groups your message matches are named with it, for the model to prefer their tools.',
  matching: 'Only the groups your message matches are offered. The others are listed in tools.load, which the model calls to load one when the task needs it; none matching: none of them. A group offered once stays offered for the rest of the conversation.',
};

// How far the tools' vectors are indexed for the model set (worked out here, from the stored vectors), and
// what the last indexing run said (running, its error); `start` runs one in this page.
function useToolIndex(settings: Settings, groups: MatchGroup[]) {
  const [counted, setCounted] = useState<{ indexed: number; total: number }>();
  const [last, setLast] = useState<ToolIndexStatus>();
  const target = semanticTarget(settings);
  const key = JSON.stringify([target && [target.provider.id, target.model, target.semantic.documentPrefix], groups.map((g) => [g.id, g.tools])]);
  const count = useEffectEvent(async () => {
    if (!target) return setCounted(undefined);
    const docs = await toolDocs(groups, target);
    setCounted({ indexed: (await freshVectors(docs, target)).size, total: docs.length });
  });
  useEffect(() => {
    void count().catch(() => setCounted(undefined));
    void storageGet<ToolIndexStatus>('local', TOOL_INDEX_STATUS_KEY).then(setLast);
    return watchKey('local', TOOL_INDEX_STATUS_KEY, (c) => {
      setLast(c.newValue as ToolIndexStatus | undefined);
      void count().catch(() => undefined);
    });
  }, [key]);
  return { counted, running: !!last?.running, error: last?.error, start: () => indexToolsLater(settings, groups) };
}

const LEVEL_NAMES: Record<MeaningLevel, string> = { 'offer-more': 'Offer more', balanced: 'Balanced', 'hold-more': 'Hold more' };
const LEVEL_ABOUT: Record<MeaningLevel, string> = {
  'offer-more': `Only matching offers the groups within ${MEANING_LEVELS['offer-more']} spreads of the closest tool (the default): it rarely holds the one you need.`,
  balanced: `Within ${MEANING_LEVELS.balanced} spread: fewer groups offered; now and then the model has to load the one it needs (tools.load).`,
  'hold-more': `Within ${MEANING_LEVELS['hold-more']} spread: the fewest offered, the most tokens saved; more often the model loads the one it needs first.`,
};
const MODE_BADGE: Record<ToolMatchMode, string> = { all: 'always offered', recommend: 'recommended when it matches', matching: 'only when it matches' };

export function ToolMatchTab({ tools, settings, onChange }: { tools: ToolInfo[]; settings: Settings; onChange: SettingsPatch }) {
  const mode = toolMatchMode(settings);
  const threshold = toolMatchThreshold(settings);
  const level = toolMeaningLevel(settings);
  // The cosine (%) a group needed by meaning for the message tried last (relative: tools/match meaningCuts).
  const [lastCut, setLastCut] = useState<number>();
  const set = (change: ToolMatchSettings) => onChange({ tools: { ...settings.tools, match: { ...settings.tools?.match, ...change } } });
  const disabled = new Set(settings.disabledTools ?? []);
  const offered = tools.filter((t) => !disabled.has(t.name));
  // Those this setting decides: not a server on demand or with a choice of its own (Settings → MCP servers).
  const own = ownChoiceServers(settings);
  const onDemand = onDemandServers(settings);
  const apart = new Set([...onDemand, ...own]);
  const groups = matchGroups(offered, apart);
  const always = alwaysGroups(offered, groups).filter((id) => !apart.has(id));
  // Tried below, and indexed: every group that can be matched, a server with a choice of its own too.
  const about = serverAbouts(settings);
  const tried = matchGroups(offered, onDemand, { about });
  const modeOf = groupModes(settings);
  const semantic = semanticTarget(settings);
  const index = useToolIndex(settings, matchGroups(offered, onDemand, { every: true, about }));
  const missing = index.counted ? index.counted.total - index.counted.indexed : 0;
  // Opened with tools to index while something is matched: indexed at once, as a message would start it.
  const startOnce = useEffectEvent(() => index.start());
  useEffect(() => {
    if (semantic && matchesAny(settings) && missing > 0 && !index.running && !index.error) startOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once the count is known
  }, [missing > 0, !!semantic]);
  // As a message would be decided (tools/match decideToolMatch), against every tool offered; the groups at
  // All tools are shown as if matched, to see how they would do.
  const reference = matchGroups(offered, onDemand, { every: true, about });
  const resultsWith = (query: string, meaning?: Awaited<ReturnType<typeof toolMeaning>>['meaning'], failed?: boolean) => {
    const asIf = (id: string) => (modeOf(id) === 'recommend' ? 'recommend' : 'matching');
    const decided = decideToolMatch({ mode, modeOf: asIf, threshold, typed: query, groups: tried, always: [], history: [], mentioned: [], meaning, reference });
    const byId = new Map(scoreGroups(query, tried, meaning).map((r) => [r.group.id, r]));
    const hits = decided.groups.map((g) => {
      const r = byId.get(g.id)!;
      const first = matchingTools(r, meaning);
      return {
        id: g.id,
        match: r.match,
        ...(r.meaning !== undefined && { meaning: r.meaning }),
        title: g.label,
        badges: <span className="badge" title="Settings → Tools → Matching, or the server's own choice">{MODE_BADGE[modeOf(g.id)]}</span>,
        // The tools that match first, in bold, best first: the group goes by the best one.
        detail: <p className="tool-names">{[...first, ...r.group.tools.filter((n) => !first.includes(n))].map((n) => <code key={n}>{first.includes(n) ? <strong>{toWireName(n)}</strong> : toWireName(n)}</code>)}</p>,
      };
    });
    const order = (id: string) => (decided.groups.find((g) => g.id === id)?.outcome === 'matched' ? 0 : 1);
    hits.sort((a, b) => order(a.id) - order(b.id) || Math.max(b.match, b.meaning ?? 0) - Math.max(a.match, a.meaning ?? 0));
    const needed = [
      decided.wordsNeeded && `by words ${decided.wordsNeeded.matching}% for Only matching, ${decided.wordsNeeded.recommend}% to be recommended`,
      decided.meaningNeeded && `by meaning ${decided.meaningNeeded.matching}% for Only matching, ${decided.meaningNeeded.recommend}% to be recommended`,
    ].filter(Boolean);
    const note = [
      failed ? MEANING_FAILED_NOTICE : !meaning && semantic ? '' : !meaning ? 'By words only (no embeddings model):' : '',
      decided.unsure ? 'Nothing stands out for this message: Only matching would offer its groups, and nothing would be recommended.'
        : needed.length ? `For this message, a group needs ${needed.join('; or ')}.` : '',
    ].filter(Boolean).join(' ');
    return { hits, picked: decided.groups.filter((g) => g.outcome === 'matched' && modeOf(g.id) !== 'all').map((g) => g.id), note: note || undefined };
  };
  const search = async (query: string) => resultsWith(query);
  const refine = async (query: string) => {
    const { meaning, failed } = await toolMeaning(settings, query, reference);
    setLastCut(meaning?.cut ? Math.round(meaning.cut.matching * 100) : undefined);
    return resultsWith(query, meaning, failed);
  };
  return (
    <>
      <DrawnChoice legend="Which tools reach the model" name="tool-match-mode" viewBox="0 0 160 70" options={MODES} value={mode} onChange={(id) => set({ mode: id === 'all' ? undefined : id })} />
      <p className="hint">{ABOUT[mode]}</p>
      <MatchCards>
        <MatchCard title="Match needed" off={!matchesAny(settings)} value={<>{threshold}% <span className="match-card-unit">{bandOf(threshold).name}</span></>}
          about={<>How much of your message the group's best tool covers: the group's name, the tool's name and its description, the rare words weighing
            more, and your words that no tool has counting half against it. A tool covers few of a message's words, so it starts lower than memory's
            ({TOOL_MATCH_THRESHOLD}%).</>}>
          <div className="auto-attach-fields">
            <MatchRange threshold={threshold} label="Tool groups: match needed" onChange={(c) => set({ threshold: c.threshold })} />
          </div>
        </MatchCard>
        <MatchCard title="By meaning" off={!matchesAny(settings) || !semantic} value={semantic ? LEVEL_NAMES[level] : 'Off'}
          about={<>With the embeddings model of <a href="#memory">Memory → Semantic search</a>, relative to all the tools: the tool closest to your message
            must stand out from the others ({MEANING_STAND_OUT} spreads), then the groups whose closest tool is near it pass: how near, the level below
            (fewer to be recommended). Nothing stands out: Only matching offers its groups rather than hold them. A group passes by its words or by
            its meaning.</>}>
          <div className="match-bands" role="group" aria-label="How many groups Only matching holds by meaning">
            {(Object.keys(MEANING_LEVELS) as MeaningLevel[]).map((l) => (
              <button key={l} type="button" className={l === level ? 'on' : undefined} disabled={!semantic} title={LEVEL_ABOUT[l]}
                onClick={() => set({ level: l === 'offer-more' ? undefined : l, meaningLevel: undefined })}>{LEVEL_NAMES[l]}</button>
            ))}
          </div>
          <p className="hint">{LEVEL_ABOUT[level]}</p>
          {semantic ? (
            <div className="tool-index" aria-label="Tools indexed">
              <p className="muted small">
                {index.counted ? `${index.counted.indexed} of ${index.counted.total} tools indexed` : 'Counting the tools indexed…'}
                {index.running ? ' · indexing…' : ''}
              </p>
              {index.counted && index.counted.total > 0 && <progress max={index.counted.total} value={index.counted.indexed} />}
              {index.error && <p className="error-text">Couldn't index: {index.error}</p>}
              <button disabled={index.running || !missing} onClick={() => index.start()}>Index now</button>
              <p className="hint">A tool not indexed yet matches by words only. Its name and description go to the provider once, and again when they change.</p>
            </div>
          ) : (
            <p className="hint">
              Off: matching goes by words only. It works when your messages share words with the tools' names and descriptions (often in English);
              in another language they share none, so nothing stands out: Only matching then offers its groups rather than hold them, and
              nothing is recommended. Switch on Semantic search in Memory, with an embeddings model, to match by meaning, in any language.
            </p>
          )}
        </MatchCard>
      </MatchCards>
      <div className="section-subhead"><h4>Matched</h4><span className="hint">{groups.length} groups</span></div>
      <p className="hint">
        Web, history, bookmarks, each section of your custom tools (those without one together) and each MCP server set to <em>Same as Tools → Matching</em> (in{' '}
        <a href="#mcp">MCP servers</a>, each server can have a choice of its own: always offered, recommended or only when it matches, or on demand).
      </p>
      <p className="tool-names">{groups.map((g) => <code key={g.id}>{g.label}</code>)}</p>
      {own.size > 0 && <p className="hint">With a choice of their own in <a href="#mcp">MCP servers</a>, whatever is set here: {[...own].map(toolGroupLabel).join(', ')}.</p>}
      <div className="section-subhead"><h4>Always offered</h4></div>
      <p className="hint">
        What the system prompt or the loop relies on, and the page's own tools: {always.map(toolGroupLabel).join(', ') || 'none'}. Also tools.load,
        tools.read_more, the tools that manage custom tools and page actions, and a tool your message mentions ($tool).
      </p>
      <TryBelow>
        <AttachPlayground auto={{ enabled: matchesAny(settings), threshold }} defaults={DEFAULTS} nouns={['group', 'groups']} searchLabel="Try a message against the tool groups"
          search={search} refine={semantic ? refine : undefined} meaningThreshold={semantic ? (lastCut ?? 100) : undefined}
          refresh={JSON.stringify([tried.map((g) => g.id), threshold, level, mode, [...own], index.counted?.indexed])}
          hint={semantic && missing ? `${missing} tools not indexed yet: they match by words only.` : undefined}
          summary={(count) =>
            !matchesAny(settings) ? 'All tools: every group is offered, nothing is matched.'
            : `This message would match ${count || 'no'} ${count === 1 ? 'group' : 'groups'}: recommended or offered as each says, besides those always offered and those offered earlier in the conversation.`} />
      </TryBelow>
      {matchesAny(settings) && <ModelTextsFold ids={TEXTS} id="tool-match-texts" when="each when its tag says" hint="What the model gets: the recommendation with your message, and a group's line in tools.load." />}
    </>
  );
}
