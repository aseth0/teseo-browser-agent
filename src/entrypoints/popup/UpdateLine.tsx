// The popup's notice that a newer version of Teseo is out (ui/useUpdateNotice: the downloadable build
// only), with a link to the releases. It stays on every opening until its × closes it for that version;
// a newer release shows it again.
import { links } from '../../core/links';
import { Icon } from '../../ui/chat-icons';

export function UpdateLine({ latest, onDismiss }: { latest: string; onDismiss: () => void }) {
  return (
    <div className="popup-site popup-update" role="status">
      <span className="popup-site-text" title={`Teseo ${latest} is available`}>Teseo <strong>{latest}</strong> is available</span>
      <a href={links().releases} target="_blank" rel="noreferrer" role="menuitem">Get it</a>
      <button className="icon-button" role="menuitem" title="Dismiss until a newer version" aria-label={`Dismiss the notice for ${latest}`} onClick={onDismiss}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
