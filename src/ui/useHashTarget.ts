import { useEffect, useState } from 'react';

// The part of the options page hash after "#<section>/" (a deep link inside a section), kept in
// sync with navigation.
export function useHashTarget(section: string): string {
  const [target, setTarget] = useState(() => hashTarget(section));
  useEffect(() => {
    const onHash = () => setTarget(hashTarget(section));
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [section]);
  return target;
}

// `#<section>/<target>`: the section matched as written, never as a pattern.
function hashTarget(section: string, hash = location.hash): string {
  const prefix = `#${section}/`;
  if (!hash.startsWith(prefix) || hash.length === prefix.length) return '';
  try {
    return decodeURIComponent(hash.slice(prefix.length));
  } catch {
    return ''; // a malformed escape typed by hand
  }
}
