// What a page's selection is, for a reading started from the shortcut: in a text field (not a password's)
// its selected text, else the page's. Injected too, in every frame.
export function pageSelection(): string {
  const el = document.activeElement;
  const field = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|tel|email)$/.test(el.type)) ? el : undefined;
  if (field && field.selectionStart !== null && field.selectionEnd !== null && field.selectionEnd > field.selectionStart) return field.value.slice(field.selectionStart, field.selectionEnd);
  return String(getSelection() ?? '');
}
