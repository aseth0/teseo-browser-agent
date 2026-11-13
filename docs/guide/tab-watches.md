# Tab watches

A **tab watch** keeps an eye on a tab in the background and tells you when something happens: a long export
finishes, a build turns green, an answer stops being written. The chat can then go on with the task by itself.

*"Tell me when the report on this tab is ready, then download it."*

## How a watch starts

The model sets one with `browser.watch`, which you confirm every time (*Watch the tab "…" until …*). It waits for one
or more conditions, all of which must be met:

| Condition | Met when |
|---|---|
| **gone** | An element disappears (e.g. a *Stop generating* button) |
| **appears** | An element appears (e.g. a *Download* link) |
| **stable** | The page has not changed for a while |

Elements are found as `browser.find` finds them, or by CSS selector. The tool returns at once, so the conversation is
free meanwhile.

## How it ends

- **Met**: the condition happened.
- **Time is up**: 60 minutes by default (**Settings → Limits**, up to 12 hours).
- **The tab was closed**, or **went to another site** (a page loading on the same site keeps the watch going).
- **Cancelled**, by you or by the model.

When it ends, a **system notification** says so (*Watch met on …*); clicking it brings the tab to the front. A watched
tab is kept from being discarded by the browser. Watches do not survive closing the browser.

## Going on with the task

When a watch the model set from a conversation is met, that conversation gets a message saying so, and the model goes
on with what it was doing, as soon as the conversation is open and idle. If you are elsewhere, the watches menu offers
**Continue** to open it.

## The watches menu

While a watch runs (or one ended and you have not dismissed it), a watches button shows in the side panel's top bar:

- running watches: the tab, the condition, the minutes left, and **Cancel**;
- ended ones: *Met: …* or *Ended: …*, **Dismiss**, and **Continue** when the conversation can go on.

Up to 5 watches run at once by default (**Settings → Limits**, up to 20). The model can cancel only the watches it set
from the same conversation (`browser.unwatch`).
