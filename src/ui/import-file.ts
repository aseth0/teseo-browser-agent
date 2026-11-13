// A file chosen to import, read as text: one far larger than any export is not read at all (it would
// be read whole into memory first), and says why.
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

export async function readImportFile(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_BYTES)
    throw new Error(`${file.name} is ${Math.ceil(file.size / (1024 * 1024))} MB: a file to import can be at most ${MAX_IMPORT_BYTES / (1024 * 1024)} MB.`);
  return file.text();
}
