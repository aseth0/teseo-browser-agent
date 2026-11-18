// The one-off messages between the extension's parts (runtime.sendMessage, tabs.sendMessage), typed
// end to end: each module's protocol says its messages and what each is answered with. The ports
// (PanelToBackground, WidgetRunEvent) are typed apart.
import { browser, type Browser } from 'wxt/browser';
import type { AudioMessage, AudioReplies } from '../audio/protocol';
import type { PageMessage, PageReplies, PageResponse, PageResult, PageScriptMessage } from '../page/protocol';
import type { RecordingMessage, RecordingReplies } from '../recording/protocol';
import type { SpeechMessage, SpeechReplies } from '../speech/protocol';
import type { VoiceMessage, VoiceReplies } from '../voice/protocol';
import type { WidgetMessage, WidgetReplies } from '../widget/protocol';
import type { CoreMessage, CoreReplies } from './protocol';

type RuntimeMessage = CoreMessage | WidgetMessage | PageScriptMessage | RecordingMessage | AudioMessage | SpeechMessage | VoiceMessage;
type RuntimeType = RuntimeMessage['type'];
export type MessageOf<T extends RuntimeType> = Extract<RuntimeMessage, { type: T }>;
type Replies = CoreReplies & WidgetReplies & PageReplies & RecordingReplies & AudioReplies & SpeechReplies & VoiceReplies;
// What a message is answered with; a page request, with its op's result.
type ReplyOf<M extends RuntimeMessage> = M extends PageMessage<infer R> ? PageResponse<PageResult<R>> : Replies[M['type']];

// Sent to the extension's pages and the background. Undefined when nobody answered. Not async: a
// script cut off from the extension (reloaded) throws at once, as sendMessage does.
export function sendRuntime<M extends RuntimeMessage>(message: M): Promise<ReplyOf<M> | undefined> {
  return browser.runtime.sendMessage<M, ReplyOf<M> | undefined>(message); // the wire is untyped: here only
}

// Sent to a tab's content scripts (the widget, page-agent).
export function sendTab<M extends RuntimeMessage>(tabId: number, message: M): Promise<ReplyOf<M> | undefined> {
  return browser.tabs.sendMessage<M, ReplyOf<M> | undefined>(tabId, message);
}

const isMessage = <T extends RuntimeType>(msg: unknown, type: T): msg is MessageOf<T> =>
  typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === type;

// Handles the messages of one type: the handler's answer goes back (a promise's, once it settles);
// nothing (undefined) leaves the message to the other listeners. Returns the listener's removal.
export function onRuntime<T extends RuntimeType>(
  type: T,
  handler: (msg: MessageOf<T>, sender: Browser.runtime.MessageSender) => ReplyOf<MessageOf<T>> | Promise<ReplyOf<MessageOf<T>>> | void,
): () => void {
  const listener = (msg: unknown, sender: Browser.runtime.MessageSender, sendResponse: (reply: unknown) => void) => {
    if (!isMessage(msg, type)) return;
    const reply = handler(msg, sender);
    if (reply instanceof Promise) {
      reply.then(sendResponse, (e: unknown) => {
        console.error(`[${type}]`, e);
        sendResponse(undefined);
      });
      return true; // async response
    }
    if (reply !== undefined) sendResponse(reply);
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
