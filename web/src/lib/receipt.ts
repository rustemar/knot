import type { Hex } from "viem";

const EXPLORER_TX = "https://monadscan.com/tx/";

/**
 * What the action area knows about the combo transaction.
 *
 * `lookupFailed` means a receipt read has given up at least once, so whether
 * the transaction landed is unknown and the hash is the only way left to find
 * out. `retrying` is true while a read is running again.
 */
export type ComboReceiptState =
  | { kind: "idle" }
  | { kind: "pending"; hash: Hex }
  | { kind: "confirmed"; hash: Hex }
  | { kind: "lookupFailed"; hash: Hex; retrying: boolean };

export function explorerTxUrl(hash: Hex): string {
  return `${EXPLORER_TX}${hash}`;
}

/**
 * Derives the action state from the receipt query, so every branch that cares
 * reads the same answer from the same place.
 *
 * What remembers a failure is `errorUpdateCount`, not `isError`. A receipt
 * query holds no data while it is failing, and re-fetching a query that has no
 * data clears its error and puts the status back to pending. Keyed on
 * `isError` alone the failure would therefore blink back to "pending" for the
 * whole of every retry — and unprompted, since the client re-fetches on window
 * focus and the explorer link opens in another tab.
 */
export function comboReceiptState(query: {
  hash: Hex | undefined;
  isSuccess: boolean;
  isError: boolean;
  errorUpdateCount: number;
}): ComboReceiptState {
  if (!query.hash) return { kind: "idle" };
  // A receipt that arrived outranks a read that failed earlier, so a retry
  // that succeeds leaves the failure behind.
  if (query.isSuccess) return { kind: "confirmed", hash: query.hash };
  if (query.isError || query.errorUpdateCount > 0) {
    return { kind: "lookupFailed", hash: query.hash, retrying: !query.isError };
  }
  return { kind: "pending", hash: query.hash };
}
