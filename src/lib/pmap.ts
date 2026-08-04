/**
 * Run an async mapper over items with bounded concurrency, preserving order.
 * Used to personalize a campaign's recipients a few at a time rather than all at
 * once (LLM rate limits) or strictly serially (too slow).
 */
export async function pMap<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await mapper(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
