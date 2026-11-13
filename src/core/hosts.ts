// A site an agent may be given: a host as URLs have it ("example.com", "localhost:8080").
export function isHost(host: string): boolean {
  try {
    return !!host && new URL(`https://${host}`).host === host;
  } catch {
    return false;
  }
}
