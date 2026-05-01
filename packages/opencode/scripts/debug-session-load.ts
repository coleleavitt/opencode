#!/usr/bin/env bun
import "../src/storage/db"
import { MessageV2 } from "../src/session/message-v2"

const SESSION_ID = "ses_21fc73baaffe36Xq0EL34ZQOL1" as any

console.log("Testing page() for session:", SESSION_ID)
console.log("---")

try {
  const result = MessageV2.page({ sessionID: SESSION_ID, limit: 100 })
  console.log("items.length:", result.items.length)
  console.log("more:", result.more)
  console.log("cursor:", result.cursor)

  if (result.items.length > 0) {
    const first = result.items[0]
    console.log("\nFirst message:")
    console.log("  info.id:", first.info.id)
    console.log("  info.role:", first.info.role)
    console.log("  parts.length:", first.parts.length)
    if (first.parts.length > 0) {
      console.log("  first part type:", first.parts[0].type)
      const p: any = first.parts[0]
      if ("text" in p) console.log("  first part text len:", p.text?.length ?? "null")
    }

    const last = result.items[result.items.length - 1]
    console.log("\nLast message:")
    console.log("  info.id:", last.info.id)
    console.log("  info.role:", last.info.role)
    console.log("  parts.length:", last.parts.length)
  }

  console.log("\nTrying JSON.stringify...")
  const json = JSON.stringify(result.items)
  console.log("JSON length:", json.length)
} catch (e) {
  console.error("ERROR:", e instanceof Error ? e.message : String(e))
  console.error((e as Error).stack)
}
