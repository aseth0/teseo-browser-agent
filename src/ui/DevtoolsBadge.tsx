// A tool, or a call, on the DevTools engine (tools/browser/engine-tools): Settings → Tools, the tools
// menu and the chat mark it the same way.
export const DevtoolsBadge = ({ ran }: { ran?: boolean }) => (
  <span className="badge devtools" title={`${ran ? 'It ran' : 'Runs'} on the DevTools engine: real input, or a capture of any tab (Settings → Chromium DevTools)`}>DevTools</span>
);
