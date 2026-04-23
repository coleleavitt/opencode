import type { Config } from "@/config"
import type { Provider } from "@/provider"
import { ProviderTransform } from "@/provider"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model))
}

export function isOverflow(input: { cfg: Config.Info; tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}

// Parses "prompt is too long: 250000 tokens > 200000" style error messages
// to extract the exact token gap for targeted compaction
const GAP_PATTERN = /(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)/i

export function parseTokenGap(msg: string): { actual: number; limit: number; gap: number } | undefined {
  const match = msg.match(GAP_PATTERN)
  if (!match) return undefined
  const actual = parseInt(match[1].replace(/,/g, ""), 10)
  const limit = parseInt(match[2].replace(/,/g, ""), 10)
  if (isNaN(actual) || isNaN(limit) || actual <= limit) return undefined
  return { actual, limit, gap: actual - limit }
}
