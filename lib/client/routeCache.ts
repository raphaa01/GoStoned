// Short-lived, memory-only snapshots survive navigation without storing account data on disk.
type Entry = { value?: unknown; expires: number; pending?: Promise<unknown> };
const entries = new Map<string, Entry>();
const LIMIT = 32;

export function routeCacheKey(resource: string, owner: string) {
  return `${owner}:${resource}`;
}

export function cachedRouteData<T>(key: string, now = Date.now()): T | undefined {
  const entry = entries.get(key);
  return entry && entry.expires > now ? entry.value as T | undefined : undefined;
}

// A screen may paint its last snapshot while readRouteData revalidates it.
// Identity changes and mutations still remove snapshots through invalidation.
export function routeSnapshot<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined;
}

export function invalidateRouteData(key?: string) {
  if (key) entries.delete(key);
  else entries.clear();
}

export function readRouteData<T>(key: string, load: () => Promise<T>, ttl = 60_000): Promise<T> {
  const cached = cachedRouteData<T>(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = entries.get(key);
  if (existing?.pending) return existing.pending as Promise<T>;
  const entry: Entry = { value: existing?.value, expires: 0 };
  // Defer the loader so concurrent mounts share the same request, including in Strict Mode.
  const pending = Promise.resolve().then(load).then((value) => {
    if (entries.get(key) === entry) {
      entry.value = value;
      entry.expires = Date.now() + ttl;
      entry.pending = undefined;
    }
    return value;
  }, (error: unknown) => {
    if (entries.get(key) === entry) {
      entry.pending = undefined;
      if (entry.value === undefined) entries.delete(key);
    }
    throw error;
  });
  entry.pending = pending;
  entries.delete(key);
  entries.set(key, entry);
  while (entries.size > LIMIT) entries.delete(entries.keys().next().value!);
  return pending;
}

export function puzzleRouteKey(mode: string, owner: string, now = new Date()) {
  return routeCacheKey(`puzzles:${mode}:${now.toISOString().slice(0, 10)}`, owner);
}
