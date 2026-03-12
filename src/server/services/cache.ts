interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Simple TTL-based in-memory cache.
 * Keys are strings, values can be anything.
 */
export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();

  /** Get a cached value. Returns undefined if expired or not found. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /** Set a value with TTL in seconds. */
  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /** Remove a specific key. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Remove all keys matching a prefix. */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Check if a value is cached and not expired. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Get-or-set: return cached value, or call factory and cache the result. */
  async getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await factory();
    this.set(key, value, ttlSeconds);
    return value;
  }
}

/** Shared cache instance */
export const cache = new Cache();
