/**
 * Simple in-memory LRU cache for reducing latency
 * Used for session data, profiles, and embeddings
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private maxSize: number
  private defaultTTL: number // in milliseconds

  constructor(maxSize: number = 1000, defaultTTL: number = 60000) {
    this.maxSize = maxSize
    this.defaultTTL = defaultTTL
  }

  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    // Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.value
  }

  set(key: string, value: T, ttl?: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttl || this.defaultTTL),
    })
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// Profile cache - 5 minute TTL (profiles rarely change)
export const profileCache = new LRUCache<{
  id: string
  email: string
  name: string
}>(500, 5 * 60 * 1000)

// Session cache - 30 second TTL (messages may update frequently)
export const sessionCache = new LRUCache<{
  id: string
  user_id: string
  title: string
  model: string
  messages: Array<{ role: string; content: string }>
}>(200, 30 * 1000)

// Embedding cache - 10 minute TTL (embeddings are expensive but stable)
export const embeddingCache = new LRUCache<number[]>(1000, 10 * 60 * 1000)

// Export cache stats for monitoring
export function getCacheStats() {
  return {
    profiles: profileCache.size,
    sessions: sessionCache.size,
    embeddings: embeddingCache.size,
  }
}
