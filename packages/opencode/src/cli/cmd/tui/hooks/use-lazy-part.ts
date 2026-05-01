import type { Part } from "@opencode-ai/sdk/v2"

export function needsLazyLoad(part: Part): boolean {
  if (!("text" in part)) return false
  if (part.text) return false
  return true
}

export function lazyPlaceholder(part: Part): string {
  if (part.type === "text") return "Loading..."
  if (part.type === "reasoning") return "Loading reasoning..."
  return "Loading..."
}

export * as UseLazyPart from "./use-lazy-part"
