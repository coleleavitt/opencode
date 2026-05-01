import { Effect, Semaphore } from "effect"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"

const locks = new Map<string, Semaphore.Semaphore>()

function get(filePath: string) {
  const resolved = AppFileSystem.resolve(filePath)
  const hit = locks.get(resolved)
  if (hit) return hit
  const next = Semaphore.makeUnsafe(1)
  locks.set(resolved, next)
  return next
}

export function withFileLock<A, E, R>(filePath: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return get(filePath).withPermits(1)(effect)
}

export function withMultiFileLock<A, E, R>(filePaths: string[], effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  const sorted = [...new Set(filePaths.map((p) => AppFileSystem.resolve(p)))].sort()
  return sorted.reduceRight((inner, p) => get(p).withPermits(1)(inner), effect)
}
