// The speaker's icons, drawn as SVG: the button beside a selection (speak-selection) and those on an
// action's boxes (box-speak).
const SVG = 'http://www.w3.org/2000/svg';
export function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
export const SPEAKER = ['M11 5 6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'];
export const STOP = ['M6 6h12v12H6z'];
export const SPEAKER_OFF = ['M11 5 6 9H2v6h4l5 4V5z', 'M22 9l-6 6', 'M16 9l6 6'];
