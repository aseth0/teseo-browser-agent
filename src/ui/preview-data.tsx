// Example data shared by the "Preview single call" and "Preview conversation" tabs: your
// messages and the page (invented, or a real URL read in a background tab).
import { useState } from 'react';
import { formatPageContext, type PageSnapshot } from '../context/page-context';
import type { SiteContext } from '../context/site-context';
import { PAGE_SOURCE } from '../context/sources';
import { limit } from '../core/limits';
import type { ContextItem } from '../core/messages';
import { actionNote, markValue, text, type Origin } from '../core/model-texts';
import type { Message } from '../core/types';
import { siteSkillsFor, siteSkillValueItems, skillVariables } from '../skills/prompt';
import { NOT_RUN, pickView, templateItems, templatesFor, urlPath, type TemplateResult } from '../templates/render';
import type { PageTemplate } from '../templates/types';
import { useTemplates } from './templates/useTemplates';
import { capturePage, SAMPLE_FOLLOW_UP, SAMPLE_MESSAGE, SAMPLE_PAGE } from './sample-page';
import { useSkills } from './Skills';
import { errorText } from '../core/errors';
import { useSettingsContext } from './settings-context';

export interface PreviewData {
  message: string;
  setMessage: (m: string) => void;
  followUp: string;
  setFollowUp: (m: string) => void;
  page: PageSnapshot;
  values: Record<string, string> | null; // site skill variables read from the loaded page; null on the invented one
  results: Record<string, TemplateResult> | null; // page templates run on the loaded page, by id; null on the invented one
  url: string;
  setUrl: (u: string) => void;
  status: string;
  load: () => Promise<void>;
  reset: () => void;
}

export function usePreviewData(): PreviewData {
  const { settings } = useSettingsContext();
  const skills = useSkills();
  const templates = useTemplates();
  const [message, setMessage] = useState(SAMPLE_MESSAGE);
  const [followUp, setFollowUp] = useState(SAMPLE_FOLLOW_UP);
  const [url, setUrl] = useState('');
  const [page, setPage] = useState<PageSnapshot>(SAMPLE_PAGE);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [results, setResults] = useState<Record<string, TemplateResult> | null>(null);
  const [status, setStatus] = useState('');

  const load = async () => {
    setStatus('Reading the page in a background tab…');
    try {
      const target = url.trim();
      const read = await capturePage(target, skillVariables(siteSkillsFor(skills, target)), templatesFor(templates, target), settings.webSearch);
      setPage(read.page);
      setValues(read.values);
      setResults(read.results);
      setStatus('');
    } catch (e) {
      setStatus(errorText(e));
    }
  };
  const reset = () => {
    setPage(SAMPLE_PAGE);
    setValues(null);
    setResults(null);
    setUrl('');
  };
  return { message, setMessage, followUp, setFollowUp, page, values, results, url, setUrl, status, load, reset };
}

export function PreviewInputs({ data, followUp }: { data: PreviewData; followUp?: boolean }) {
  return (
    <>
      <label>{followUp ? 'Your first message' : 'Your message'}<input value={data.message} onChange={(e) => data.setMessage(e.target.value)} /></label>
      {followUp && <label>Your second message<input value={data.followUp} onChange={(e) => data.setFollowUp(e.target.value)} /></label>}
      <label>Page
        <div className="row">
          <input type="url" placeholder="https://… (empty: an invented shop page)" value={data.url} onChange={(e) => data.setUrl(e.target.value)} />
          <button disabled={!data.url.trim()} onClick={data.load}>Load</button>
          {data.page !== SAMPLE_PAGE && <button onClick={data.reset}>Use example</button>}
        </div>
      </label>
      {data.status && <p className="hint">{data.status}</p>}
      <p className="hint">Loading a URL asks for permission to read that site, opens it in a background tab and closes it.</p>
    </>
  );
}

export const isSamplePage = (page: PageSnapshot) => page === SAMPLE_PAGE;

// The page part of a user message as the background builds it: the values of the site skills,
// the page templates and the page block. Values and template outputs are read from the loaded
// page, or an example on the invented one (marked as page content). `site`: what goes for the page
// (context/site-context). `page`: the page fields, marked.
export function previewPageItems(site: SiteContext, data: PreviewData, page: PageSnapshot): ContextItem[] {
  const valueOf = (v: string) => markValue(data.values ? (data.values[v] ?? '') : '(value from the page)', 'skillValues');
  const active = site.templates;
  const fromTemplates = templateItems(active, data.results ?? Object.fromEntries(active.map((t) => [t.id, exampleResult(t, data.page.url)])));
  return [...siteSkillValueItems(site.skills, valueOf), ...fromTemplates.items, { kind: 'page', text: formatPageContext(page, limit('pageBudget'), fromTemplates.replacedBy), source: PAGE_SOURCE }];
}

// On the invented page: the view for its URL, with an example output.
function exampleResult(t: PageTemplate, url: string): TemplateResult {
  const picked = pickView(t, url);
  if (!picked) return { path: urlPath(url) };
  return { ...picked, run: { ...NOT_RUN, output: markValue('(the view output, read from the page)', 'template'), found: 1 } };
}

// The page fields marked as taken from the page (only inside withMarkedValues).
export const markedPage = (page: PageSnapshot, origin: Origin = 'page') =>
  Object.fromEntries(Object.entries(page).map(([k, v]) => [k, markValue(v, origin)])) as unknown as PageSnapshot;

// The sample's click (browser.click) as its reply comes back: the page as that reply shows it.
export const clickReply = (page: PageSnapshot) => {
  const after = markedPage(page, 'tool');
  return text('result.after_action', { action_note: actionNote({ kind: 'click' }), url: after.url, title: after.title, visible_elements: after.snapshot });
};

// A message you typed, marked as yours.
export const typedMessage = (typed: string): Message => ({ role: 'user', parts: [{ type: 'text', text: markValue(typed, 'message') }] });
