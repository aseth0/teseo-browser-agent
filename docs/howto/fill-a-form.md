# Fill in a form

Let the chat fill in a web form for you, field by field, and send it only when you say so.

**Example:** you want a quote for 20 oak chairs. The contact form on `shop.example.com` asks for your name, company,
email, the product, the quantity and a message.

## What you need

- A model set up ([Getting started](../guide/getting-started.md)).
- The form open in a tab, with the chat next to it. The first time on a site, the page bar under the conversation
  shows **Allow**: click it so the extension may read the page.
- Optionally, your details written once in **Settings → About you** (see below).

## What you type

> Fill in this quote form with my details. Product: oak chair, quantity 20, delivery in March. Don't send it yet.

## What you see

1. The model lists the fields it found, then fills them one by one. You see each field change on the page.
2. A required field it has no data for is asked, not guessed: in the chat, or in a **The model asks** card with
   choices and a text box. Answer and click **Send answers**.
3. Before sending, it sums up what will go and waits for your *yes* in the chat.
4. After sending, it tells you what the page answered: the confirmation, or the fields to fix.

## What you approve

On a site set to **Ask before acting** (the default), each change asks first in a card: *Allow this action on
shop.example.com?*, with the field (*Type into textbox "Company"*) and the text.

- **Allow** fills that field.
- **Allow on shop.example.com ▾ → In this conversation** fills the rest of the form without asking.
- **Deny**, with a note in **Comment for the model** (*"use the billing address"*), makes it try again.

## Your details, once

Write your name, company, email and address in **Settings → About you**. The model gets that text only where your
prompt includes `{{about_user}}`: the section says so when no prompt uses it yet. Add it to your prompt in
**Settings → Prompt preview**, and *"with my details"* is enough from then on.

## If it goes wrong

- **Passwords and card numbers** are never typed for you: the model asks you to enter them yourself.
- **A field stays empty** (a date picker, a rich text box): fill it in yourself, or turn on
  [the DevTools engine](../guide/devtools-engine.md), which types like a real keyboard.
- **It stops halfway** on a long form, with a **Continue** button: click it.
- **A wrong value**: **Deny** it with a comment, or tell it in the chat.

More details: [Acting on pages](../guide/acting-on-pages.md) ·
[When the model asks you](../guide/user-tools.md) · [About you](../guide/prompt.md#about-you) ·
[Skills](../guide/skills.md).
