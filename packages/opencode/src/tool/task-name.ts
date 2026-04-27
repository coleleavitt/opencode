export const TASK_TOOL_NAMES = ["task", "agent"] as const

export type TaskToolName = (typeof TASK_TOOL_NAMES)[number]

const taskToolNameSet: ReadonlySet<string> = new Set<string>(TASK_TOOL_NAMES)

export function isTaskToolName(name: string | undefined | null): name is TaskToolName {
  if (typeof name !== "string") return false
  return taskToolNameSet.has(name)
}

export const TASK_PERMISSION_KEY = "task" as const

export function normalizeTaskPermissionKey(name: string): string {
  return isTaskToolName(name) ? TASK_PERMISSION_KEY : name
}

export * as TaskName from "./task-name"
