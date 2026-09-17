// Polyfills for web APIs newer than CEP 12's Chromium 99 that our dependencies use.
// Found by scanning the bundles (see docs/SPIKES.md): only AbortSignal.reason and
// AbortSignal.throwIfAborted (both Chromium 100) are missing.

type SignalWithReason = AbortSignal & { __lmlReason?: unknown };

const signalProto = AbortSignal.prototype as SignalWithReason;

if (!("reason" in AbortSignal.prototype)) {
  const originalAbort = AbortController.prototype.abort;
  AbortController.prototype.abort = function (this: AbortController, reason?: unknown) {
    (this.signal as SignalWithReason).__lmlReason =
      reason === undefined ? new DOMException("signal is aborted without reason", "AbortError") : reason;
    return originalAbort.call(this, reason);
  };
  Object.defineProperty(AbortSignal.prototype, "reason", {
    configurable: true,
    get(this: SignalWithReason) {
      return this.aborted ? this.__lmlReason : undefined;
    }
  });
}

if (typeof signalProto.throwIfAborted !== "function") {
  signalProto.throwIfAborted = function (this: AbortSignal) {
    if (this.aborted) throw this.reason ?? new DOMException("signal is aborted without reason", "AbortError");
  };
}

export {};
