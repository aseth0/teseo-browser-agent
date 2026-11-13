// A conversation's title with its Markdown links as links (history/title-links). They sit inside the
// row's button, so a click on one opens its page in a new tab and does not open the conversation.
import { browser } from 'wxt/browser';
import { titleParts } from '../history/title-links';

export function TitleLinks({ title }: { title: string }) {
  return titleParts(title).map((p, i) =>
    typeof p === 'string' ? p : (
      // A real link, reached with Tab and opened with Enter as with a click.
      <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="title-link" title={p.url}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void browser.tabs.create({ url: p.url });
        }}>{p.text}</a>
    ));
}
