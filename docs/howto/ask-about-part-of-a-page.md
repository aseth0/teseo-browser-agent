# Ask about part of a page

Take a screenshot of just the part of a page you mean, and ask about it: a chart, a table, an error message.

**Example:** a sales dashboard on `stats.example.com` shows a line chart with a dip in March, and you want to know
what it shows before a meeting.

## What you need

- A model that takes images (a "vision" model).
- The page open in the tab in front.

## What you do

1. Click the extension's icon. In the popup, the **Screenshot** row has three buttons: click **Section**.
2. The page dims and says *Drag over the part to capture · Esc cancels*. Drag a rectangle over the chart.
3. When you let go, the side panel opens with the image attached to the message box. If the chat is floating on the
   page, the image goes there instead.
4. Type your question and send it:

> What does this chart show? Why might March drop, and what should I check first?

**Visible** takes the part of the page you can see, and **Full page** the whole page, top to bottom, in parts of one
screen each. **Alt+Shift+S** takes **Visible** without opening the popup; set keys for the other two on the
browser's shortcuts page, or in **Settings → Shortcuts** itself (a screenshot from a key set there needs access to
every site: [keys set in Settings](../guide/chat-windows.md#keys-set-in-settings)).

## What you see

- The image as a chip above the message box, not sent yet: add more, remove it with ✕, or write first.
- The answer about what is in the picture. Ask follow-up questions in the same conversation.

## What you approve

Nothing: the screenshot is attached only when you send your message, and it reads nothing else on the page.

## If it goes wrong

- **The Screenshot buttons are greyed out**: the tab is a browser page (settings, extensions, a new tab), which
  cannot be captured. Open the page you want first.
- **An Attach to chat button shows by the section**, and the panel did not open: the browser did not let it open
  after the drag. Click the button. The image waits for the chat for 10 minutes, however you open it.
- ***This model may not take images***: choose a model that takes images.
- **The image is too small to read**: capture a smaller part, so it is larger in the picture.
- **The model gets a note instead of the image**: the [word blacklist](../guide/word-blacklist.md)'s **Hide images
  from the model** is on.

From the chat itself, the paperclip → **Web Screenshot** takes the same section or visible screenshots.

More details: [Attachments](../guide/attachments.md#screenshots-from-the-popup-or-a-shortcut) ·
[Where the chat opens](../guide/chat-windows.md) · [Limits](../guide/limits.md).
