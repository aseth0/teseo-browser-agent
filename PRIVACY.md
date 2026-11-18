# Privacy policy

Last updated: 2026-11-09

Teseo is a browser extension that puts an AI chat next to the page you are on. This policy says what data
it handles, where that data goes, and what stays on your device. The technical details are in
[Privacy and security](docs/guide/privacy-and-security.md).

## Summary

- Teseo has **no servers of its own**. Its developer receives none of your data.
- It has **no telemetry, no analytics, no ads and no tracking**, and it does not sell or share data with anyone.
- Data leaves your browser only to the services **you set up** (your AI provider, MCP servers, your own tools)
  and the sites you ask it to read or act on.
- Everything it keeps (settings, conversations, memory, logs) stays in your browser's local storage.

## What data it handles

To do what you ask, Teseo works with:

- **Web page content**: the address, title, selected text and visible elements of the page you are on, and what
  the model reads with its tools. It reads no website until you allow it in Settings → Website access.
- **What you type and attach**: your messages, files, screenshots and, if you use them, voice dictation and a
  tab's audio that you ask it to capture.
- **Browsing information you choose to share**: the titles and addresses of your open tabs, when the model lists
  them; your bookmarks, only if you grant that optional permission.
- **Credentials you enter**: API keys for your AI providers, sign-ins to MCP servers and secrets for your own
  tools. They are used only to authenticate requests to the service they were saved for.
- **Network information, only when you use the feature**: the headers of a site's requests when you record them
  (Settings → Recording), and the names (never the values) of a site's cookies and request headers when the model
  checks a site's access.

## Where it goes

Data is sent only to:

| Destination | What | When |
|---|---|---|
| The AI providers you configure | Your messages, the page content above, attachments and audio to transcribe | Each time you chat, dictate or transcribe |
| The MCP servers you add | The arguments of their tools | When the model calls them |
| The APIs of the custom tools you create | The arguments of those tools | When they run |
| Websites | The requests you would make visiting them | When the model reads or acts on them with your permission |
| Your search engine | Your search terms | When the model searches the web |

Those services handle the data under their own privacy policies. Teseo sends nothing to its developer or
to any other third party.

## What stays on your device

Settings, conversations, memory, logs, recordings and credentials are stored in the extension's local storage in
your browser profile. Nothing is synced to a cloud account. Credentials are kept where web pages cannot read them,
but are not encrypted at rest: anyone with access to your browser profile can read them, as with the browser's own
saved data.

A web page can tell that Teseo is installed, as with most extensions: the chat it opens floating on a page is
loaded from the extension's fixed address, which any page can try. That page is the only one a web page can load,
and loaded by the page itself, framed or in a tab, it stays empty: the page can neither see nor use the chat, its
conversations or its settings. Every other page and file of Teseo is out of its reach.

## Retention and deletion

Data stays in your browser until you delete it. You can delete conversations, memory items and logs in the
extension, or remove the extension, which deletes everything it stored.

## Limited use

The use of information received from Google APIs and browser data adheres to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements. Data is used only to provide the features you use; it is not used for
advertising, not sold, not used to determine creditworthiness, and not read by humans.

## Children

Teseo is not directed to children under 13.

## Changes

Changes to this policy are published in this file, with the date above. The history is in the repository.

## Contact

Questions about this policy: open an issue in the
[repository](https://github.com/aseth0/teseo-browser-agent/issues). Security reports: see [SECURITY.md](SECURITY.md).
