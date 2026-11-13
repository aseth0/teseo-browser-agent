# Jira incident → its Mattermost channel

## The workflow

1. An incident arrives in Jira (`INC-00000`). A Mattermost channel is created for it, named
   `INC-00000 - <title>`, in a given team or in the one the user is in.
2. Another user opens the ticket in Jira. They do not know there is a channel; the extension could
   tell them.
3. Another version of this tool (not this extension) searches Mattermost for the key and shows, in a
   box injected into the Jira page, one line per channel found.

## What works today

**Creating the channel when the incident arrives is not the extension's job**: it only runs while
the browser is open, and this must happen anyway. A Jira Automation rule or a webhook to a
Mattermost bot (`POST /api/v4/channels`) is the place for it. The extension can create one by hand
when asked: an HTTP custom tool with `POST /api/v4/channels`, confirmed, its name and title read
from the Jira page.

**Telling the user there is a channel works without code**:

- An HTTP custom tool `mm.find_channels`:
  - `GET https://<mm>/api/v4/users/me/channels`: the channels the user is in, across teams. Public
    channels they are not in: `POST /api/v4/teams/{team_id}/channels/search` with `{"term": {key}}`.
  - Signed in with **the browser's session** (tick "Send the browser's session for this site") and
    the header `X-Requested-With: XMLHttpRequest`, which Mattermost wants with cookie sign-in. No key.
    Checked in Vivaldi: `GET /api/v4/users/me` from the extension's service worker, with no
    Mattermost tab open, answered `200` with the user. When the session expires, the tool says
    "Not signed in to <host>".
  - Or `Authorization: Bearer <personal access token>`, if the admin allows personal tokens.
  - Answer cut to `[].display_name`, or not cut, to have `name` for a link.
- A site skill on `*://<jira>/browse/INC-*` that reads the key (`{{selector:…}}`) and says: "In an
  incident, look for its Mattermost channel with mm__find_channels and tell the user if there is one,
  with its link."

Limit: the model only acts when the user writes in the side panel. With the skill it answers on any
message on that page, but not on its own when the page opens.

## What it would need

The box in the page is an action of the [page widget](page-widget.md), run on page load:

- **When**: a URL pattern (`*://<jira>/browse/INC-*`).
- **What it reads**: the key, with a selector (as in Liquid templates).
- **What it calls**: a read-only custom tool (`mm.find_channels`), directly, **without the model**:
  instant, free, always the same.
- **How it shows it**: a template with one line per result
  (`[display_name](https://<mm>/<team>/channels/<name>)`), in a shadow-DOM box so the page neither
  breaks nor reads it. Outside text is written as text, never as HTML.

To solve on the way:

- **Read-only POST.** `channels/search` is a `POST`; today any method but GET counts as writing and is
  confirmed. A widget cannot ask on every page load: a custom tool needs a "This request only
  reads" box.
- **Chained calls.** A channel's link needs its team's *name*; the channel only has `team_id`. Two
  calls (`/api/v4/users/me/teams` to translate it), or a widget that chains two tools.
- ~~**Browser session on POST.**~~ ✅ A POST with the session takes the `X-CSRF-Token` header
  Mattermost asks for from its `MMCSRF` cookie: the header's value `{{cookie:MMCSRF}}` (the `cookies`
  permission). For `channels/search` (ticked "This request only reads") or creating channels.
- **(Proactive triggers.)** The model acting when the page opens. The widget covers the useful part
  without the model; a model that comments on its own is a bigger, riskier step.

The widget would serve other cases too: on a GitHub PR, its Jira ticket; on a Jira ticket, its PRs
or its runbook.

## Open questions

- ~~Does this Mattermost allow personal access tokens, or must it use the browser's session?~~ The
  browser's session works (checked in Vivaldi): no token needed.
- Which endpoint fits: the user's channels (`/users/me/channels`, members only) or a team search
  (`/teams/{id}/channels/search`, public channels, one team)?
- The Mattermost version (some endpoints changed across versions).
