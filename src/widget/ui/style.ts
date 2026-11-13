// The page widget's sizes and look, inside its closed shadow roots (the bubble and the floating chat).
import TOKENS from '../../ui/tokens.css?raw';
import MARKDOWN_CSS from '../../ui/markdown.css?raw';
import { ACTIONS_GAP } from '../actions-fan';
import { ACTIONS_SIZES } from '../actions-look';

export const BUBBLE = 44; // px
export const MIN_W = 220; // the card's smallest size, px
export const MIN_H = 80;
export const BAR = 30; // the floating chat's bar, by which it is moved: always kept inside the window

// The theme's colors and the chat's Markdown look (Settings → Appearance), inside the shadow root.
const THEME = TOKENS.replaceAll(':root[data-theme="dark"]', ':host([data-theme="dark"])').replaceAll(':root', ':host');

// The bubble's look (Settings → Bubble, widget/bubble-face): a shape drawn in --fill, its lines in
// --ink, its hat in its own colors and never taking the pointer (the bubble is dragged by its body).
// The face reacts to the folded floating chat: it thinks while it works (as chosen), opens its eyes
// and mouth while it waits for you, and smiles once it answered.
const BUBBLE_LOOK = `
  .bubble[data-bare] { background: none; box-shadow: none; }
  .bubble[data-bare] .face > svg { filter: drop-shadow(0 3px 5px rgba(0,0,0,.25)); }
  .face > svg { pointer-events: none; }
  .face > svg.own { width: 26px; height: 26px; color: var(--ink); }
  .bubble[data-bare] .face > svg.own { width: ${BUBBLE}px; height: ${BUBBLE}px; color: var(--fill); }
  .look { display: block; overflow: visible; }
  .look .body { fill: var(--fill); }
  .look .rounded { stroke: var(--fill); stroke-linejoin: round; }
  .look .ink { stroke: var(--ink); }
  .look .ink-fill { fill: var(--ink); }
  .look .pupil { transform: translate(calc(var(--lx, 0) * 2px), calc(var(--ly, 0) * 2px)); transition: transform 80ms linear; }
  .eyes-dots .pupil { transform: translate(calc(var(--lx, 0) * 1.4px), calc(var(--ly, 0) * 1.4px)); }
  .eyes-big .pupil { transform: translate(calc(var(--lx, 0) * 2.6px), calc(var(--ly, 0) * 2.6px)); }
  .eyes-cyclops .pupil { transform: translate(calc(var(--lx, 0) * 3px), calc(var(--ly, 0) * 3px)); }
  .eyes-sleepy .pupil { transform: translate(calc(var(--lx, 0) * 1.4px), 0); }
  .look .eye, .look .eyes, .look .bodies, .look .dot, .look .bar { transform-box: fill-box; transform-origin: center; }
  .blinks .eye { animation: ba-blink var(--blink, 5s) infinite; }
  .idle-breathe .bodies { animation: ba-breathe 4s ease-in-out infinite; }
  .idle-bob { animation: ba-bob 3s ease-in-out infinite; }
  .idle-squish { transform-origin: 50% 100%; animation: ba-squish 2.4s ease-in-out infinite; }
  .look .blob { animation: ba-blob 6s ease-in-out infinite alternate; }
  .mouth:not(.rest) { display: none; }
  .bubble.working[data-think="face"] .mouth.rest, .bubble.waiting .mouth.rest, .bubble.unseen .mouth.rest { display: none; }
  .bubble.working[data-think="face"] .mouth.think, .bubble.waiting .mouth.wait, .bubble.unseen .mouth.done { display: inline; }
  .bubble.working[data-think="face"] .pupil { animation: ba-ponder 2.4s ease-in-out infinite; }
  .bubble.waiting .eyes { transform: scale(1.2); }
  .bubble.waiting .eye { animation: none; }
  .bubble.working .look .dot { animation: ba-hop-dot 1.2s ease-in-out infinite; }
  .bubble.working .look .bar { animation: ba-bar 1s ease-in-out infinite; }
  .look .dot:nth-child(2) { animation-delay: .15s; } .look .dot:nth-child(3) { animation-delay: .3s; }
  /* Bars out of step, as an equalizer. */
  .look .bar:nth-child(2) { animation-delay: .3s; } .look .bar:nth-child(3) { animation-delay: .15s; } .look .bar:nth-child(4) { animation-delay: .45s; }
  @keyframes ba-blink { 0%, 95%, 100% { transform: scaleY(1); } 97.5% { transform: scaleY(.1); } }
  @keyframes ba-breathe { 50% { transform: scale(1.04); } }
  @keyframes ba-bob { 50% { transform: translateY(-3px); } }
  @keyframes ba-squish { 50% { transform: scale(1.06, .92); } }
  @keyframes ba-blob { to { d: path('M20 3C32 1 43 11 41 23S31 43 20 41 1 31 3 20 9 4 20 3Z'); } }
  @keyframes ba-ponder { 0%, 100% { transform: translate(-1.5px, -2px); } 50% { transform: translate(1.5px, -2px); } }
  @keyframes ba-hop-dot { 30% { transform: translateY(-5px); } }
  @keyframes ba-bar { 50% { transform: scaleY(.4); } }`;

