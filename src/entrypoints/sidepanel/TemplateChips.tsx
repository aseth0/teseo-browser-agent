// Page bar chips for the site templates matching the tab: how much each one finds on the page
// (⚠ when nothing), and on click what it sends with the next message and how each variable did.
import { templatesSeenBy, type AgentProfile } from '../../agents/profiles';
import { Icon } from '../../ui/chat-icons';
import { useEffect, useMemo, useState } from 'react';
import { runPageTemplates } from '../../templates/run';
import { limitText } from '../../core/limits';
import { withMarkedValues } from '../../core/model-texts';
import { diagnosisSummary, pickView, templateDiagnosis, templateFound, templateMessage, templatesFor, type TemplateResult } from '../../templates/render';
import type { PageTemplate } from '../../templates/types';
import { useTemplates } from '../../ui/templates/useTemplates';
import { Popover } from '../../ui/Popover';
import { RawText } from '../../ui/PromptSection';
import { openOptions } from '../../ui/open-options';
import type { PageTarget } from './usePageTarget';

// `profile`: the chat's agent, whose templates only go (none: Default, all). `refresh`: changes when
// the page may have changed (e.g. after each turn). `withheld`: why what they read is not sent with
// the next message, if it is not.
export function TemplateChips({ page, profile, refresh, withheld }: { page: PageTarget; profile?: AgentProfile; refresh: unknown; withheld?: string }) {
  const templates = useTemplates();
  const active = useMemo(() => templatesFor(templatesSeenBy(profile, templates), page.url), [profile, templates, page.url]);
  const readable = page.access === 'ok' && page.tabId !== undefined;
  const [reads, setReads] = useState(0);
  // What was read applies to that page and those templates only: on another, nothing until it is read.
  const scope = useMemo(() => JSON.stringify([readable, page.tabId, page.url, active.map((t) => [t.id, t.views])]), [readable, page.tabId, page.url, active]);
  const [read, setRead] = useState<{ scope: string; results: Record<string, TemplateResult> }>();
  const results = read?.scope === scope ? read.results : null;
  // Read again (after each turn, on opening a chip): the last results stay until the new ones are in.
  useEffect(() => {
    if (!readable || !active.length) return;
    let current = true;
    runPageTemplates(page.tabId!, active, page.url).then((r) => current && setRead({ scope, results: r }), (e) => console.error('[templates]', e));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the page and `active` by their content (scope): a new list when the templates change
  }, [scope, refresh, reads]);

  if (!active.length) return null;
  return (
    <>
      {active.map((t) => (
        <TemplateChip key={t.id} template={t} url={page.url} readable={readable} withheld={withheld} result={readable ? (results?.[t.id] ?? null) : null} onOpen={() => setReads((n) => n + 1)} />
      ))}
    </>
  );
}

// The chip: the view for this page and what it found (⚠ when nothing or an error).
function TemplateChip(props: { template: PageTemplate; url: string | undefined; readable: boolean; withheld?: string; result: TemplateResult | null; onOpen: () => void }) {
  const { template, result, withheld } = props;
  const view = result ? result.view : pickView(template, props.url)?.view;
  const found = result?.view ? templateFound(result.run) : undefined;
  const empty = found === 0;
  const cut = result?.view && result.run.omittedLines > 0; // over the output limit (Settings → Limits)
  const label = (
    <>
      <Icon name={withheld ? 'withheld' : empty ? 'error' : 'template'} size={12} /> {template.name} · {view ? view.name : 'no view'}
      {found === undefined ? '' : ` · ${found}`}{cut && <> · <Icon name="cut" size={12} /></>}
    </>
  );
  const about = !view
    ? `Site template "${template.name}": no view for this page, nothing is sent. Click for details.`
    : result?.view
      ? `Site template "${template.name}", view "${view.name}": ${result.run.error ? 'has an error' : empty ? 'finds nothing on this page' : `${found} found on this page`}${cut ? `, cut to ${limitText('templateOutput')} (${result.run.omittedLines} lines left out)` : ''}. Click to see what it sends.`
      : `Site template "${template.name}", view "${view.name}", matches this page; it is sent when "Page" is on and the site is readable.`;
  const title = withheld && view ? `Not sent: ${withheld}. ${about}` : about;
  return (
    <Popover title={title} className={`chip-button${empty && !withheld ? ' warn' : ''}${view && !withheld ? '' : ' muted'}`} label={label}>
      {() => <TemplateDetails template={template} readable={props.readable} withheld={withheld} result={result} onRefresh={props.onOpen} />}
    </Popover>
  );
}

// What the template looked up on the page, folded under its summary; open when something needs a look.
function Diagnosis({ result }: { result: TemplateResult }) {
  const { line, open } = diagnosisSummary(result);
  return (
    <details className="text-block" open={open}>
      <summary><strong>Diagnosis</strong> · {line}</summary>
      <RawText text={templateDiagnosis(result)} />
    </details>
  );
}

// `result`: none while the page is being read, or when it cannot be (`readable`).
function TemplateDetails({ template, readable, withheld, result, onRefresh }: { template: PageTemplate; readable: boolean; withheld?: string; result: TemplateResult | null; onRefresh: () => void }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- on open only
  useEffect(() => onRefresh(), []); // read the page again on open: it may have loaded more
  return (
    <div className="template-details">
      <div className="row">
        <strong><Icon name="template" /> {template.name}{result?.view && ` · ${result.view.name}`}</strong>
        {result?.view?.replacePage && <span className="badge">replaces page</span>}
        <span className="spacer" />
        <button onClick={onRefresh}>Read again</button>
        <button onClick={() => void openOptions(`site-templates/${encodeURIComponent(template.id)}`)} title="Open it in Settings → Site templates">Edit</button>
      </div>
      {result ? (
        <>
          {result.view && (
            <div className="text-block"><div className="text-block-head"><strong>{withheld ? `Not sent: ${withheld}` : 'Sent with your next message'}</strong></div><RawText text={withMarkedValues(() => templateMessage(template.name, result.view.name, result.run))} /></div>
          )}
          <Diagnosis result={result} />
        </>
      ) : readable ? (
        <p className="hint">Reading the page…</p>
      ) : (
        <p className="hint">Not read: "Page" needs access to this site.</p>
      )}
    </div>
  );
}
