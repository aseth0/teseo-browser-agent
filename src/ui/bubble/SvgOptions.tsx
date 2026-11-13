import { useEffect, useRef, useState } from 'react';
import { safeSvg } from '../../widget/svg-safe';
import { fetchSvg } from '../bubble-svg-fetch';
import { useDraft } from '../useDraft';
import type { BubbleProps } from './BubbleLookOptions';

export function SvgOptions({ look, setLook }: BubbleProps) {
  const [draft, setDraft] = useDraft(look.bubbleSvg ?? '');
  const [url, setUrl] = useDraft(look.bubbleSvgUrl ?? '');
  const [said, setSaid] = useState<{ error?: string; removed?: string[] }>({});
  const [fetching, setFetching] = useState(false);
  // Which SVG is the latest asked for: a download that ends after another look was picked (or this
  // option left) is dropped.
  const asked = useRef(0);
  useEffect(() => () => void asked.current++, []);
  const keep = (check: ReturnType<typeof safeSvg>, bubbleSvgUrl: string | undefined) => {
    asked.current++;
    if ('error' in check) return setSaid({ error: check.error });
    setSaid({ removed: check.removed });
    setDraft(check.svg);
    setLook({ bubbleFace: 'svg', bubbleSvg: check.svg, bubbleSvgUrl });
  };
  const remove = () => {
    asked.current++;
    setLook({ bubbleSvg: undefined, bubbleSvgUrl: undefined });
    setDraft('');
    setSaid({});
  };
  const fetchIt = async (from: string) => {
    const ask = ++asked.current;
    setFetching(true);
    try {
      const check = await fetchSvg(from);
      if (ask === asked.current) keep(check, from.trim());
    } finally {
      setFetching(false);
    }
  };
  return (
    <>
      <label>Paste an SVG
        <textarea rows={4} value={draft} placeholder="<svg …>…</svg>" spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <div className="row">
        <button type="button" disabled={!draft.trim()} onClick={() => keep(safeSvg(draft), undefined)}>Use it</button>
      </div>
      <label>Or fetch it from a URL
        <input type="url" value={url} placeholder="https://example.com/logo.svg" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <p className="hint">Access to that site is asked for this download only.</p>
      <div className="row">
        <button type="button" disabled={!url.trim() || fetching} onClick={() => void fetchIt(url)}>Fetch</button>
      </div>
      {look.bubbleSvgUrl && (
        <div className="row">
          <span className="hint">Fetched from {look.bubbleSvgUrl}</span>
          <button type="button" disabled={fetching} onClick={() => void fetchIt(look.bubbleSvgUrl!)}>Fetch again</button>
        </div>
      )}
      {look.bubbleSvg && (
        <div className="row">
          <button type="button" onClick={remove}>Remove</button>
        </div>
      )}
      {said.error && <p className="error">{said.error}</p>}
      {!!said.removed?.length && <p className="hint">Removed: {said.removed.join(', ')}</p>}
      <label className="check">
        <input type="checkbox" checked={!!look.bubbleSvgBare} onChange={(e) => setLook({ bubbleSvgBare: e.target.checked || undefined })} />
        Without the round background
      </label>
      <p className="hint">
        Kept as a copy: the bubble never loads it from the web. Scripts, links, styles and embedded images are removed. Up to 16 KB. Parts painted
        with currentColor take the theme's color.
      </p>
    </>
  );
}