// The bubble's actions (Settings → Bubble → Actions, widget/actions-look), as the menu's data-* say;
// without them, the defaults: square, in a column, icons, large. A column opens up or down; a row
// beside the bubble, left or right; an arc or a ring puts each button where --dx and --dy say
// (widget/actions-fan). Names show only in a column, as pills. Their order stays the keyboard's.
const ACTIONS_LOOK = `
  .menu { --act: ${ACTIONS_SIZES.large}px; --act-x: max(20px, calc(var(--act) * .6)); --act-r: 4px; --at: calc((${BUBBLE}px - var(--act)) / 2);
    position: absolute; left: var(--at); display: flex; flex-direction: column; gap: ${ACTIONS_GAP}px; align-items: center; }
  .menu[data-size="medium"] { --act: ${ACTIONS_SIZES.medium}px; }
  .menu[data-size="small"] { --act: ${ACTIONS_SIZES.small}px; }
  .menu[data-shape="rounded"] { --act-r: calc(var(--act) * .28); }
  .menu[data-shape="circle"] { --act-r: 999px; }
  .menu .act { width: var(--act); height: var(--act); border-radius: var(--act-r); font-size: calc(var(--act) * .45); line-height: 1; animation: ba-act-in 120ms ease-out; }
  .menu .act.small { width: var(--act-x); height: var(--act-x); font-size: var(--fs-xs); color: var(--muted); }
  .act-name { display: none; }
  .menu.up { bottom: ${BUBBLE + ACTIONS_GAP}px; flex-direction: column-reverse; }
  .menu.down { top: ${BUBBLE + ACTIONS_GAP}px; }
  .menu[data-labels="name"] { align-items: flex-start; }
  .menu[data-labels="name"].left { left: auto; right: var(--at); align-items: flex-end; }
  .menu[data-labels="name"] .act:not(.small) { width: auto; max-width: 240px; display: flex; align-items: center; padding: 0 14px 0 0; }
  .menu[data-labels="name"] .act-icon { flex: none; width: calc(var(--act) - 2px); text-align: center; }
  .menu[data-labels="name"] .act-name { display: block; min-width: 0; font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .menu[data-labels="name"] .act.small { margin-inline: calc((var(--act) - var(--act-x)) / 2); }
  .menu[data-layout="row"] { top: var(--at); bottom: auto; flex-direction: row; }
  .menu[data-layout="row"].right { left: ${BUBBLE + ACTIONS_GAP}px; }
  .menu[data-layout="row"].left { left: auto; right: ${BUBBLE + ACTIONS_GAP}px; flex-direction: row-reverse; }
  .menu:is([data-layout="arc"], [data-layout="ring"]) { inset: 0; display: block; pointer-events: none; }
  .menu:is([data-layout="arc"], [data-layout="ring"]) .act { position: absolute; pointer-events: auto;
    left: calc(${BUBBLE / 2}px - var(--act) / 2); top: calc(${BUBBLE / 2}px - var(--act) / 2); transform: translate(var(--dx, 0px), var(--dy, 0px)); }
  .menu:is([data-layout="arc"], [data-layout="ring"]) .act.small { left: calc(${BUBBLE / 2}px - var(--act-x) / 2); top: calc(${BUBBLE / 2}px - var(--act-x) / 2); }
  @keyframes ba-act-in { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .menu .act { animation: none; } }`;

