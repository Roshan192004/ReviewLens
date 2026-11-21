export function isRetryable(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;
  if (typeof status === "number") return false;

  const code = error?.code;
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  ) || !status;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withBackoff(
  fn,
  {
    maxAttempts = 5,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    isRetryable: retryable = isRetryable,
    sleep = defaultSleep,
    random = Math.random,
    onRetry,
  } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !retryable(error)) throw error;

      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const retryAfterMs =
        typeof error?.retryAfterMs === "number" && error.retryAfterMs >= 0
          ? error.retryAfterMs
          : 0;
      // Equal jitter: randomize between zero and the exponential delay.
      const jittered = Math.floor(exponential * Math.min(1, Math.max(0, random())));
      const delayMs = Math.min(maxDelayMs, Math.max(jittered, retryAfterMs));
      onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
