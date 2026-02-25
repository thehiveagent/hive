export function isTransientError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /429|503|timeout|temporarily unavailable|rate limit/i.test(message);
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function* withFirstTokenTimeout<T>(
  iterable: AsyncIterable<T>,
  timeoutMs: number,
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  let firstReceived = false;
  const timeoutMarker = Symbol("timeout");

  try {
    while (true) {
      const nextPromise = iterator.next();
      const result = !firstReceived
        ? await Promise.race([nextPromise, delayWithValue(timeoutMs, timeoutMarker)])
        : await nextPromise;

      if (result === timeoutMarker) {
        throw new Error("Provider timeout: no response within 30 seconds.");
      }

      if (result.done) {
        return;
      }

      firstReceived = true;
      yield result.value;
    }
  } finally {
    await iterator.return?.();
  }
}

async function delayWithValue<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
