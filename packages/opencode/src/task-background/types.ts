import type { SessionID } from "../session/schema"

export type BackgroundTaskStatus = "running" | "completed" | "failed" | "killed"

export interface BackgroundTaskEntry {
  readonly task_id: string
  readonly parent_session_id: SessionID
  readonly child_session_id: SessionID
  readonly agent_name: string
  readonly description: string
  readonly started_at: number
  status: BackgroundTaskStatus
  ended_at?: number
  result?: string
  error?: string
  abort: AbortController
  fiber?: unknown
}

export interface BackgroundTaskSnapshot {
  readonly task_id: string
  readonly parent_session_id: SessionID
  readonly child_session_id: SessionID
  readonly agent_name: string
  readonly description: string
  readonly started_at: number
  readonly status: BackgroundTaskStatus
  readonly ended_at?: number
  readonly result?: string
  readonly error?: string
}

export function snapshot(entry: BackgroundTaskEntry): BackgroundTaskSnapshot {
  return {
    task_id: entry.task_id,
    parent_session_id: entry.parent_session_id,
    child_session_id: entry.child_session_id,
    agent_name: entry.agent_name,
    description: entry.description,
    started_at: entry.started_at,
    status: entry.status,
    ended_at: entry.ended_at,
    result: entry.result,
    error: entry.error,
  }
}

export * as TaskBackgroundTypes from "./types"
