// For file names: now, as YYYYMMDDHHMM in UTC.
export const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

// A text the browser saves as a file (exports of conversations, custom tools…).
export function downloadText(name: string, content: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
