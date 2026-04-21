import path from "path"
import fs from "node:fs"
import { writeHeapSnapshot } from "node:v8"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Log } from "@/util/log"

const log = Log.create({ service: "heap" })
const MINUTE = 60_000
const LIMIT = 2 * 1024 * 1024 * 1024
const PAGE = 4096

function rss() {
  if (process.platform === "linux") {
    try {
      const stat = fs.readFileSync("/proc/self/statm", "utf8")
      const resident = Number.parseInt(stat.split(" ")[1] ?? "0", 10)
      if (Number.isFinite(resident) && resident > 0) return resident * PAGE
    } catch {}
  }
  return process.memoryUsage().rss
}

export namespace Heap {
  let timer: Timer | undefined
  let lock = false
  let armed = true

  export function start() {
    if (!Flag.OPENCODE_AUTO_HEAP_SNAPSHOT) return
    if (timer) return

    const run = async () => {
      if (lock) return

      const r = rss()
      if (r <= LIMIT) {
        armed = true
        return
      }
      if (!armed) return

      lock = true
      armed = false
      const file = path.join(
        Global.Path.log,
        `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
      )
      log.warn("heap usage exceeded limit", {
        rss: r,
        heap: process.memoryUsage().heapUsed,
        file,
      })

      await Promise.resolve()
        .then(() => writeHeapSnapshot(file))
        .catch((err) => {
          log.error("failed to write heap snapshot", {
            error: err instanceof Error ? err.message : String(err),
            file,
          })
        })

      lock = false
    }

    timer = setInterval(() => {
      void run()
    }, MINUTE)
    timer.unref?.()
  }
}
