// Settings → Voice, a tab's audio: what the pill on the page shows while it captures (recording/pill), each
// option over a schematic drawing of that pill at the top right of a page: the bar alone, as wide as what it
// holds; or the bar over a box as wide, with the waves if chosen, then the last lines.
import { DrawnChoice, OUTLINE, type DrawnOption } from './DrawnChoice';
import type { TabAudioView } from '../storage/settings-types';

export function AudioViewPicker({ value, onChange }: { value: TabAudioView; onChange: (view: TabAudioView) => void }) {
  return <DrawnChoice legend="While it is captured, the page shows" name="tab-audio-view" viewBox="0 0 160 70" options={VIEWS} value={value} onChange={onChange} />;
}

const RIGHT = 154;
const BOX_LEFT = 14;
const WAVE_HEIGHTS = [2, 4, 7, 5, 9, 12, 8, 4, 2, 3, 6, 10, 14, 11, 6, 3, 5, 9, 7, 3, 2, 5, 11, 13, 8, 5, 3, 6, 4, 2, 2];
const WAVES = WAVE_HEIGHTS.map((h, n) => `M${BOX_LEFT + 8 + n * 4} ${38 - h / 2}v${h}`).join('');

function PillDrawing({ view }: { view: TabAudioView }) {
  const left = view === 'pill' ? 82 : BOX_LEFT;
  const linesAt = view === 'waves' ? 49 : 31;
  return (
    <>
      <rect {...OUTLINE} x={left} y="6" width={RIGHT - left} height="16" rx="8" />
      <circle cx={left + 8} cy="14" r="2.5" />
      <rect x={left + 14} y="12.75" width="24" height="2.5" rx="1.25" />
      <rect {...OUTLINE} x={RIGHT - 21} y="9" width="18" height="10" rx="5" />
      {view !== 'pill' && (
        <>
          <rect {...OUTLINE} x={BOX_LEFT} y="26" width={RIGHT - BOX_LEFT} height={linesAt + 14 - 26} rx="5" />
          {view === 'waves' && <path {...OUTLINE} d={WAVES} />}
          <rect x={BOX_LEFT + 8} y={linesAt} width="124" height="2.5" rx="1.25" />
          <rect x={BOX_LEFT + 8} y={linesAt + 6} width="88" height="2.5" rx="1.25" />
        </>
      )}
    </>
  );
}

const VIEWS: DrawnOption<TabAudioView>[] = [
  { id: 'pill', label: 'The time and Stop', drawing: <PillDrawing view="pill" /> },
  { id: 'transcript', label: 'The transcript too', drawing: <PillDrawing view="transcript" /> },
  { id: 'waves', label: "The transcript and the sound's waves too", drawing: <PillDrawing view="waves" /> },
];
