// The microphone Settings → Voice chose (its deviceId), or the browser's default without one. One
// that is no longer there (unplugged, another machine) gives the default instead of failing; a
// microphone that is blocked is not asked again.
// Why the microphone could not be had: blocked (the side panel cannot ask), or none there; none: another error.
export type MicProblem = 'blocked' | 'no-device';
export function micProblem(e: unknown): MicProblem | undefined {
  const name = (e as { name?: string } | null)?.name;
  return name === 'NotAllowedError' ? 'blocked' : name === 'NotFoundError' ? 'no-device' : undefined;
}

export async function openMic(ask: (c: MediaStreamConstraints) => Promise<MediaStream>, deviceId: string | undefined): Promise<MediaStream> {
  if (!deviceId) return ask({ audio: true });
  try {
    return await ask({ audio: { deviceId: { exact: deviceId } } });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw e;
    return ask({ audio: true });
  }
}
