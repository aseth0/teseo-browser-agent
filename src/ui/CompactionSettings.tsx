// Settings → Compaction (context/compaction): when the earlier turns of a conversation are compacted,
// the steps that compact them (what is left out, the model that summarizes them when that is not
// enough); what the later requests of a turn leave out (context/in-run); and what is not sent again
// while the model still sees it (context/dedupe). Laid out as the RAG sections: its main switch at the
// top, figures, and tabs. Every setting here saves context, so none carries the "ctx" chip.
import { type ReactNode } from 'react';
import { useLive } from './useLive';
import { useAttempt } from './useAttempt';
import { compactionOf } from '../context/compaction';
import { dedupeOf } from '../context/dedupe';
import { IN_RUN_RANGES, inRunOf } from '../context/in-run';
import { forgetTokenRatio, onTokenRatios, tokenRatios } from '../context/token-ratio';
import { forgetContextWindow, learnedContextWindows, onLearnedContextWindows } from '../context/window';
import type { CompactionParts } from '../core/compaction-parts';
import type { CompactionSettings, DedupeSettings, InRunSettings } from '../storage/settings-types';
import { Switch } from './Collection';
import { ModelIdInput } from './fields';
import { ModelTextEditor } from './EditableText';
import { PageModelTexts } from './PageModelTexts';
import { NumberField } from './NumberField';
import { MatchCard, MatchCards, NumberedStep, SectionHead, SectionTabs, StatStrip } from './SectionParts';
import { SectionTop } from './SectionTop';
import type { PatchSectionProps as Props } from './useSettings';

const PARTS: [keyof CompactionParts, string, string?][] = [
  ['pages', 'Page blocks', 'The page, site templates, page values, mentions'],
  ['toolResults', 'Tool results', 'Longer than a few lines'],
  ['screenshots', 'Screenshots'],
  ['replies', 'Long replies of the model', 'Their first 1,000 characters kept'],
  ['toolArgs', 'Long arguments of tool calls'],
  ['attached', 'Site skills and memory attached earlier', 'They go again with your next message while they still apply'],
];

