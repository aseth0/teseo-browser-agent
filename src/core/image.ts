// Images made smaller before they go to the model: those you attach (side panel) and the screenshots
// the model takes (background). OffscreenCanvas and createImageBitmap work in both, a service worker too.
import type { ImagePayload } from './types';

// The size within `side` pixels on its longest side; a smaller one as it is.
export function fitWithin(width: number, height: number, side: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

const base64Of = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// The image within `side` pixels on its longest side, as JPEG (on white: JPEG has no transparency).
// `keep`: what to return when it already fits, instead of encoding it again.
export async function shrinkImage(blob: Blob, side: number, { quality = 0.85, keep }: { quality?: number; keep?: ImagePayload } = {}): Promise<ImagePayload> {
  const bitmap = await createImageBitmap(blob);
  const size = fitWithin(bitmap.width, bitmap.height, side);
  if (keep && size.scale === 1) {
    bitmap.close();
    return keep;
  }
  const canvas = new OffscreenCanvas(size.width, size.height);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { mediaType: 'image/jpeg', data: await base64Of(jpeg) };
}

// A base64 image as a Blob.
export function blobOf(image: ImagePayload): Blob {
  const binary = atob(image.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: image.mediaType });
}

// Width and height of a base64 PNG or JPEG, read from its header (no decoding); none when unreadable.
// Kept for the latest few, as the estimates ask for the same images again and again: by a short key,
// so the cache holds no copy of the images.
const sizes = new Map<string, { width: number; height: number } | undefined>();
export function imageSize(data: string): { width: number; height: number } | undefined {
  const key = `${data.length}:${data.slice(0, 64)}:${data.slice(-64)}`;
  if (sizes.has(key)) return sizes.get(key);
  const size = readSize(data);
  if (sizes.size > 50) sizes.delete(sizes.keys().next().value!);
  sizes.set(key, size);
  return size;
}

function readSize(data: string): { width: number; height: number } | undefined {
  let bytes: string;
  try {
    bytes = atob(data.slice(0, 87_380)); // the first 64 KB: a JPEG's frame header comes before its pixels
  } catch {
    return undefined;
  }
  const at = (i: number) => bytes.charCodeAt(i);
  const u16 = (i: number) => (at(i) << 8) | at(i + 1);
  const u32 = (i: number) => ((u16(i) << 16) | u16(i + 2)) >>> 0;
  if (bytes.startsWith('\x89PNG') && bytes.length >= 24) return { width: u32(16), height: u32(20) };
  if (at(0) !== 0xff || at(1) !== 0xd8) return undefined;
  // JPEG: the segments up to a start of frame (SOF0–SOF15, but DHT, JPG and DAC), which has the size.
  for (let i = 2; i + 9 < bytes.length; ) {
    if (at(i) !== 0xff) return undefined;
    const marker = at(i + 1);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: u16(i + 7), height: u16(i + 5) };
    i += 2 + u16(i + 2);
  }
  return undefined;
}
