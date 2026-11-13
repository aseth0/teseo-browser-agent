# The DevTools engine

**Settings → Chromium DevTools → Run the browser tools on DevTools** (the switch beside its title, off by default) runs the browser tools
through Chrome's debugger instead of synthetic events:

- **real input**: clicks, keys and typing that pages cannot tell from yours;
- **hover** and **drag**, which only exist with the engine;
- **screenshots of any tab**, of one element or of the full page, in a mobile or dark view;
- `browser.wait_for` can also wait until the network is idle.

The engine needs the browser's `debugger` permission, which the Chrome Web Store version does not ask for, and the
debugger API, which Firefox does not have. There the section stays in the menu with an **unavailable** mark and says
why, `browser.hover` and `browser.drag` show greyed in **Settings → Tools** (never offered to the model), and
full-page screenshots scroll through the page. The version from the project's
[releases](https://github.com/aseth0/teseo-browser-agent/releases) has it
([what each version has](settings.md#what-each-version-has)).

The debugger attaches to one tab for one call and detaches after it. Meanwhile the chat's top bar shows
**DevTools** (point at it for the tab), and the extension icon shows **DBG** (a [recording](recordings.md)'s count
instead while one runs). The tools that run on the engine carry a **DevTools** badge in **Settings → Tools**, the 🔧
menu and the chat's tool calls.
It acts only on sites the extension already has access to. In screenshots, passwords, card numbers, one-time
codes, fields named like secrets and frames from other sites are painted over, plus any selectors you add.

Real input only reaches the tab in front of its window. On a tab in the background (or in a minimized
window) a click, typing, a key or a scroll is done the usual way, with synthetic events, and the agent is
told so; hover, drag and shortcuts with modifiers are not done there. The agent never brings the tab to the
front on its own: `browser.switch_tab` does it when you ask, confirmed as the site's policy says. The
agent's own bubble and floating chat let the input through to the page under them while it is sent.

## Masking more fields

**Masked in screenshots → More fields to mask** takes one line per field: a host, a space, and a CSS selector. The
host covers its subdomains too, and a line starting with `#` is a comment:

```text
example.com #card-number
shop.example.com input[name="voucher"]
```

Add a line for anything a screenshot should never show on a site, such as an account number in a plain field. Fields
inside closed shadow roots cannot be masked.
