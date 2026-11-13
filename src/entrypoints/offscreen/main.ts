// The background's offscreen document (audio/offscreen-document): it records a tab's audio (audio/offscreen)
// and plays what Speak reads aloud (speech/offscreen), which a service worker cannot.
import { listenTabAudio } from '../../audio/offscreen';
import { listenSpeech } from '../../speech/offscreen';

listenTabAudio();
listenSpeech();
