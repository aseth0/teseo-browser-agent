// A tab's audio in the offscreen document, from the stream id the background got for it
// (tabCapture.getMediaStreamId): recorded as webm/Opus, and played on to the speakers, since
// capturing it mutes the tab. The recorder gives its parts as it goes (a timeslice): started without
// one it keeps the whole capture in its own buffer until it stops (tens of MB over hours), and a
// recorder that dies then loses it all. `onEnded`: the stream ended by itself (the tab closed). Its
// stream is also what is transcribed, in chunks (audio/offscreen).
export interface TabAudio {
  readonly startedAt: number;
  readonly stream: MediaStream;
  stop(): Promise<Blob>; // the recording, once the recorder has given its last part
}

const MIME = 'audio/webm;codecs=opus';
const TIMESLICE_MS = 10_000;

export async function captureTabAudio(streamId: string, onEnded: () => void): Promise<TabAudio> {
  // Chrome's own constraints for a tab's stream, which the DOM's types do not know.
  const constraints = { audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } } as MediaStreamConstraints;
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const context = new AudioContext();
  context.createMediaStreamSource(stream).connect(context.destination);
  const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(MIME) ? { mimeType: MIME } : undefined);
  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) parts.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
      resolve(new Blob(parts, { type: recorder.mimeType || MIME }));
    };
  });
  stream.getAudioTracks()[0]?.addEventListener('ended', onEnded);
  recorder.start(TIMESLICE_MS);
  return {
    startedAt: Date.now(),
    stream,
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      return stopped;
    },
  };
}
