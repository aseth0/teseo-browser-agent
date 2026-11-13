# A bubble of actions per site (Jira, Mattermost)

## The workflow

Another version of this tool injects a bubble into the page. Hovering it unfolds actions that depend
on the site; a click runs one with the model:

- **Jira** (an incident): "Summarize this INC", "Explain it in simple words", "Find similar
  incidents".
- **Mattermost**: "Summarize this channel", "Summarize the selected text", "Give me the links
  mentioned in this channel".

## What works today

The work behind each action can be done already. Only the bubble is missing:

- **Reading the page**: the page tools read the incident or the channel; site skills on
  `*://<jira>/browse/INC-*` or `*://<mm>/*` add what to look at.
- **The selected text**: the page script reads it (`selectionText` in `src/content/extractors.ts`).
- **Similar incidents**: an HTTP custom tool on Jira's search,
  `GET /rest/api/2/search?jql=text ~ "{terms}"`, cut to `issues[].key` and `issues[].fields.summary`.
- **A channel's messages and links**: better from Mattermost's API
  (`GET /api/v4/channels/{channel_id}/posts`) than from the page, whose message list is virtualized:
  only what is on screen exists in the DOM.

Today the user writes the prompt in the side panel; the bubble would save them that.

## What it would need

These are click actions of the [page widget](page-widget.md): per URL pattern, a list of `{label, prompt}` the user writes (in a site skill's
frontmatter, which already has the pattern, or in their own Settings section). The prompts are the
user's, so they do not go to `TEXT_DEFS`.

- **The bubble in the page.** The page script is injected only when a tool needs it. The bubble needs
  a content script registered on the sites with access (`chrome.scripting.registerContentScripts`),
  in a shadow root so neither the page nor its CSS reaches it: the widget itself.
- **What a click does.** Open the side panel and send the prompt. `chrome.sidePanel.open` wants a
  user gesture; whether a click in the page, passed on through the background, counts as one in
  Vivaldi must be checked first (a snippet, as with the tab groups). If it does not: the answer in the
  bubble itself, a small chat.
- **Keeping the selection.** A click on the bubble can clear the page's selection: `preventDefault`
  on `mousedown`, or read it when the bubble is hovered.

A cheaper first step: **the browser's context menu** (`contextMenus`). Right click → "Agent ▸
Summarize this INC…", filtered by URL pattern. Nothing injected, the browser hands over the
selection, and the click is a gesture that may open the side panel. The visible bubble is lost.

## Open questions

- Does `chrome.sidePanel.open` work in Vivaldi from a click in the page?
- Where the actions live: in the site skills or in their own section?
- Answer in the side panel, or in the bubble when the panel is closed?
- The context menu first, and the bubble later?
