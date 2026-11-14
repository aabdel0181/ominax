const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(",");

/** Includes focused descendants of open shadow roots, whose key events target the host. */
export function isEditableFocused(target: EventTarget | null = document.activeElement): boolean {
  let element = target instanceof Element ? target : null;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element !== null && element.closest(EDITABLE_SELECTOR) !== null;
}

// Chromium on Linux pastes PRIMARY into the focused editable unless the middle mouseup is cancelled.
export function preventMiddleClickPasteOutsideEditable(event: {
  readonly button: number;
  readonly target: EventTarget | null;
  preventDefault(): void;
}) {
  if (event.button !== 1 || isEditableFocused(event.target)) return;
  event.preventDefault();
}
