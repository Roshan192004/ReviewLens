import { describe, it, expect, vi } from "vitest";
import { withBackoff, isRetryable } from "../src/utils/backoff.js";

function options(overrides = {}) {
  return {
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    sleep: vi.fn(async () => {}),
    random: () => 1,
    ...overrides,
  };
}

describe("withBackoff", () => {
  it("succeeds on first try without sleeping", async () => {
    const fn = vi.fn(async () => "ok");
    const opts = options();
    await expect(withBackoff(fn, opts)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it("retries 429 once and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValueOnce("ok");
    const opts = options();
    await expect(withBackoff(fn, opts)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(opts.sleep).toHaveBeenCalledTimes(1);
  });

  it("retries 500 and network errors, but not 400 or 401", async () => {
    for (const error of [
      Object.assign(new Error("server"), { status: 500 }),
      Object.assign(new Error("connection"), { code: "ECONNRESET" }),
    ]) {
      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("ok");
      await expect(withBackoff(fn, options())).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    }

    for (const status of [400, 401]) {
      const fn = vi.fn().mockRejectedValue(Object.assign(new Error("fail"), { status }));
      await expect(withBackoff(fn, options())).rejects.toMatchObject({ status });
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("gives up after max attempts and rethrows the last status error", async () => {
    const first = Object.assign(new Error("first"), { status: 500 });
    const last = Object.assign(new Error("last"), { status: 503 });
    const fn = vi.fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(last)
      .mockRejectedValue(last);
    await expect(withBackoff(fn, options({ maxAttempts: 3 }))).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("grows delays exponentially", async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error("server"), { status: 500 }));
    const opts = options({ maxAttempts: 4 });
    await expect(withBackoff(fn, opts)).rejects.toBeTruthy();
    expect(opts.sleep.mock.calls.map(([delay]) => delay)).toEqual([1000, 2000, 4000]);
  });

  it("caps delay at maxDelayMs", async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error("server"), { status: 500 }));
    const opts = options({ maxAttempts: 6, baseDelayMs: 1000, maxDelayMs: 3000 });
    await expect(withBackoff(fn, opts)).rejects.toBeTruthy();
    expect(opts.sleep.mock.calls.map(([delay]) => delay)).toEqual([1000, 2000, 3000, 3000, 3000]);
  });

  it("honours Retry-After when larger than computed delay", async () => {
    const error = Object.assign(new Error("limited"), { status: 429, retryAfterMs: 5000 });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("ok");
    const opts = options({ baseDelayMs: 1000, maxDelayMs: 30000 });
    await withBackoff(fn, opts);
    expect(opts.sleep).toHaveBeenCalledWith(5000);
  });

  it("calls onRetry with attempt, delay, and error", async () => {
    const error = Object.assign(new Error("limited"), { status: 429 });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("ok");
    const onRetry = vi.fn();
    await withBackoff(fn, options({ onRetry }));
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 1000,
      error,
    });
  });

  it("exports a default retryability classifier", () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 401 })).toBe(false);
    expect(isRetryable({ status: 500, code: "MISSING_API_KEY" })).toBe(false);
  });
});
