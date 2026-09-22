import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { comboReceiptState, explorerTxUrl } from "./receipt";

const HASH = "0x7c4a8d09ca3762af61e59520943dc26494f8941b1c2d5e8f2f0a31b2eaf4c9a1" as Hex;

type Query = Parameters<typeof comboReceiptState>[0];

function state(overrides: Partial<Query> = {}) {
  return comboReceiptState({
    hash: HASH,
    isSuccess: false,
    isError: false,
    errorUpdateCount: 0,
    ...overrides,
  });
}

describe("combo receipt state", () => {
  it("has nothing to report before a transaction is broadcast", () => {
    expect(state({ hash: undefined })).toEqual({ kind: "idle" });
  });

  it("waits while the first read is still in flight", () => {
    expect(state()).toEqual({ kind: "pending", hash: HASH });
  });

  it("confirms once the receipt arrives", () => {
    expect(state({ isSuccess: true })).toEqual({ kind: "confirmed", hash: HASH });
  });

  it("gives a failed lookup its own state and keeps the hash to check it with", () => {
    expect(state({ isError: true, errorUpdateCount: 1 })).toEqual({
      kind: "lookupFailed",
      hash: HASH,
      retrying: false,
    });
  });

  it("stays failed while a read runs again, even though the query says pending", () => {
    // This is the shape a real retry takes. The query holds no data while it
    // is failing, so re-fetching clears the error and resets the status to
    // pending; only the error count remembers. Reading isError alone here put
    // the UI back on "Pending confirmation" for the whole retry — and on every
    // window focus, because the client re-fetches then and the explorer link
    // opens in another tab.
    expect(state({ isError: false, errorUpdateCount: 1 })).toEqual({
      kind: "lookupFailed",
      hash: HASH,
      retrying: true,
    });
  });

  it("prefers an arrived receipt over a remembered failure", () => {
    expect(state({ isSuccess: true, errorUpdateCount: 2 })).toEqual({
      kind: "confirmed",
      hash: HASH,
    });
  });

  it("points the explorer at the transaction", () => {
    expect(explorerTxUrl(HASH)).toBe(`https://monadscan.com/tx/${HASH}`);
  });
});
