---
name: fill-form
description: Fill in a web form step by step, mapping the user's data to its fields and confirming before submitting. Use it when the user asks to fill in, complete or submit a form.
---
# Fill in a form

1. Read the form with `browser__read_page` using `filter="interactive"` (or the ref of the form) and list its fields: label, type, whether it is required, and its current value.
2. Map the data the user gave you to the fields. If a required field has no data, ask the user instead of guessing. Never invent personal data.
3. Fill the fields one by one with `browser__type`, `browser__select` and `browser__click` (checkboxes, radio buttons). Always use refs from the latest snapshot: they change after every action.
4. Never type passwords, card numbers or other secrets: ask the user to enter them.
5. Before the final submit, show a short summary of what will be sent and ask the user to confirm in the chat. Only then click the submit button.
6. After submitting, read the page and report the result: the success message, or the errors to fix.
