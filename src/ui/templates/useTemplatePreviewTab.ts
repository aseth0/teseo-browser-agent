import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { runPageTemplate } from '../../templates/run';
import { errorText } from '../../core/errors';
import type { TemplateResult } from '../../templates/render';
import type { PageTemplate } from '../../templates/types';
import { closeTab, openBackgroundTab } from '../sample-page';
import { useSettingsContext } from '../settings-context';

// The page a template is previewed on (ui/templates/TemplatePreview): opened in a background tab at
// `url` (load), the template run on it again on every change of its views or of the view chosen
// (`forced`), and the tab closed when the editor closes (or its page does).
export function useTemplatePreviewTab(template: PageTemplate, forced: string) {
  const { settings } = useSettingsContext();
  const [url, setUrl] = useState('');
  const [tabId, setTabId] = useState<number>();
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<TemplateResult | null>(null);
  const version = JSON.stringify(template.views);
  // Left before the page opened: the tab is closed as soon as it is open, since nothing else will.
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);

  useEffect(() => {
    if (tabId === undefined) return;
    const close = () => void closeTab(tabId);
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      close();
    };
  }, [tabId]);

  useEffect(() => {
    if (tabId === undefined) return;
    const view = template.views.some((v) => v.name === forced) ? forced : undefined;
    let current = true; // a late answer must not repaint after the page is closed or the template changed
    const run = async () => {
      try {
        const tab = await browser.tabs.get(tabId);
        const result = await runPageTemplate(tabId, template, tab.url, view);
        if (!current) return;
        setResult(result);
        setStatus(''); // an earlier run's error no longer applies
      } catch (e) {
        if (current) setStatus(errorText(e));
      }
    };
    const timer = setTimeout(() => void run(), 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by its views' content: the editor passes a new template object on every render
  }, [tabId, version, forced]);

  const load = async () => {
    setStatus('Opening the page in a background tab…');
    try {
      const opened = await openBackgroundTab(url.trim(), settings.webSearch);
      if (gone.current) return void closeTab(opened);
      setTabId(opened);
      setStatus('');
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const closePage = () => {
    setTabId(undefined);
    setResult(null);
  };
  return { url, setUrl, tabId, status, result, load, closePage };
}
