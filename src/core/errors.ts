// What went wrong, as a line for the user or the model: the message, without its "TypeError: " prefix.
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^\w*Error: /, '');

// What a message or injection to a tab or the side panel meets as a matter of course: no one
// listening (the panel is not open, the page has no content script), the tab closed or navigated,
// the extension reloaded under a page, a page the browser does not let extensions script.
const EXPECTED = /Receiving end does not exist|Extension context invalidated|message port closed|No tab with id|Frame with ID \d+ was removed|Cannot access|cannot be scripted/i;

// A call whose failure changes nothing for the caller: settled with undefined in its place. The
// expected failures go unsaid; any other is logged under `tag`, so it is not lost.
export function bestEffort<T>(p: Promise<T>, tag: string): Promise<T | undefined> {
  return p.catch((e: unknown) => {
    if (!EXPECTED.test(errorText(e))) console.warn(`[${tag}]`, e);
    return undefined;
  });
}
