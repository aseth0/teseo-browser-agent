# Acting on pages

The model reads and acts on pages through **browser tools**. Reading is free on the page you are on; anything
that changes something, or touches another tab, goes by the site's policy.

## The browser tools

The model sees each tool with its dots turned into `__` (`browser.click` → `browser__click`).

**Reading** (no confirmation on the chat's own tab):

| Tool | What it does |
|---|---|
| `browser.read_page` | The page's elements with their refs (`[ref_k3x_12]`), all of it or one area |
| `browser.get_page_text` | The main text as Markdown |
| `browser.find` | Elements whose role, name or text contain every word of a query, whatever its case and accents |
| `browser.find_in_dom` | Elements matching a CSS selector, also in open shadow roots and same-origin frames |
| `browser.get_html` | Cleaned HTML of a part of the page |
| `browser.get_structured_data` | JSON-LD, OpenGraph and the meta description |
| `browser.screenshot` | A picture of the visible part of the tab |
| `browser.wait_for` | Waits until an element appears or goes, or an area stops changing |
| `browser.list_tabs` | Open tabs of the chat's window, or of every window (installed apps' too) |
| `browser.scroll` | Scrolls the page or an element |
| `browser.site_access` | A site's cookie names and the API requests its pages send (never their values) |
| `browser.watch` / `unwatch` | Watches a tab in the background and tells you when a condition is met |

**Acting** (confirmed according to the site's policy):

| Tool | What it does |
|---|---|
| `browser.click` | Clicks an element by its ref |
| `browser.type` | Types into a field (replacing its value, or adding to it), optionally pressing Enter |
| `browser.select` | Chooses an option of a drop-down |
| `browser.press_key` | Presses a key or a combination |
| `browser.navigate` | Opens a URL in the tab |
| `browser.switch_tab` | Brings an open tab to the front of its window, when you ask |

The elements the model reads include the HTML a page draws inside an SVG (in a `foreignObject`), such as the icons
of a chat app's side rail, with refs to click; the rest of the drawing is left out. When a click changes nothing
on the page (the same address, nothing in the page changed but what hovering or focusing the element shows, such
as its tooltip, the focus did not move elsewhere, no tab opened), the model is told *clicked, but nothing changed*,
so it does not take a miss for a success. Clicks on a drop-down, a file field, a download link, a drawing or a player are not judged: what they do does not show in the page.

A ref belongs to the page it was read on: each page gets a short code of its own (`k3x` in `ref_k3x_12`), so a ref
read before a navigation is refused as gone instead of naming an element of the next page. After the extension is
reloaded or updated, a tab left open gets the new page script the next time a tool reads or acts on it, which takes
over from the old one there; no need to reload the tab.

Other groups: `user.*` ([asks you questions, lets you pick an element, shows a plan](user-tools.md)), `web.*`
([web search](web-search.md)), `memory.*` ([memory](memory.md)), `history.*` ([saved conversations](history.md)),
[`bookmarks.*`](bookmarks.md), plus your [custom tools](custom-tools.md), [MCP servers](mcp.md) and the tools a page offers
through [WebMCP](webmcp.md). **Settings → Tools** switches each tool on or off and lets you edit its
description.

## Permissions, in three layers

### 1. Which sites the extension may read

The extension reads no site until you allow it. The first time on a site the chat shows **Allow reading
*site***, and the toolbar button's popup says *site is not enabled* with **Enable it**. **Settings → Website
access** lists the sites you granted, and **Allow access to all websites** grants them all at once (it can be
revoked the same way). Browser pages (`chrome://`), the Chrome Web Store and
`file:` pages are never read.

### 2. What the model may do on each site

Each site has a **policy**, shown and changed in the selector under the conversation, and listed in
**Settings → Site policies**, with how many sites act without asking or only read, a filter and chips for each:

| Policy | Reading | Clicking, typing, navigating |
|---|---|---|
| **Ask before acting** (default) | Free | A confirmation card each time |
| **Act without asking** | Free | Runs at once |
| **Read only** | Free | Refused |

Policies are kept per agent: an [agent](agents.md) has its own sites, and the page widget has its own column.

**Act without asking** does not reach a site's plain `http://` pages, which anyone on the network could serve: there
an action is asked as under **Ask before acting**. Pages on this machine (`localhost`, `127.0.0.1`) are the exception.

### 3. The confirmation card

An action that needs your permission shows a card with what it will do (the element, the text it will type,
the URL it will open):

- **Allow** runs it once.
- **Allow on *site* ▾** → **In this conversation** (until the conversation ends or the browser closes) or
  **Always (site policy)**.
- **Edit** changes its arguments before it runs, when it has any you can edit.
- **Deny** refuses it. The optional comment goes to the model either way.

The card that a [page widget](page-widget.md) action shows inside the page offers **Allow** and **Deny** only, and
**Allow** works only once the card has been fully in view for a moment: the page itself could answer it or hide it. **Always** for a site is set
from the extension's own pages (the chat's card, or **Settings → Site policies**).

A tool that reads **another tab** than the chat's goes by the policy of that tab's site: a card under **Ask before
acting** (it names that tab), at once under **Act without asking** or **Read only**.

Some calls are always confirmed, whatever the policy:

- a tool that sends a value you saved for it (`{{secret:name}}`);
- deleting a saved item (a skill, a tool, an agent, a memory item).

When the model saves something (a memory item, a skill, a site template, an agent, an action, a custom tool), the
card shows what it would save, and an update only what changes, as a line diff. **Edit** lets you fix a field on the
card first: you allow the corrected version, and the model is told what you changed.

An action you allowed runs only while the tab is still on the site you allowed it for: if the page went
somewhere else in the meantime, it is not done.
