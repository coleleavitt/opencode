import fs from "node:fs"
import { assembleContextWindow } from "./context-window-assembly"
import { searchParts } from "./search"
import { Cas } from "@/storage/cas"
import type { SessionID } from "./schema"
import { Log } from "@/util"

const log = Log.create({ service: "benchmark" })

const PAGE = 4096

function rssBytes(): number {
  if (process.platform === "linux") {
    try {
      const stat = fs.readFileSync("/proc/self/statm", "utf8")
      const resident = Number.parseInt(stat.split(" ")[1] ?? "0", 10)
      if (Number.isFinite(resident) && resident > 0) return resident * PAGE
    } catch {}
  }
  return process.memoryUsage().rss
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export interface BenchmarkResult {
  contextAssembly: { k: number; messages: number; durationMs: number; rssDeltaBytes: number }
  fts5Search: { query: string; results: number; durationMs: number } | null
  casMetrics: { hits: number; misses: number; ratio: number }
}

/**
 * Run performance benchmarks for the chunked storage refactor.
 */
export function runBenchmark(sessionID: SessionID, k = 100): BenchmarkResult {
  const rssBefore = rssBytes()
  const start = performance.now()
  const msgs = assembleContextWindow(sessionID, k)
  const assemblyDuration = performance.now() - start
  const rssAfter = rssBytes()

  log.info("context assembly", {
    k,
    messages: msgs.length,
    durationMs: assemblyDuration.toFixed(2),
    rssDelta: formatBytes(rssAfter - rssBefore),
  })

  let fts5Result: BenchmarkResult["fts5Search"] = null
  try {
    const searchStart = performance.now()
    const results = searchParts("test", { sessionID, limit: 20 })
    const searchDuration = performance.now() - searchStart
    fts5Result = { query: "test", results: results.length, durationMs: searchDuration }
    log.info("fts5 search", { results: results.length, durationMs: searchDuration.toFixed(2) })
  } catch (e) {
    log.warn("fts5 search skipped", { error: e instanceof Error ? e.message : String(e) })
  }

  const casMetrics = Cas.metrics()
  log.info("cas metrics", casMetrics)

  return {
    contextAssembly: {
      k,
      messages: msgs.length,
      durationMs: assemblyDuration,
      rssDeltaBytes: rssAfter - rssBefore,
    },
    fts5Search: fts5Result,
    casMetrics,
  }
}

/**
 * Format benchmark results as markdown.
 */
export function formatReport(result: BenchmarkResult): string {
  const lines = [
    "# Chunked Storage Benchmark Report",
    "",
    "## Context Assembly",
    `- **k**: ${result.contextAssembly.k}`,
    `- **Messages loaded**: ${result.contextAssembly.messages}`,
    `- **Duration**: ${result.contextAssembly.durationMs.toFixed(2)}ms`,
    `- **RSS delta**: ${formatBytes(result.contextAssembly.rssDeltaBytes)}`,
    "",
    "## FTS5 Search",
  ]

  if (result.fts5Search) {
    lines.push(
      `- **Query**: "${result.fts5Search.query}"`,
      `- **Results**: ${result.fts5Search.results}`,
      `- **Duration**: ${result.fts5Search.durationMs.toFixed(2)}ms`,
    )
  } else {
    lines.push("- *Skipped (no FTS5 data)*")
  }

  lines.push(
    "",
    "## CAS Dedup",
    `- **Hits**: ${result.casMetrics.hits}`,
    `- **Misses**: ${result.casMetrics.misses}`,
    `- **Ratio**: ${(result.casMetrics.ratio * 100).toFixed(1)}%`,
  )

  return lines.join("\n")
}

export * as Benchmark from "./benchmark"
