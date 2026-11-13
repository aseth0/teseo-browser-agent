// The popup's first line, where the extension may not work on the tab's site: not enabled yet, with
// Enable it (this site only, asked inside the click: Settings → Website access grants every site); or a
// page the browser keeps extensions off, said and nothing to do. None once the site is granted.
import { useCallback, useEffect, useState } from 'react';
import { pageAccess, type PageAccess } from '../../page/access';
import { hostOf } from '../../core/util';
import { Icon } from '../../ui/chat-icons';
import { onPermissionsChanged } from '../../ui/permissions-changed';

const report = (e: unknown) => console.error('[popup]', e);

// What the extension may do on the page at `url`, asked again whenever a permission is given or taken
// (here, or from Settings meanwhile). `fixed`: what it is, without asking (the popup's preview).
export function useSiteAccess(url: string | undefined, fixed?: PageAccess): [PageAccess | undefined, () => void] {
  const [access, setAccess] = useState<PageAccess>();
  const refresh = useCallback(() => {
    if (fixed) return setAccess(fixed);
    if (url) pageAccess(url).then(setAccess, report);
  }, [url, fixed]);
  useEffect(() => {
    refresh();
    return fixed ? undefined : onPermissionsChanged(refresh);
  }, [refresh, fixed]);
  return [access, refresh];
}

export function SiteAccessLine({ access, url, onEnable }: { access: PageAccess | undefined; url: string | undefined; onEnable: () => void }) {
  if (access === 'restricted') {
    return (
      <div className="popup-site restricted" role="none">
        <Icon name="withheld" size={14} />
        <span className="popup-site-text">Teseo can&apos;t work on this page</span>
      </div>
    );
  }
  if (access !== 'needs-permission' || !url) return null;
  const host = hostOf(url);
  return (
    <div className="popup-site" role="none">
      <Icon name="withheld" size={14} />
      <span className="popup-site-text" title={`${host} is not enabled`}><strong>{host}</strong> is not enabled</span>
      <button className="primary" role="menuitem" aria-label={`Enable ${host}`} onClick={onEnable}>Enable it</button>
    </div>
  );
}
