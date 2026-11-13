// The offscreen document's side of Speak (speech/protocol): the one reading, asked for and played here
// (speech/player), its progress told to the background. The extension's own pages only, never a content script.
import { isExtensionPage } from '../core/sender';
import { onRuntime, sendRuntime } from '../core/runtime';
import { createPlayer, webAudioOut, type PlayerEvent } from './player';
import { fetchClip } from './request';
import { SPEAK_ENDED, SPEAK_HALT, SPEAK_HELD, SPEAK_MORE, SPEAK_PLAY, SPEAK_PROGRESS } from './protocol';

const told = (e: PlayerEvent) =>
  void (e.kind === 'progress'
    ? sendRuntime({ type: SPEAK_PROGRESS, run: e.run, piece: e.piece, total: e.total, playing: e.playing })
    : sendRuntime({ type: SPEAK_ENDED, run: e.run, ...(e.error ? { error: e.error } : {}) })
  ).catch(() => undefined);

export function listenSpeech() {
  const player = createPlayer({ fetchClip, out: webAudioOut(), tell: told });
  onRuntime(SPEAK_PLAY, (msg, sender) => (isExtensionPage(sender) ? player.play(msg.run, msg.pieces, msg.target, msg.done !== false) : undefined));
  onRuntime(SPEAK_MORE, (msg, sender) => {
    if (isExtensionPage(sender)) player.more(msg.run, msg.pieces, msg.done);
  });
  onRuntime(SPEAK_HALT, (_msg, sender) => {
    if (isExtensionPage(sender)) player.halt();
  });
  onRuntime(SPEAK_HELD, (_msg, sender) => (isExtensionPage(sender) ? { ...(player.held() ? { run: player.held() } : {}) } : undefined));
}
