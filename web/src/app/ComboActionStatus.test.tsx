import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import type { ComboReceiptState } from "@/lib/receipt";
import { ComboActionStatus } from "./ComboActionStatus";

const HASH = "0x7c4a8d09ca3762af61e59520943dc26494f8941b1c2d5e8f2f0a31b2eaf4c9a1" as Hex;
const EXPLORER = `https://monadscan.com/tx/${HASH}`;

const noop = () => {};

function markup(state: ComboReceiptState) {
  return renderToStaticMarkup(
    <ComboActionStatus state={state} onRetry={noop} onDismiss={noop} />,
  );
}

type ButtonElement = ReactElement<{
  onClick: () => void;
  type?: string;
  "aria-disabled"?: boolean;
  children?: ReactNode;
}>;

/** Every <button> in the rendered tree, so a layout wrapper cannot hide one. */
function buttonsIn(node: ReactNode): ButtonElement[] {
  const found: ButtonElement[] = [];
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    if (child.type === "button") found.push(child as ButtonElement);
    const { children } = child.props as { children?: ReactNode };
    if (children) found.push(...buttonsIn(children));
  }
  return found;
}

/** [retry, startOver] for the failed-lookup state. */
function controls(retrying: boolean, handlers: { onRetry?: () => void; onDismiss?: () => void } = {}) {
  const tree = ComboActionStatus({
    state: { kind: "lookupFailed", hash: HASH, retrying },
    onRetry: handlers.onRetry ?? noop,
    onDismiss: handlers.onDismiss ?? noop,
  });
  return buttonsIn((tree as ReactElement<{ children: ReactNode }>).props.children);
}

describe("ComboActionStatus", () => {
  it("renders nothing before a transaction is broadcast", () => {
    expect(markup({ kind: "idle" })).toBe("");
  });

  it("links a pending lookup to the explorer", () => {
    const html = markup({ kind: "pending", hash: HASH });

    expect(html).toContain("Pending confirmation");
    expect(html).toContain(EXPLORER);
    expect(html).not.toContain('role="alert"');
  });

  it("links a confirmed combo to the explorer", () => {
    const html = markup({ kind: "confirmed", hash: HASH });

    expect(html).toContain("Confirmed on Monad");
    expect(html).toContain(EXPLORER);
  });

  it("announces a failed lookup, keeps the hash, and does not call the combo failed", () => {
    const html = markup({ kind: "lookupFailed", hash: HASH, retrying: false });

    expect(html).toContain("Confirmation unknown");
    // The hash is the only way left to find out what happened, so it stays.
    expect(html).toContain(EXPLORER);
    expect(html).not.toContain("Pending confirmation");
    expect(html).not.toContain("Confirmed on Monad");
    expect(html).toContain("may still have gone through");
  });

  it("puts the live region on the message alone, not around the controls", () => {
    // Announcing the whole block would repeat the heading and both buttons
    // every time the retry label changes.
    const html = markup({ kind: "lookupFailed", hash: HASH, retrying: false });

    expect(html).toContain('<p class="receipt-unknown-note" role="alert">');
    expect(html).not.toContain('<div class="receipt-unknown" role="alert">');
  });

  it("offers both ways out only on a failed lookup", () => {
    const [retry, startOver] = controls(false);
    expect(retry.props.children).toBeDefined();
    expect(startOver.props.children).toBe("Start over");

    for (const state of [
      { kind: "pending", hash: HASH },
      { kind: "confirmed", hash: HASH },
    ] satisfies ComboReceiptState[]) {
      expect(markup(state)).not.toContain("Check again");
      expect(markup(state)).not.toContain("Start over");
    }
  });

  it("marks only the retry busy while a read is running, and leaves the way out open", () => {
    const html = markup({ kind: "lookupFailed", hash: HASH, retrying: true });
    expect(html).toContain("Checking again");
    expect(html).not.toContain("Check again<");

    const [retry, startOver] = controls(true);
    expect(retry.props["aria-disabled"]).toBe(true);
    // Starting over must stay usable: the read can run for the whole timeout,
    // and being unable to leave during it is the dead end this change removes.
    expect(startOver.props["aria-disabled"]).toBeFalsy();

    const [idleRetry] = controls(false);
    expect(idleRetry.props["aria-disabled"]).toBe(false);
  });

  it("ignores a second retry while one is already running", () => {
    const onRetry = vi.fn();
    // aria-disabled leaves the button clickable on purpose, so the guard has
    // to be in the handler.
    const [retry] = controls(true, { onRetry });
    retry.props.onClick();

    expect(onRetry).not.toHaveBeenCalled();
  });

  it("wires each control to the callback it is given", () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const [retry, startOver] = controls(false, { onRetry, onDismiss });

    expect(retry.props.type).toBe("button");
    expect(startOver.props.type).toBe("button");

    retry.props.onClick();
    startOver.props.onClick();

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
