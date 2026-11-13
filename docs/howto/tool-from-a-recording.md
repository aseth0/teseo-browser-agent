# Make a custom tool from a recording

Use a site once while the extension records what its pages ask the server, then let the model turn that into a tool
of your own. Next time the chat gets the answer directly, without clicking through the pages: faster and cheaper.

**Example:** every week you look up prices on `catalog.example.com`: you search for a product, then open the result.
You want the chat to do that in one step.

## What you need

- The site open in a tab, with the chat next to it.
- A capable model: the tool it writes is a small program.

## What you do

1. On the site, open the toolbar button's popup and use its **Requests** line (or the shortcut, if you set one).
   Keep the preset **API calls**: it leaves out analytics, ads and repeated calls as they come. (With
   [the DevTools engine](../guide/devtools-engine.md) on, it also offers **Several tabs** or **Tabs and mouse**.)
2. Do the task once, by hand: search the catalog for *oak chair* and open a result. The toolbar icon counts what it
   caught, and a pill on the page shows the recording: you can close the chat meanwhile.
3. Click **Stop**: on the pill or in the popup. The review opens in the chat:
   - Under **Calls**, keep ticked only what the task needs: **Filter calls…**, **Tick shown**, **Untick shown**.
     Entries marked ⚠ look sensitive and start unticked.
   - Under **Private values**, check what is hidden. To hide something else, select it in a call and click
     **Hide selected value**, or click **Hide…** next to it in the call's **Values**. **Save it for a tool** keeps it
     in the extension, never shown to the model.
   - Under **What the model gets**, you can read exactly what will be sent, and how big it is.
4. Click **Make a tool…** at the bottom. A step shows what changes each time the tool runs: check each value.
   The search term should say **You give it each time**; an id the search found, **From #1's answer**; anything
   else, **Always as recorded**. Rename them if you like (see
   [the example](../guide/recordings.md#what-changes-each-run)).
5. Click **Make the tool**. The message box gets a request for the tool: change it if you like, then send it. With
   [Builder](../guide/agents.md#built-in-agents) on, the chat switches to Builder, the only agent that can save
   tools then.

## What you see

The model writes the tool and tries it. Then a card shows the tool before it is saved: **Allow** saves it, **Edit**
lets you change it first. It is listed in **Settings → Custom tools**, where **Try it** runs it with sample values.

From then on, just ask:

> Search the catalog for oak chairs and list the five cheapest with their stock.

## What you approve

- **Saving the tool**: always, in the card above.
- **Each use**: a card on the site, like any action, unless you tick **This script only reads** in the tool's editor.
  A tool that sends a value you saved asks every time.

## If it goes wrong

- **The site needs you signed in**: tick **Send the browser's session for this site** in the tool's editor. The model
  never sees your session.
- **It worked, then fails**: the site changed. Record it again.
- **You only want the model to understand the site**: in the review, **Attach** sends the recording with your
  message, without asking for a tool. **Discard** throws it away.

More details: [Recording a page's requests](../guide/recordings.md) · [Custom tools](../guide/custom-tools.md) ·
[Agents (Builder)](../guide/agents.md#built-in-agents).
