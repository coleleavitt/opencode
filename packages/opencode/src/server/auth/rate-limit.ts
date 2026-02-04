export namespace RateLimit {
  const windows = new Map<string, number[]>()
  const MAX_ATTEMPTS = 5
  const WINDOW_MS = 60 * 1000

  export function check(identifier: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now()
    const attempts = (windows.get(identifier) ?? []).filter((t) => now - t < WINDOW_MS)
    windows.set(identifier, attempts)
    if (attempts.length >= MAX_ATTEMPTS) {
      const oldest = attempts[0]
      return { allowed: false, remaining: 0, resetMs: WINDOW_MS - (now - oldest) }
    }
    return { allowed: true, remaining: MAX_ATTEMPTS - attempts.length, resetMs: 0 }
  }

  export function record(identifier: string) {
    const now = Date.now()
    const attempts = (windows.get(identifier) ?? []).filter((t) => now - t < WINDOW_MS)
    attempts.push(now)
    windows.set(identifier, attempts)
  }

  setInterval(
    () => {
      const now = Date.now()
      for (const [key, attempts] of windows) {
        const active = attempts.filter((t) => now - t < WINDOW_MS)
        if (active.length === 0) windows.delete(key)
        else windows.set(key, active)
      }
    },
    5 * 60 * 1000,
  )
}
