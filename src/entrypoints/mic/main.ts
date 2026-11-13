// mic.html: the one-time microphone grant for dictation. The side panel cannot show the browser's
// prompt; this tab can, and the permission it gets belongs to the extension's origin, so the panel
// has the microphone from then on. Asked as the page opens; the microphone is released at once.
import { applyAppearance } from '../../ui/appearance';
import '../../ui/style.css';

applyAppearance(undefined);
const status = document.getElementById('status')!;

async function ask() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    status.textContent = 'Microphone allowed. You can close this tab.';
  } catch (e) {
    status.textContent = (e as DOMException).name === 'NotFoundError'
      ? 'No microphone found.'
      : "The microphone is blocked. Allow it in this extension's site settings, then reload this tab.";
    status.classList.add('error-text');
  }
}

void ask();
