import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "../../project/instance"
import { TaskBackgroundRegistry } from "../../task-background/registry"
import { SessionID } from "../../session/schema"
import { EOL } from "os"

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

export const TasksCommand = cmd({
  command: "tasks",
  describe: "list active background tasks for a session",
  builder: (yargs: Argv) =>
    yargs.option("session-id", {
      type: "string",
      alias: ["s"],
      describe: "parent session id to filter on (required)",
      demandOption: true,
    }),
  async handler(args) {
    const parent = args.sessionId
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const program = Effect.gen(function* () {
          const reg = yield* TaskBackgroundRegistry.Service
          const list = yield* reg.list(SessionID.make(parent))
          if (list.length === 0) {
            process.stdout.write(`No background tasks for session ${parent}.` + EOL)
            return
          }
          const now = Date.now()
          const lines: string[] = [
            `Background tasks for session ${parent}:`,
            "",
            ["task_id", "agent", "status", "elapsed", "description"].join("\t"),
          ]
          for (const t of list) {
            const elapsed = t.ended_at
              ? fmtElapsed(t.ended_at - t.started_at)
              : fmtElapsed(now - t.started_at)
            lines.push([t.task_id, t.agent_name, t.status, elapsed, t.description].join("\t"))
          }
          process.stdout.write(lines.join(EOL) + EOL)
        }).pipe(Effect.provide(TaskBackgroundRegistry.defaultLayer))
        await AppRuntime.runPromise(program as unknown as Effect.Effect<void, never, never>)
      },
    })
  },
})
