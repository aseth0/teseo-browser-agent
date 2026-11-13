# Web search

The model can search the web and read pages without touching your tabs.

| Tool | What it does |
|---|---|
| `web.search` | Searches and lists title, URL and snippet of each result |
| `web.read` | Reads a URL as Markdown in a muted background tab, never focused, closed afterwards |
| `web.show_user` | Opens a URL in a new tab in front of you, without reading it |

The first time the model reads a website, you are asked to allow it, as for any site. `web.read` then goes by that
site's policy, like an action: a card under **Ask before acting**, refused under **Read only**.
A page that redirects to another site (or from `https` to `http`) is read as a call of its own, under the policy
and access of the site it went to; one that redirects again to yet another site is not read.

## Settings → Web search

Three figures say which **Search engine** is used, how many **Results** a search returns (and whether each is asked
first), and how the **Background tabs** open. The tabs **Search** and **Background tabs** hold the settings below;
**Limits** sets **Page text** (7,000 characters), what `web.read` reads when the model asks for no size: the same
value as in [Limits](limits.md).

- **Search engine**: the browser's own (the default), DuckDuckGo, DuckDuckGo HTML, Bing, Google, or another search
  URL with `%s` for the query. DuckDuckGo, Bing and Google are read with built-in
  [site templates](site-templates.md); any other engine gives the model the text of its results page. A captcha or
  block page is detected and reported.
- **Results per search**: 5 by default, at most 10.
- **Ask before each search**: off by default. The query is sent to the search engine, so turn it on to see each
  query first.
- **Background tabs**, where `web.search` and `web.read`, site mentions and template previews open their pages:
  - **Muted** (on), so a video page does not play aloud while it is read;
  - **In a tab group, folded** (on), with its **Group title** (*Agent* by default) and **Color** (grey by default).
    Vivaldi does not show extension tab groups: there the tabs open next to yours for a few seconds.

Searches run in the browser like yours: they appear in your history, with your session on the search engine.
