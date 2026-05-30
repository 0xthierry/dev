export function createLimiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 16));
  let active = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    active -= 1;
    queue.shift()?.();
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= boundedLimit) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
