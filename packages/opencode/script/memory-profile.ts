import fs from "node:fs"
import { writeHeapSnapshot } from "node:v8"

const PAGE = 4096
const INTERVAL = 30_000
const SNAPSHOT_INTERVAL = 5 * 60_000
const TIMEOUT = Number(process.env.PROFILE_TIMEOUT) || 0

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

function mb(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2)
}

function stamp() {
  return new Date().toISOString()
}

const snapshots: string[] = []
const samples: number[] = []
const baseline = rss()
samples.push(baseline)

function snap() {
  const file = writeHeapSnapshot()
  snapshots.push(file)
  console.log(`[${stamp()}] Heap snapshot: ${file}`)
  return file
}

function log() {
  const r = rss()
  const heap = process.memoryUsage().heapUsed
  samples.push(r)
  console.log(`[${stamp()}] RSS: ${mb(r)} MB | Heap: ${mb(heap)} MB`)
}

function summary() {
  const peak = Math.max(...samples)
  const final = samples[samples.length - 1] ?? baseline
  const growth = final - baseline
  const elapsed = (Date.now() - start) / 1000
  const rate = elapsed > 0 ? growth / elapsed : 0

  console.log("\n--- Memory Profile Summary ---")
  console.log(`Duration:     ${elapsed.toFixed(1)}s`)
  console.log(`Baseline RSS: ${mb(baseline)} MB`)
  console.log(`Peak RSS:     ${mb(peak)} MB`)
  console.log(`Final RSS:    ${mb(final)} MB`)
  console.log(`Growth:       ${mb(growth)} MB (${rate > 0 ? "+" : ""}${mb(rate)} MB/s)`)
  console.log(`Samples:      ${samples.length}`)
  if (snapshots.length > 0) {
    console.log(`Snapshots:`)
    for (const s of snapshots) console.log(`  ${s}`)
  }
  console.log("------------------------------")
}

const start = Date.now()
console.log(`[${stamp()}] Memory profiler started (pid ${process.pid})`)
console.log(`[${stamp()}] RSS interval: ${INTERVAL / 1000}s | Snapshot interval: ${SNAPSHOT_INTERVAL / 1000}s`)
if (TIMEOUT > 0) console.log(`[${stamp()}] Timeout: ${TIMEOUT / 1000}s`)

log()
snap()

const timer = setInterval(log, INTERVAL)
const snaptimer = setInterval(snap, SNAPSHOT_INTERVAL)

let exiting = false
function exit() {
  if (exiting) return
  exiting = true
  clearInterval(timer)
  clearInterval(snaptimer)
  summary()
  process.exit(0)
}

process.on("SIGINT", exit)
process.on("SIGTERM", exit)

if (TIMEOUT > 0) setTimeout(exit, TIMEOUT)
