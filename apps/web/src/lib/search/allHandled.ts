/**
 * `Promise.all` drop-in that cannot leave siblings unhandled.
 *
 * `Promise.all` settles as soon as one input rejects, and the inputs still in
 * flight are left with no rejection handler attached. When those also fail —
 * the normal case here, since the search queries share one `pg` pool and fail
 * together when it is saturated — Node reports each as an `unhandledRejection`.
 * Reproducing #928 at concurrency 10 produced 9 of them alongside the 10 failed
 * requests.
 *
 * Attaching a no-op `catch` marks every input as handled. The returned promise
 * rejects with the first failure exactly as `Promise.all` does, so callers are
 * unaffected.
 *
 * The signature mirrors `lib.es2015.promise`'s `Promise.all` so tuple positions
 * survive inference — a plain `Promise<unknown>[]` parameter collapses the
 * result to a union and callers lose their per-element types.
 */
export function allHandled<T extends readonly unknown[] | []>(
  values: T
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  for (const value of values) {
    if (value instanceof Promise) value.catch(() => {});
  }
  return Promise.all(values);
}
