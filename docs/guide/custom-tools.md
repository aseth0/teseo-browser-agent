# Custom tools

A **custom tool** gives the model a new tool without writing an extension. Manage them in **Settings → Custom
tools**, or ask the model to make one (you review it before it is saved).

**Settings → Custom tools** has the layout of the other sections: four figures (how many there are and are on, how
many are made from a tool, requests and scripts, and from sources, with what needs a look), then three tabs:
**Tools**, the list, with its filters by kind and label and **Needs a look** (changed by its source, or its tool
missing); **Sources**; and **Limits and texts**.

A tool's editor leads you through its steps, one at a time, in the order a tool is made: **What it is**, then its
parts (for a request: **The request**, then **What the model fills**), **Try it**, and last **Its name and
description, for the model**, then **Organize** (optional). **Next** opens the following step; a step done folds to
one line with ✓ and **Change** (one still to come has **Open**); what you typed or tried in a step stays while it is
folded. A new tool starts at the first step; one you open again has them all folded.

A problem shows beside its field once you have been through its step: the first **Next** of a step with problems
shows them and stays; after that, **Next anyway** goes on. On the right, beside the steps as you scroll: **As the
model sees it** (its name, description and parameters, live, and the whole definition as JSON) and **Checks**, which
counts what is left before **Save**, each with a link to its step and, for the steps you have been through, what
it is; and says whether you tried it. **Save** stays at the bottom, ready as soon as nothing is left. **Offered**,
beside its name, switches it on or off. Choosing another kind for a tool that has a request, a script or parameters
asks first: they are cleared.

