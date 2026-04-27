import { describe, expect, test } from "bun:test"
import { TASK_TOOL_NAMES, TASK_PERMISSION_KEY, isTaskToolName, normalizeTaskPermissionKey } from "../../src/tool/task-name"
import { Permission } from "../../src/permission"

describe("task-name", () => {
  test("TASK_TOOL_NAMES includes both canonical and alias", () => {
    expect(TASK_TOOL_NAMES).toEqual(["task", "agent"])
  })

  test("TASK_PERMISSION_KEY is the canonical name", () => {
    expect(TASK_PERMISSION_KEY).toBe("task")
  })

  test("isTaskToolName accepts both task and agent", () => {
    expect(isTaskToolName("task")).toBe(true)
    expect(isTaskToolName("agent")).toBe(true)
  })

  test("isTaskToolName rejects unrelated names", () => {
    expect(isTaskToolName("read")).toBe(false)
    expect(isTaskToolName("task_status")).toBe(false)
    expect(isTaskToolName("Agent")).toBe(false)
    expect(isTaskToolName("")).toBe(false)
  })

  test("isTaskToolName tolerates undefined and null without throwing", () => {
    expect(isTaskToolName(undefined)).toBe(false)
    expect(isTaskToolName(null)).toBe(false)
  })

  test("normalizeTaskPermissionKey collapses agent to task", () => {
    expect(normalizeTaskPermissionKey("agent")).toBe("task")
    expect(normalizeTaskPermissionKey("task")).toBe("task")
  })

  test("normalizeTaskPermissionKey passes through non-task permissions", () => {
    expect(normalizeTaskPermissionKey("read")).toBe("read")
    expect(normalizeTaskPermissionKey("bash")).toBe("bash")
    expect(normalizeTaskPermissionKey("anything-else")).toBe("anything-else")
  })
})

describe("Permission.evaluate normalizes agent → task", () => {
  test("a deny rule on permission=task blocks invocation under permission=agent", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "task", pattern: "*", action: "deny" },
    ]
    const viaTask = Permission.evaluate("task", "explore", ruleset)
    const viaAgent = Permission.evaluate("agent", "explore", ruleset)
    expect(viaTask.action).toBe("deny")
    expect(viaAgent.action).toBe("deny")
  })

  test("an allow rule on permission=task allows invocation under permission=agent", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "task", pattern: "*", action: "allow" },
    ]
    expect(Permission.evaluate("agent", "anything", ruleset).action).toBe("allow")
  })

  test("non-task permissions evaluate normally (regression guard)", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "*", action: "deny" },
    ]
    expect(Permission.evaluate("read", "x", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "x", ruleset).action).toBe("deny")
  })
})