export const BUBBLE_TITLE = 'Agent: point here for its actions, click to open the chat';

export const STYLE = `
  /* all: initial leaves the custom properties: the page's own would reach the bubble's color and eyes. */
  /* The font on the host, inherited: bold, italic and headings keep their own weight and style. */
  :host { all: initial; --bubble: initial; --on-bubble: initial; --lx: 0; --ly: 0; --blink: initial;
    font: var(--fs-md)/1.45 var(--font-ui); }
  ${THEME}
  ${MARKDOWN_CSS}
  * { box-sizing: border-box; }
  button, input, textarea, select { font: inherit; }
  .markdown { font-family: var(--font-msg, var(--font-ui)); }
  .markdown pre { font-family: var(--font-msg-code, var(--font-code)); font-size: var(--fs-sm); }
  .markdown h1, .markdown h2, .markdown h3, .markdown h4 { font-weight: 600; }
  [hidden] { display: none !important; }
  .bubble, .act { display: grid; place-items: center; border-radius: 50%; cursor: pointer; user-select: none; touch-action: none;
    box-shadow: 0 3px 12px rgba(0,0,0,.22); border: 0; padding: 0; }
  /* --fill and --ink: the bubble's own color (Settings → Bubble), else the accent. */
  .bubble { --fill: var(--bubble, var(--accent)); --ink: var(--on-bubble, var(--on-accent));
    width: ${BUBBLE}px; height: ${BUBBLE}px; background: var(--fill); color: var(--ink); position: relative; }
  .face { display: grid; place-items: center; line-height: 1; }
  .count { position: absolute; top: -3px; right: -3px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; display: grid; place-items: center;
    background: var(--bg); color: var(--accent-text); border: 1px solid var(--accent); font-size: var(--fs-xs); font-weight: 700; line-height: 1; }
  .act.found { position: relative; }
  .act.found::after { content: ''; position: absolute; top: 1px; right: 1px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg); }
  .count.more::after { content: ''; position: absolute; top: -2px; left: -2px; width: 6px; height: 6px; border-radius: 50%; background: currentColor; border: 1px solid var(--bg); }
  .chat-icons { display: flex; gap: 6px; justify-content: flex-end; }
  .chat-icon { font-size: var(--fs-icon); }
  .act.found[data-badge]::after { content: attr(data-badge); width: auto; height: 14px; min-width: 14px; top: -4px; right: -6px; padding: 0 3px; border-radius: 7px; border-width: 1px; font-size: var(--fs-2xs); line-height: 12px; color: var(--bg); text-align: center; }
  ${BUBBLE_LOOK}
  /* The floating chat, folded: working (as Settings → Bubble says), waiting for you (amber, "!"), answered (a dot). */
  .bubble.working[data-think="ring"]::before { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid transparent;
    border-top-color: var(--fill); border-right-color: var(--fill); animation: ba-spin 1s linear infinite; pointer-events: none; }
  .bubble.working[data-think="pulse"]::before { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: 50%; background: var(--fill);
    animation: ba-pulse 1.4s ease-out infinite; pointer-events: none; }
  .thought { display: none; position: absolute; right: -16px; top: -20px; width: 26px; height: 16px; border-radius: 8px; gap: 2px; align-items: center; justify-content: center;
    background: var(--bg); border: 1px solid var(--border); box-shadow: 0 2px 6px rgba(0,0,0,.15); pointer-events: none; }
  .thought::after { content: ''; position: absolute; left: 2px; bottom: -6px; width: 5px; height: 5px; border-radius: 50%; background: var(--bg); border: 1px solid var(--border); }
  .thought i { width: 4px; height: 4px; border-radius: 50%; background: var(--muted); animation: ba-hop 1.2s ease-in-out infinite; }
  .thought i:nth-child(2) { animation-delay: .2s; } .thought i:nth-child(3) { animation-delay: .4s; }
  .bubble.working .thought { display: flex; }
  .bubble.waiting { --fill: var(--warn); --ink: var(--on-warn); animation: ba-nudge 0.6s ease-out 2; }
  .wait-mark { position: absolute; top: -3px; left: -3px; width: 17px; height: 17px; border-radius: 50%; display: grid; place-items: center;
    background: var(--bg); color: var(--fg); border: 1px solid var(--warn); font-size: var(--fs-xs); font-weight: 800; line-height: 1; }
  .bubble.unseen::after { content: ''; position: absolute; top: 0; left: 0; width: 10px; height: 10px; border-radius: 50%; background: var(--ok); border: 2px solid var(--bg); }
  @keyframes ba-spin { to { transform: rotate(360deg); } }
  @keyframes ba-nudge { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-5px); } }
  @keyframes ba-pulse { from { transform: scale(1); opacity: .5; } to { transform: scale(1.6); opacity: 0; } }
  @keyframes ba-hop { 30% { transform: translateY(-2px); } }
  @media (prefers-reduced-motion: reduce) {
    .bubble::before, .bubble.waiting, .face *, .face > svg { animation: none !important; }
    .look .pupil { transition: none; }
    .bubble.working[data-think="pulse"]::before { transform: scale(1.25); opacity: .35; }
    .bubble.working[data-think="face"] .pupil { transform: translate(0, -2px); }
  }
  .bubble.pinned { outline: 3px solid color-mix(in srgb, var(--accent) 40%, transparent); }
  .bubble:focus-visible, .act:focus-visible, button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .dragging { cursor: grabbing; }
  .act { background: var(--bg); color: var(--fg); border: 1px solid var(--border); }
  .act:hover, .act.on { background: var(--surface); color: var(--accent-text); }
  ${ACTIONS_LOOK}
  .pop { position: absolute; width: 290px; min-width: ${MIN_W}px; min-height: ${MIN_H}px; max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column;
    background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-pop); }
  .pop:focus { outline: none; }
  .pop-body { flex: 1; min-height: 0; overflow: auto; padding: 8px; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); align-content: start; }
  .rz { position: absolute; z-index: 1; touch-action: none; }
  .rz.n, .rz.s { left: 8px; right: 8px; height: 7px; cursor: ns-resize; } .rz.n { top: -3px; } .rz.s { bottom: -3px; }
  .rz.e, .rz.w { top: 8px; bottom: 8px; width: 7px; cursor: ew-resize; } .rz.e { right: -3px; } .rz.w { left: -3px; }
  .rz.ne, .rz.nw, .rz.se, .rz.sw { width: 12px; height: 12px; }
  .rz.ne { top: -4px; right: -4px; cursor: nesw-resize; } .rz.sw { bottom: -4px; left: -4px; cursor: nesw-resize; }
  .rz.nw { top: -4px; left: -4px; cursor: nwse-resize; } .rz.se { bottom: -4px; right: -4px; cursor: nwse-resize; }
  .pop.left { right: calc(${BUBBLE + 10}px + var(--clear, 0px)); } .pop.right { left: calc(${BUBBLE + 10}px + var(--clear, 0px)); }
  .pop.up { bottom: 0; } .pop.down { top: 0; }
  .pop-head { display: flex; align-items: center; gap: 6px; color: var(--muted); position: sticky; top: -8px; z-index: 1;
    margin: -8px -8px 0; padding: 8px 8px 4px; background: var(--bg); border-radius: 10px 10px 0 0; cursor: grab; user-select: none; touch-action: none; }
  .pop-head.dragging { cursor: grabbing; }
  .pop-head span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .answer { display: grid; gap: 8px; }
  button.chat { justify-self: start; padding: 4px 9px; border: 1px solid var(--border); background: var(--surface); color: var(--fg); border-radius: 6px; cursor: pointer; }
  button.chat:hover { border-color: var(--accent); color: var(--accent-text); }
  .icon { border: 0; background: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; color: var(--muted); }
  .icon:hover:not(:disabled) { background: var(--surface); }
  .icon:disabled { opacity: .4; cursor: default; }
  .ask { display: flex; gap: 6px; }
  .ask input { flex: 1; min-width: 0; padding: 5px 7px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); }
  .ask input:focus { outline: none; border-color: var(--accent); }
  button.run { padding: 5px 9px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); border-radius: 6px; cursor: pointer; }
  .boxes { display: grid; gap: 8px; }
  .box { border: 1px solid var(--border); border-radius: 8px; padding: 4px 8px 6px; }
  .box-head { display: flex; align-items: center; gap: 6px; }
  .box-label { flex: 1; min-width: 0; font-size: var(--fs-sm); font-weight: 600; color: var(--muted); }
  .box .copy { padding: 0 4px; }
  .box .speak { padding: 0 4px; display: grid; place-items: center; }
  .box .speak.off { opacity: .55; }
  .box .speak.waiting { outline: 1px dashed currentColor; outline-offset: -2px; opacity: .8; }
  .box .speak-note { font-size: var(--fs-sm); margin-top: 4px; }
  .box ul { margin: 2px 0 0; padding-left: 16px; }
  .box li { overflow-wrap: anywhere; }
  .box .markdown { overflow-wrap: anywhere; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  details.thinking { border-left: 2px solid var(--border); padding-left: 8px; }
  details.thinking summary { cursor: pointer; color: var(--muted); font-size: var(--fs-sm); }
  details.thinking .text { color: var(--muted); font-size: var(--fs-sm); max-height: 12em; overflow: auto; }
  .pop a { color: var(--link); }
  .muted { color: var(--muted); }
  .confirm { display: grid; gap: 6px; padding: 8px; border: 1px solid var(--accent); border-radius: 8px; background: var(--surface); }
  .confirm-summary { font-weight: 600; }
  .confirm pre.code { margin: 0; font-family: var(--font-code); font-size: var(--fs-sm); max-height: 10em; overflow: auto; }
  .decisions { display: flex; flex-wrap: wrap; gap: 6px; }
  button.decide { padding: 4px 9px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); border-radius: 6px; cursor: pointer; }
  button.decide.primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .error { color: var(--danger); overflow-wrap: anywhere; }
  .floating { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-float); }
  .floating-bar { height: ${BAR}px; flex: none; display: flex; align-items: center; gap: 2px; padding: 0 4px 0 10px; cursor: grab; user-select: none; touch-action: none;
    color: var(--muted); border-bottom: 1px solid var(--border); }
  .floating.maximized .floating-bar { cursor: default; }
  .floating-bar .pin { display: inline-flex; align-items: center; padding: 4px 6px; }
  .floating-bar .pin.on { color: var(--on-accent); background: var(--accent); }
  .floating-bar .pin.on:hover:not(:disabled) { background: var(--accent); opacity: .85; }
  .floating.maximized .rz { display: none; }
  .floating-bar span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Its own layer: in Vivaldi the frame, on top of the page, was left partly unpainted after scrolling inside it. */
  .floating iframe { flex: 1; min-height: 0; width: 100%; border: 0; border-radius: 0 0 10px 10px; background: var(--bg); will-change: transform; }
  /* Its handles lie outside it: anything over the frame, even see-through, makes the chat inside
     take it as covered (useSeen) and not let "Allow" be clicked. */
  .floating .rz.n, .floating .rz.s { left: 0; right: 0; height: 7px; } .floating .rz.n { top: -8px; } .floating .rz.s { bottom: -8px; }
  .floating .rz.e, .floating .rz.w { top: 0; bottom: 0; width: 7px; } .floating .rz.e { right: -8px; } .floating .rz.w { left: -8px; }
  .floating .rz.ne, .floating .rz.nw, .floating .rz.se, .floating .rz.sw { width: 9px; height: 9px; }
  .floating .rz.ne { top: -9px; right: -9px; } .floating .rz.nw { top: -9px; left: -9px; } .floating .rz.se { bottom: -9px; right: -9px; } .floating .rz.sw { bottom: -9px; left: -9px; }`;
