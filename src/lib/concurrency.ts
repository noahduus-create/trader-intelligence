/**
 * Runs `fn` over `items` with at most `concurrency` calls in flight at a time.
 * Returns results in the SAME order as the input array.
 *
 * Behavior on errors: the first rejection causes the returned promise to
 * reject. Workers already running complete in the background (no cancellation),
 * but their results are discarded.
 */
export async function mapWithConcurrency<I, O>(
  items: readonly I[],
  concurrency: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  if (concurrency < 1) throw new Error(`mapWithConcurrency: concurrency must be >= 1, got ${concurrency}`);
  if (items.length === 0) return [];

  const results: O[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
