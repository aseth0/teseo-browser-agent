// The browser.* tools that exist only on the DevTools engine (tools/browser/engine-tools): with no
// synthetic stand-in, they are not in a build without the engine (core/build), where Settings → Tools
// lists them greyed, with why, and never offers them.
export const ENGINE_ONLY_TOOLS = {
  'browser.hover': 'Moves the mouse over an element by ref without clicking, as the user would: opens menus and tooltips that show on hover.',
  'browser.drag': 'Drags an element by ref onto another element (to) or by dx/dy pixels, with real mouse input: sliders, boards, reordering.',
} as const;
