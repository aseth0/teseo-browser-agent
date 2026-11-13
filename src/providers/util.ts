// HTTP helpers shared by provider adapters.

export async function assertOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  throw new Error(`${label} ${res.status}: ${text.slice(0, 500)}`);
}
