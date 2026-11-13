# Site templates

A **site template** extracts the data that matters on a website (a list of results, a price, a ticket's status)
and attaches it to every message on that site, in place of or next to the page's visible elements. Templates are
written in [Liquid](https://liquidjs.com/tutorials/intro-to-liquid.html). Manage them in **Settings → Site
templates**: its figures count them and the website patterns of those switched on, and say whether they are sent on
their own ([Auto-inject](chat.md#settings--auto-inject)); the chips over the list show only **Yours**, the
**Built-in** ones or those **By the model**. Its limits, the `::site/view` mention and the texts the model gets are in
the **Limits and texts** tab.

## Views

A template covers one website (Chrome match patterns such as `*://tracker.example.com/*`) and has **views**. On a
page, the first view whose **paths** match the URL runs:

| View | Paths | Shows |
|---|---|---|
| `issue` | `/issues/*` | The ticket: key, title, status |
| `list` | `/issues`, `/issues?*` | One line per ticket |
| `header` | *(none)* | A block other views insert with `{% render "header" %}` |

Give the template a **description** (what it extracts and when it helps) and each view one line of its own: the
model gets the list of your templates, with their views and paths, in every conversation (see below).

**Replace page block** on a view sends its data *instead of* the visible elements: fewer tokens, for pages you
mostly ask about rather than act on. The model then reads the page with its tools before acting.

## Reading the page

Five filters read the live page; everything else is standard Liquid (`assign`, `if`, `for`, `capture`, text
filters…).

| Filter | Gives |
|---|---|
| `page \| select: "css"` | Every match (also `el \| select:` inside an element) |
| `x \| one: "css"` | The first match |
| `el \| attr: "href"` | An attribute (`href` and `src` as absolute URLs) |
| `page \| meta: "og:title"` | A `<meta>` tag's content |
| `page \| schema: "@Product:offers.price"` | A JSON-LD value |

Printing an element prints its visible text.

```liquid
{%- assign rows = page | select: "[data-testid='issue-row']" %}
Issues ({{ rows.size }}):
{%- for r in rows limit: 20 %}
- [{{ r | one: "a" | strip }}]({{ r | one: "a" | attr: "href" }}) · {{ r | one: ".status" | strip }}
{%- endfor %}
```

## Using templates

- With **Settings → Auto-inject → Site templates** on (the default), a template's data goes with every message on
  its site.
- The model is told which of your templates are on, what each view extracts and the paths it applies to, so it
  knows where data comes from and can suggest a `::site/view` mention. Built-in templates are not listed.
- `::site/view` in a message attaches a view's data from any site: from the active tab, another open tab of that
  site, or the view's URL opened in a background tab and closed afterwards.
- A template can also apply when the model reads one of its pages with `web.read`.
- The built-in templates read the results of Google, Bing and DuckDuckGo for [web search](web-search.md).
- Your templates can be exported and imported as JSON, all of them or those you choose with **Select**
  ([Backups](settings.md#backups)); imported ones arrive switched off.

## Previewing a template

**Preview on a page**, at the bottom of the editor, opens a URL in a background tab (asking for access to its site)
and runs the template on it again on every change, without reloading. **View** runs *The one for the page's URL* or
the one you choose. It shows a **Diagnosis**, line by line, and **What the model receives**: exactly what goes in the
message. **Reload** loads the page again, **Close page** closes it; closing the editor closes it too. Built-in
templates are read-only, but can be previewed.

## Templates shipped with the extension

The built-in templates are `templates/<name>/TEMPLATE.md` files in the source, bundled when the extension is built:
the name, description and URL patterns in the frontmatter, then each view after a comment line.

```markdown
---
name: tracker
description: The tracker's tickets, with key, title and status
matches:
  - "*://tracker.example.com/*"
---
<!-- view: issue | paths: /issues/* | replace_page: true | description: The ticket's key, title and status -->
{{ page | one: "h1" }}
```

`paths` takes several, separated by commas. `paths`, `replace_page` and `description` are optional (no paths: a
block for `render`); a description cannot contain `|`.

## Letting the model write them

Ask *"make a template for this page"*. The `create-template` skill guides the model: it finds stable selectors,
tests each view with `templates.run` (which reports, line by line, how many elements each selector found), and
saves it with `templates.save` once the data is right. You review every save.

Template output is limited to 4,000 characters by default (**Settings → Limits**): keep templates small, since
they go with every message. Never extract form values, tokens or personal data you do not need; see
[Privacy and security](privacy-and-security.md).