**What it is** offers, for a new request, a box to **paste a URL or a curl command** (as browsers copy one from
their developer tools, `$'…'` strings and `-G` included) and fill the next steps: the method, URL, headers and body.
What looks like a key is kept out of the URL and body, which the model can read: headers stay headers (yours only),
`user:password@` in the URL becomes an `Authorization` header, a value in the query or the body (at any depth) whose
name says it is a key (`api_key`, `access_token`, `accesstoken`, `X-Amz-Signature`, `password`…) or that looks like
one (a JWT, a long random string, a provider's key prefix), and a part of the path that looks like one (a bot's
token), becomes a saved value (`{{secret:name}}`); the part after `#` is left out (it never reaches the site), and
cookies too (tick **Send the browser's session for this site** if it needs your sign-in). The editor says what it did. A body
that is a form (`name=value&…`) is kept as it came, its keys taken out, but must be written as JSON to be saved.
Or start from an example: **Search an API**, **Post a message**, **Read one item by id**. Over a request being
written, both ask first.

The step where you write a URL, a body or how a parameter is made lists the tool's inputs as chips: a click puts
`{name}` where the caret is. The name step suggests one from what the tool is (`example.search` for a search on
api.example.com); a click takes it.

## Three kinds

### A tool you have, preset

A tool you have, with some parameters fixed or wrapped: a web search limited to one site, a tool that always asks
for 5 results. Its steps: the tool it runs, its parameters, **Try it** (the call it makes), name and description.
Parameters can be:

- **Fixed**: set by you, hidden from the model (`limit: 5`);
- **Wrapped**: the model's text inside yours (`{value} site:forum.example.com`);
- **Inputs of its own**, from which the tool's parameters are made (`https://wiki.example.com/{lang}/wiki/{title}`);
  one of them can also be **Left out**.

It runs as the tool it is made from does, with the same confirmation and site policy.

### An HTTP request

One request to a web API, its answer cut to what matters. Its steps:

- **The request**: the **method** (GET, POST, PUT, PATCH or DELETE), the **URL** with inputs as `{name}`, each
  encoded (the host is fixed), and the **body** (not for GET): JSON with inputs as `{name}`, without quotes. Its keys
  and sign-in are folded under **Keys and sign-in**.
- **What the model fills**: the values found in the request (the query's, ids in the path, the body's values) are
  listed, each **Fixed**, **The model fills it** or **Saved value** (sent only to its site, never shown to the model;
  the tool then asks you every time it runs). A fixed one that looks like a key is marked; the other parts of the
  path are folded under **Other parts of the path**, to make one a saved value by hand. A saved value typed by hand
  goes as it is written where it is: encoded in a URL (`%2B` for +), escaped in a JSON text. Filled by the model, a
  value becomes an input in its place, and its description is asked right there; **Fixed** puts the value back.
  Renaming an input (once you leave its box) renames it in the request too, unless the new name is another input's.
  **＋ Add a parameter** adds one of your own.
- **Try it**: sends it with values you type, nothing saved, and shows its status, time and size (in characters).
  **Answer cut to** is a path into the JSON answer (`items[].{title,url}`), so that the model gets only that: write
  it, tried or not (keys joined by dots, `data.user.name`; a position in a list, `items.0`; `[]` for each element of
  a list; `{a,b}` to keep several keys), or click the keys the model needs in the answer of a try, and the editor
  says how much smaller the answer gets. A list shows its first element: a key there stands for that key of each
  element. **What the model would get** shows the answer cut, as long as a tool's answer may be.

GET runs without asking. Other methods change things, so they are confirmed as actions on the API's site; tick
**This request only reads** for a search sent as POST.

A request follows no redirect, not even to the same site: one answered with a redirect fails, and its error says
so; use the address it leads to. The same goes for a script's `request()` and for a [source](#sources-tools-shared-by-a-team)'s file.

### A script

JavaScript for what one request cannot do: several requests to one site's API (a list, then a request per item),
paging, filtering, sorting; or a fixed sequence of tool calls run as one tool. Its steps: **What it reaches** (the
tools it calls, and its site with its keys and sign-in), its parameters, **The script** (**Insert example** starts
an empty one with an example of its kind), **Try it**, name and description.

```js
const found = await request('GET', '/api/projects?per_page=5&search=' + encodeURIComponent(input.term));
if (!found.ok) throw new Error('projects: ' + found.status);
return found.data.map((p) => ({ name: p.name, url: p.web_url }));
```

A script has these, and nothing else:

- `input`: the tool's parameters (`null` when not given). Each one is also a variable by its name: `term` is
  `input.term`, so `const term = …` fails; use it as it is, or another name.
- `request(method, path, body)` reaches **only the tool's site**, and returns `{ status, ok, data }`. At most 50
  requests per call, and 30 seconds (**Time of a script tool** in [Limits](limits.md)).
- `tool(name, args)` calls one of the tools the script lists in `uses`; each step is confirmed as a model's call
  would be. The browser's tools go through it too: `await tool('browser.navigate', { url })`.
- `note(text)`: a line for the model, and for you as it runs.

The script runs in a **sandbox** of its own, a small JavaScript engine (QuickJS) inside the extension, apart from
any page: no other site, no browser API, no timers, and it never sees your headers' values or cookies. It stops at
its time limit and at a memory limit; code that runs on for 1.5 seconds without waiting for anything (an endless
loop) is stopped at once, so that it never holds the extension. Its `document` is not the page's: it reads and acts on pages only through `tool()`
(`browser.find_in_dom`, `browser.type`…). When it uses a name it does not have, its error lists what it has.

## Keys, sessions and saved values

| You need | Use |
|---|---|
| An API key | A header under **Keys and sign-in** (yours only: the model never sees it) |
| The session you are signed in with | **Send the browser's session for this site** |
| A CSRF token from a cookie | A header with `{{cookie:NAME}}` |
| A value you hid in a [recording](recordings.md) | `{{secret:name}}`, sent only to its site; the tool asks you every time it runs |

The model never sees these values, and they are masked in the answers it gets.

## Trying and sharing

**Try it** runs a request or a script with sample values without saving it, and shows what the model would get;
until you do, **Checks** says **Not tried yet** (in this edit: trying is not saved with the tool). A
tool you have, preset, is not run from Settings, where its confirmation and the site's policy do not apply: **Try it**
shows the call it makes with the values you type (its fixed values and wrapping put in), and **Copy $name** gives
the mention to run it from the chat once saved. Tools can be
exported and imported as JSON, all of them or those you choose with **Select** (header values and `{{secret:…}}` values only if
you tick *Include header values*), and organized in groups with labels ([Backups](settings.md#backups)). A group is also what
[Settings → Tools → Matching](tools.md#matching-which-tools-reach-the-model) matches: the tools without one are
matched together. Imported tools arrive
switched off: their descriptions reach the model, so check them first. An import that would replace a tool from a
source says so and leaves it unticked: ticked, the tool becomes yours and that source no longer updates it.

A tool imported over one of the same name keeps your header values (where the file leaves them empty), saved
`{{secret:…}}` values, session and read-only choices only while its request goes to the same site with the same
method; one whose site or method changed comes without them, for you to set again.

## Sources: tools shared by a team

A **source** is a URL that serves the same JSON the export makes (`{ "customTools": [ … ] }`), such as a raw file in
a team repository. Add one in **Settings → Custom tools → Sources → ＋ Add a source**, with headers or the browser's
session if the file needs a sign-in.

It syncs when you save it, when you click **Sync**, and each time you open the section:

| In the file | What happens |
|---|---|
| A new tool | Added, **off** until you switch it on |
| A tool whose request or code changed | Switched **off** and flagged until you check it |
| An unchanged tool | Keeps its on/off state |
| A tool no longer there | Removed |
| A tool named like one of yours, or another source's | Left out |

Your header values, saved values, session and read-only choices are kept through syncs, as with an import: only
while the tool's site and method are unchanged. A file can never turn on your browser session or mark a request
read-only: only you can. **Remove** drops the source and keeps its tools as yours.

The Chrome Web Store version has no sources: the store does not let an extension keep code in sync with a file
on a server, and a tool can carry a script. Nor does the Firefox build, a trial: Mozilla's add-on policies want an
add-on that loads no code from elsewhere to run. There, share tools with **Export** and **Import** instead, a file or
a URL you import once and review ([what each version has](settings.md#what-each-version-has)).

## Letting the model make them

Ask *"make a tool that searches the forum"*. The `create-custom-tool` and `create-script-tool` skills guide the
model: it learns the API first (from its documentation, `browser.site_access`, or a recording you made), tries the
tool with `custom_tools.try`, and saves it with `custom_tools.save` for you to review. It never puts keys or
tokens in a tool: it tells you where to add them. Ask it to put a tool in a group (*"put it in Chat"*), move it to
another or take it out: the card you review shows the group.
