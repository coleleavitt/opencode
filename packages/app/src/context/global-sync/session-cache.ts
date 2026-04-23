import type {
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@opencode-ai/sdk/v2/client"

export const SESSION_CACHE_LIMIT = 40
const DIFF_COUNT_WARN = 500
const DIFF_BYTES_WARN = 64 * 1024 * 1024

type SessionCache = {
  session_status: Record<string, SessionStatus | undefined>
  session_diff: Record<string, SnapshotFileDiff[] | undefined>
  todo: Record<string, Todo[] | undefined>
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
  permission: Record<string, PermissionRequest[] | undefined>
  question: Record<string, QuestionRequest[] | undefined>
}

export function sessionDiffStats(diffs: SnapshotFileDiff[] | undefined) {
  if (!diffs?.length) return { count: 0, bytes: 0 }
  let bytes = 0
  for (const d of diffs) bytes += (d.patch?.length ?? 0)
  return { count: diffs.length, bytes }
}

export function warnOversizedSessionDiff(sessionID: string, diffs: SnapshotFileDiff[] | undefined) {
  const s = sessionDiffStats(diffs)
  if (s.count >= DIFF_COUNT_WARN || s.bytes >= DIFF_BYTES_WARN) {
    console.warn("[session-cache] oversized diff", {
      sessionID,
      count: s.count,
      bytes: s.bytes,
      mb: +(s.bytes / 1048576).toFixed(2),
    })
  }
}

export function dropSessionCaches(store: SessionCache, sessionIDs: Iterable<string>) {
  const stale = new Set(Array.from(sessionIDs).filter(Boolean))
  if (stale.size === 0) return

  let droppedDiffMB = 0
  for (const key of Object.keys(store.part)) {
    const parts = store.part[key]
    if (!parts?.some((part) => stale.has(part?.sessionID ?? ""))) continue
    delete store.part[key]
  }

  for (const sessionID of stale) {
    droppedDiffMB += sessionDiffStats(store.session_diff[sessionID]).bytes / 1048576
    delete store.message[sessionID]
    delete store.todo[sessionID]
    delete store.session_diff[sessionID]
    delete store.session_status[sessionID]
    delete store.permission[sessionID]
    delete store.question[sessionID]
  }
  if (droppedDiffMB >= 16) {
    console.info("[session-cache] evicted", {
      sessions: stale.size,
      freedMB: +droppedDiffMB.toFixed(2),
    })
  }
}

export function pickSessionCacheEvictions(input: {
  seen: Set<string>
  keep: string
  limit: number
  preserve?: Iterable<string>
}) {
  const stale: string[] = []
  const keep = new Set([input.keep, ...Array.from(input.preserve ?? [])])
  if (input.seen.has(input.keep)) input.seen.delete(input.keep)
  input.seen.add(input.keep)
  for (const id of input.seen) {
    if (input.seen.size - stale.length <= input.limit) break
    if (keep.has(id)) continue
    stale.push(id)
  }
  for (const id of stale) {
    input.seen.delete(id)
  }
  return stale
}