const DEDUPE: [keyof DedupeSettings, string, ReactNode][] = [
  ['page', 'The page block', 'When the page is the same: same address, same content'],
  ['siteValues', 'Site templates and site skill values', <>The output of each site template (also <code>::site</code> mentions) and the values of each site skill</>],
  ['mentions', 'Mentions', <><code>#conversation</code>, <code>b::bookmark</code> and <code>/skill</code>, when the same content was attached earlier</>],
  ['attachments', 'Attachments', 'Files and recordings you attach, and your images, when the same was attached earlier'],
];

const fmt = (n: number) => n.toLocaleString('en-US');

// The compaction settings as stored, with their defaults, and a change to them.
function compactionOps({ settings, onChange }: Props) {
  const stored = settings.compaction ?? {};
  return { stored, cfg: compactionOf(stored), set: (change: Partial<CompactionSettings>) => onChange({ compaction: { ...stored, ...change } }) };
}

export function CompactionSection({ settings, onChange }: Props) {
  const { stored, cfg, set } = compactionOps({ settings, onChange });
  const inRun = inRunOf(stored.inRun);
  const dedupe = dedupeOf(settings.context?.dedupe ?? {});
  // Everything here that saves context, switched on: what is left out, the summary, a turn's steps, what is not sent again.
  const savers = [...Object.values(cfg.trim), cfg.summarize, inRun.enabled, inRun.lastScreenshot, inRun.lastElements, ...DEDUPE.map(([k]) => dedupe[k])];
  return (
    <section className="compaction-settings">
      <SectionHead title="Compaction" about="How a long conversation goes to the model shorter. The chat and the saved conversation always keep every turn whole."
        toggle={{ label: 'Compact on its own', on: cfg.auto, title: 'Before a message, once the context reaches the threshold. Off: only Compact now, in the context meter, compacts.', onChange: (auto) => set({ auto }) }} />
      <StatStrip stats={[
        { label: 'Compacts at', value: <>{cfg.threshold}% <span className="stat-of">of the window</span></>,
          sub: cfg.defaultWindow ? `${fmt(cfg.defaultWindow)} tokens when the model's is unknown` : 'Never when the model\'s window is unknown' },
        { label: 'Kept whole', value: <>{cfg.keepTurns} <span className="stat-of">latest {cfg.keepTurns === 1 ? 'turn' : 'turns'}</span></>, sub: 'The earlier ones go compacted' },
        { label: 'Summary', value: <span className="stat-text">{cfg.summarize ? `On · ${summarizerName(settings, stored)}` : 'Off'}</span>, sub: cfg.summarize ? `${fmt(cfg.maxWords)} words at most` : undefined },
        { label: 'Context savers on', value: <>{savers.filter(Boolean).length} <span className="stat-of">/ {savers.length}</span></>, sub: 'Earlier turns, a turn\'s steps, what is not sent again' },
      ]} />
      <SectionTabs label="Compaction" tabs={[
        { id: 'when', label: 'When', render: () => <WhenTab settings={settings} onChange={onChange} /> },
        { id: 'earlier', label: 'Earlier turns', render: () => <EarlierTurnsTab settings={settings} onChange={onChange} /> },
        { id: 'turn', label: 'During a turn', render: () => <DuringTurnTab settings={settings} onChange={onChange} /> },
        { id: 'dedupe', label: "Don't resend", render: () => <DedupeTab settings={settings} onChange={onChange} /> },
        { id: 'learned', label: 'Learned', render: () => <LearnedTab settings={settings} /> },
        { id: 'texts', label: 'Limits and texts', render: () => <><SectionTop page="compaction" /><PageModelTexts page="compaction" skip={['compaction.summary_request']} /></> },
      ]} />
    </section>
  );
}

// The model that summarizes, as the figure names it.
function summarizerName(settings: Props['settings'], stored: CompactionSettings): string {
  const provider = stored.providerId && settings.providers.find((p) => p.id === stored.providerId);
  return provider && stored.model ? `${stored.model} (${provider.name})` : "the chat's model";
}

// Settings → Compaction → When: the threshold, the turns kept whole and the window counted on when the
// model's is unknown, each on a card.
function WhenTab({ settings, onChange }: Props) {
  const { stored, cfg, set } = compactionOps({ settings, onChange });
  return (
    <>
      <MatchCards>
        <MatchCard title="Threshold" about="How full the context window gets before a message compacts it" off={!cfg.auto}
          value={<>{cfg.threshold}% <span className="match-card-unit">of the window</span></>}>
          <input type="range" min={30} max={99} value={cfg.threshold} aria-label="Threshold, % of the context window" disabled={!cfg.auto}
            onChange={(e) => set({ threshold: Number(e.target.value) })} />
          <p className="hint">Lower it for a model that gets worse long before its window is full.</p>
        </MatchCard>
        <MatchCard title="Latest turns kept whole" about="At most: compacting can keep fewer, down to one"
          value={<>{cfg.keepTurns} <span className="match-card-unit">{cfg.keepTurns === 1 ? 'turn' : 'turns'}</span></>}>
          <input type="range" min={1} max={50} value={cfg.keepTurns} aria-label="Latest turns kept whole, at most"
            onChange={(e) => set({ keepTurns: Number(e.target.value) })} />
          <p className="hint">More keeps the recent work intact, and compacts sooner.</p>
        </MatchCard>
        <MatchCard title="Window if unknown" about="When the server publishes none and the context meter sets none" off={!cfg.auto}
          value={<>{fmt(cfg.defaultWindow)} <span className="match-card-unit">tokens</span></>}>
          <NumberField className="narrow-input" min={0} max={10000000} value={stored.defaultWindow} placeholder={String(cfg.defaultWindow)}
            label="Window when the model's is unknown (tokens)" disabled={!cfg.auto} onSave={(defaultWindow) => set({ defaultWindow })} />
          <p className="hint">0: such models never compact on their own.</p>
        </MatchCard>
      </MatchCards>
      <p className="hint">The context meter says where a model's window comes from, and sets it. <strong>Compact now</strong> is there too.</p>
    </>
  );
}


// Settings → Compaction → Earlier turns: the steps that compact the turns before the latest ones, in
// their order, until the context is under half the threshold.
function EarlierTurnsTab({ settings, onChange }: Props) {
  const { stored, cfg, set } = compactionOps({ settings, onChange });
  return (
    <>
      <p className="hint">The turns before the latest ones are compacted step by step, until the context is under half the threshold.</p>
      <ol className="numbered-steps">
        <NumberedStep n={1} title="Leave out" about="Untick what the model should keep seeing: the replies, say, when you often refer back to an earlier answer.">
          <div className="compaction-parts">
            {PARTS.map(([part, label, about]) => (
              <label key={part} className="check">
                <input type="checkbox" checked={cfg.trim[part]} onChange={(e) => set({ trim: { ...stored.trim, [part]: e.target.checked } })} />
                <span>{label}{about && <small>{about}</small>}</span>
              </label>
            ))}
          </div>
        </NumberedStep>
        <NumberedStep n={2} title="Summarize" about="By a model, when leaving those out still leaves the context over half the threshold."
          toggle={<Switch checked={cfg.summarize} label="Summarize the earlier turns" onChange={(summarize) => set({ summarize })} />}>
          <div className="row">
            <label><span className="field-label">Model that summarizes</span>
              <select value={stored.providerId ?? ''} disabled={!cfg.summarize} onChange={(e) => set({ providerId: e.target.value || undefined, ...(!e.target.value && { model: undefined }) })}>
                <option value="">The chat's</option>
                {settings.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {stored.providerId && (
              <label><span className="field-label">Model</span>
                <ModelIdInput provider={settings.providers.find((p) => p.id === stored.providerId)} value={stored.model ?? ''} placeholder="its id, e.g. a small, cheap one" disabled={!cfg.summarize} onChange={(e) => set({ model: e.target.value.trim() || undefined })} />
              </label>
            )}
            <label><span className="field-label">At most, words</span>
              <NumberField className="narrow-input" label="At most, words" min={50} max={3000} value={stored.maxWords} placeholder={String(cfg.maxWords)}
                disabled={!cfg.summarize} onSave={(maxWords) => set({ maxWords })} />
            </label>
          </div>
          {stored.providerId && !stored.model && <p className="error-text">Choose the model too, or the chat's is used.</p>}
          <ModelTextEditor id="compaction.summary_request" />
        </NumberedStep>
        <NumberedStep n={3} title="Fewer turns kept whole" about="Down to one." fixed />
        <NumberedStep n={4} title="Trim the last turn" about="All but its latest messages." fixed />
      </ol>
      <p className="hint">
        A line in the chat shows where it was compacted, and how far it got. A plan with steps left, unless you closed it, still goes to the
        model after a compaction.
      </p>
    </>
  );
}

// Settings → Compaction → During a turn (context/in-run): what the later requests of one turn leave out.
function DuringTurnTab({ settings, onChange }: Props) {
  const { stored, set } = compactionOps({ settings, onChange });
  const inRunStored = stored.inRun ?? {};
  const inRun = inRunOf(stored.inRun);
  const setInRun = (change: Partial<InRunSettings>) => set({ inRun: { ...inRunStored, ...change } });
  const off = !inRun.enabled;
  return (
    <>
      <p className="hint">In one turn the model calls tools again and again, and each request carries everything before it.</p>
      <MatchCards>
        <MatchCard title="Latest results sent whole" about="An earlier one goes as a note saying the tool can be called again" off={off}
          toggle={{ on: inRun.enabled, label: 'Leave out what the model read earlier in the turn', title: 'Leave out what the model read earlier in the turn', onChange: (enabled) => setInRun({ enabled }) }}
          value={<>{inRun.keepResults} <span className="match-card-unit">{inRun.keepResults === 1 ? 'result' : 'results'}</span></>}>
          <input type="range" min={IN_RUN_RANGES.keepResults[0]} max={IN_RUN_RANGES.keepResults[1]} value={inRun.keepResults} aria-label="Latest tool results sent whole"
            disabled={off} onChange={(e) => setInRun({ keepResults: Number(e.target.value) })} />
        </MatchCard>
        <MatchCard title="Short ones always whole" about="Earlier results up to this size are never left out" off={off}
          value={<>{fmt(inRun.minChars)} <span className="match-card-unit">characters</span></>}>
          <NumberField className="narrow-input" min={IN_RUN_RANGES.minChars[0]} max={IN_RUN_RANGES.minChars[1]} value={inRunStored.minChars}
            placeholder={String(inRun.minChars)} label="Earlier ones sent whole up to, characters" disabled={off}
            onSave={(minChars) => setInRun({ minChars })} />
        </MatchCard>
      </MatchCards>
      <div className="settings-block">
        <label className="check">
          <input type="checkbox" checked={inRun.lastScreenshot} disabled={off} onChange={(e) => setInRun({ lastScreenshot: e.target.checked })} />
          Only the latest screenshot
        </label>
        <label className="check">
          <input type="checkbox" checked={inRun.lastElements} disabled={off} onChange={(e) => setInRun({ lastElements: e.target.checked })} />
          Only the latest page elements after an action (click, type, navigate…)
        </label>
      </div>
    </>
  );
}

// Settings → Compaction → Don't resend (context/dedupe): what goes as a note to its earlier copy when unchanged.
function DedupeTab({ settings, onChange }: Props) {
  const stored = settings.context?.dedupe ?? {};
  const cfg = dedupeOf(stored);
  const set = (change: Partial<DedupeSettings>) => onChange({ context: { ...settings.context, dedupe: { ...stored, ...change } } });
  return (
    <>
      <p className="hint">
        What goes with your message the same as before goes as a short note pointing to the earlier copy, while the model still sees that
        copy whole. Once compaction trimmed or summarized it, the content goes whole again.
      </p>
      <ul className="switch-rows" aria-label="Sent as a note when unchanged">
        {DEDUPE.map(([key, label, about]) => (
          <li key={key}>
            <div><strong>{label}</strong><span className="hint">{about}</span></div>
            <Switch checked={cfg[key]} label={label} onChange={(on) => set({ [key]: on })} />
          </li>
        ))}
      </ul>
    </>
  );
}

// Settings → Compaction → Learned: per model, the window learned from a server that refused a request as
// too long (context/window) and how far the estimates are from what its server reports
// (context/token-ratio), each to forget: a stale window, say, which wins over the server's.
const NONE_LEARNED: Record<string, number> = {};
function LearnedTab({ settings }: Pick<Props, 'settings'>) {
  const windows = useLive(learnedContextWindows, onLearnedContextWindows, NONE_LEARNED, '[learned windows]');
  const ratios = useLive(tokenRatios, onTokenRatios, NONE_LEARNED, '[token ratios]');
  const { failed, attempt } = useAttempt();
  const keys = [...new Set([...Object.keys(windows), ...Object.keys(ratios)])].sort();
  // A model's key is "provider id|model": shown with the provider's name.
  const nameOf = (key: string) => {
    const at = key.indexOf('|');
    const provider = settings.providers.find((p) => p.id === key.slice(0, at));
    return `${key.slice(at + 1)} · ${provider?.name ?? key.slice(0, at)}`;
  };
  if (!keys.length) return <p className="hint">Nothing learned yet: no model has been refused a request as too long, nor reported its usage.</p>;
  return (
    <>
      <p className="hint">A learned window wins over the one the server publishes; one smaller than what a later call took is forgotten on its own. The correction multiplies every estimate for the model (×0.5 to ×2.5).</p>
      <table className="context-table learned-table">
        <thead><tr><th>Model</th><th>Learned window</th><th>Estimate correction</th></tr></thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <td>{nameOf(key)}</td>
              <td>{windows[key] !== undefined ? <>{fmt(windows[key])} tokens <button className="link-button" onClick={() => attempt(forgetContextWindow(key))}>Forget</button></> : '—'}</td>
              <td>{ratios[key] !== undefined ? <>×{ratios[key].toFixed(2)} <button className="link-button" onClick={() => attempt(forgetTokenRatio(key))}>Forget</button></> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {failed && <p className="error-text" role="alert">{failed}</p>}
    </>
  );
}
