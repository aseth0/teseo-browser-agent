// A value typed in the editor as the parameter's type: a number, true/false, JSON, or the text
// (Settings → Custom tools: its fixed values, and Try).
export function parseValue(raw: string, type: string | undefined): unknown {
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    if (raw.trim() === '' || Number.isNaN(n)) throw new Error('a number');
    return n;
  }
  if (type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') throw new Error('true or false');
    return raw === 'true';
  }
  if (type === 'object' || type === 'array') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`JSON (an ${type})`);
    }
  }
  return raw;
}
