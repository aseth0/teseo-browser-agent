# Extract data into a table

Turn a list on a page (orders, prices, search results) into a table you can paste into a spreadsheet.

**Example:** your order history on `shop.example.com` lists 30 orders, and you want this year's in a spreadsheet:
date, order number, total and status.

## What you need

- The page open, with the chat next to it.

## What you type

> Make a table of the orders on this page: date, order number, total and status. Only 2026.

## What you see

1. The answer is a table.
2. Point at it: **Copy the table** shows in its corner. Pasted into a spreadsheet or a document, it keeps its rows
   and columns.
3. For another format, ask *"…as CSV in a code block"* and click **Copy the code**.

## What you approve

Nothing: the model only reads the tab the chat works on. The first time on a site, the page bar shows **Allow** so
the extension may read it.

## The same page every week

Ask once: *"Make a template for this page that lists the orders with date, number, total and status."* The model
builds a [site template](../guide/site-templates.md), tries it, and shows it in a card before saving: **Allow** saves
it. From then on, your messages on that site carry exactly those fields, read the same way each time.

## Your own list as input

Attach a CSV or JSON file (paperclip → **File…**, or drop it on the message box) and combine it with the page:
*"Add a column with this page's price for each product in the attached list."*

## If it goes wrong

- **Rows are missing** on a long page: ask it to *"read the whole page"*, or scroll and ask again.
- **A long table stops halfway**: ask for fewer columns, or in parts (*"the first 50"*).
- **It says it cannot create templates**: see
  [Troubleshooting](../guide/troubleshooting.md#browser-cannot-create-skills-tools-or-agents).
- **A number looks wrong**: check it against the page before you rely on it. The model copies figures, and can slip.

More details: [Site templates](../guide/site-templates.md) · [Attachments](../guide/attachments.md) ·
[Using the chat](../guide/chat.md).
