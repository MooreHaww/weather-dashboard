// "Close Weather Dashboard?" (v1.9): shown when the main process asks (closeBehavior 'ask'). Same pattern as the
// "Restart now?" confirmation (updateNote.ts): glass box, focus trap, Escape handled inside. It sits over the whole page
// (the Settings panel too), so everything else in <body> is inert while it is open.
// - "Keep running" hides the window, "Exit" quits. Both answer through window.background.choose ('hide' | 'exit').
// - "Remember my choice" first saves the choice as the setting (the normal settings route), then answers.
// - Escape closes the dialog and keeps the window open; nothing is sent.

import type { CloseBehavior } from '../../shared/types';

export type CloseChoice = 'exit' | 'hide';

declare global {
  interface Window {
    background?: {
      onCloseRequest(callback: () => void): void;
      choose(choice: CloseChoice): void;
    };
  }
}

export const CLOSE_TITLE = 'Close Weather Dashboard?';
export const BEHAVIOR_FOR: Record<CloseChoice, CloseBehavior> = { hide: 'background', exit: 'exit' };

export interface CloseDialogDeps {
  /** Save the remembered choice (PATCH /api/settings) and update the page's own copy. Failures are ignored. */
  remember: (behavior: CloseBehavior) => Promise<unknown>;
  /** Send the answer to the main process. */
  choose: (choice: CloseChoice) => void;
}

/** Open the dialog (does nothing if it is already open). Returns the layer, for tests. */
export function showCloseDialog(deps: CloseDialogDeps): HTMLElement {
  const existing = document.getElementById('close-confirm');
  if (existing) return existing;
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const behind = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
  const wasInert = new Map(behind.map((el) => [el, el.inert]));

  const layer = document.createElement('div');
  layer.className = 'confirm close-confirm';
  layer.id = 'close-confirm';
  layer.tabIndex = -1;
  layer.innerHTML =
    '<div class="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="close-confirm-title">' +
    '<h3 class="confirm-title" id="close-confirm-title"></h3>' +
    '<label class="check"><input type="checkbox" id="close-remember"><span>Remember my choice</span></label>' +
    '<div class="confirm-actions">' +
    '<button type="button" class="button button-primary" data-action="hide">Keep running</button>' +
    '<button type="button" class="button" data-action="exit">Exit</button>' +
    '</div></div>';
  layer.querySelector('#close-confirm-title')!.textContent = CLOSE_TITLE;
  const remember = layer.querySelector<HTMLInputElement>('#close-remember')!;
  const hide = layer.querySelector<HTMLButtonElement>('[data-action="hide"]')!;
  const exit = layer.querySelector<HTMLButtonElement>('[data-action="exit"]')!;
  const order = [remember, hide, exit];

  const close = () => {
    layer.remove();
    behind.forEach((el) => (el.inert = wasInert.get(el) ?? false));
    returnTo?.focus();
  };
  let answered = false;
  const answer = async (choice: CloseChoice) => {
    if (answered) return;
    answered = true;
    const keep = remember.checked;
    close();
    if (keep) await deps.remember(BEHAVIOR_FOR[choice]).catch(() => {});
    deps.choose(choice);
  };
  hide.addEventListener('click', () => void answer('hide'));
  exit.addEventListener('click', () => void answer('exit'));
  layer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const i = order.indexOf(document.activeElement as HTMLButtonElement);
      const next = (i + (e.shiftKey ? order.length - 1 : 1)) % order.length;
      order[i < 0 ? 0 : next]!.focus();
    }
  });

  behind.forEach((el) => (el.inert = true));
  document.body.append(layer);
  hide.focus();
  return layer;
}
