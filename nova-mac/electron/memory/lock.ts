// Serializes memory writes per user so two writers on the same turn (the regex
// auto-capture pipeline and Claude's own save_memory tool call both run inside
// the same process) can't race the same duplicate-check query against a DB
// state that doesn't yet reflect the other's not-yet-committed write.
const queues = new Map<string, Promise<unknown>>();

export function withUserMemoryLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prior = queues.get(userId) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  // Swallow rejections in the chain itself so one failed save doesn't wedge
  // the queue for subsequent saves — the real error still propagates to the
  // caller of this specific call via `next`.
  queues.set(
    userId,
    next.catch(() => undefined),
  );
  return next;
}
