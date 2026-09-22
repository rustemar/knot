import { AlertTriangle, Check, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";

import { type ComboReceiptState, explorerTxUrl } from "@/lib/receipt";

/**
 * The action area once a combo has been broadcast.
 *
 * Presentational: it is handed the receipt state, a way to read the receipt
 * again and a way to clear the finished attempt, and holds no wallet write of
 * its own.
 */
export function ComboActionStatus({
  state,
  onRetry,
  onDismiss,
}: {
  state: ComboReceiptState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (state.kind === "idle") return null;

  const href = explorerTxUrl(state.hash);

  if (state.kind === "confirmed") {
    return (
      <a className="primary-action confirmed" href={href} target="_blank" rel="noreferrer">
        <Check size={18} /> Confirmed on Monad <ExternalLink size={15} />
      </a>
    );
  }

  if (state.kind === "pending") {
    return (
      <a className="primary-action pending" href={href} target="_blank" rel="noreferrer">
        <LoaderCircle className="spin" size={18} /> Pending confirmation <ExternalLink size={15} />
      </a>
    );
  }

  const retrying = state.retrying;

  return (
    <div className="receipt-unknown" aria-busy={retrying || undefined}>
      <a className="primary-action unknown" href={href} target="_blank" rel="noreferrer">
        <AlertTriangle size={18} /> Confirmation unknown <ExternalLink size={15} />
      </a>
      {/* The live region is the message on its own. With the controls inside
          it, every label change would re-announce the whole block. */}
      <p className="receipt-unknown-note" role="alert">
        Receipt lookup failed. The combo may still have gone through, so check the explorer or read
        the receipt again.
      </p>
      <div className="receipt-unknown-actions">
        <button
          type="button"
          className="receipt-action"
          // aria-disabled rather than disabled: a disabled button drops focus
          // to the top of the document, which strands whoever just pressed it.
          // The guard therefore lives in the handler.
          aria-disabled={retrying}
          onClick={() => {
            if (!retrying) onRetry();
          }}
        >
          {retrying ? (
            <>
              <LoaderCircle className="spin" size={15} /> Checking again
            </>
          ) : (
            <>
              <RefreshCw size={15} /> Check again
            </>
          )}
        </button>
        {/* Never blocked while a read is running: that read can take the whole
            timeout, and being unable to leave during it is the dead end this
            change exists to remove. */}
        <button type="button" className="receipt-action quiet" onClick={onDismiss}>
          Start over
        </button>
      </div>
    </div>
  );
}
