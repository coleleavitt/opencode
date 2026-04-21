import { describe, test, expect } from "bun:test"
import { Snapshot } from "../../src/snapshot"
import { createTwoFilesPatch } from "diff"
import { getSingularPatch } from "@pierre/diffs"

const CAP = 256 * 1024

function lines(n: number, prefix = "line"): string {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i}: ${"x".repeat(100)}`).join("\n") + "\n"
}

function diff(opts: Partial<Snapshot.FileDiff> & { file: string }): Snapshot.FileDiff {
  return { before: "", after: "", additions: 0, deletions: 0, ...opts }
}

describe("patch pipeline", () => {
  test("large file: write → cap → parse", () => {
    const before = lines(3000, "old")
    const after = lines(3000, "old")
      .replace(/old 50:/g, "new 50:")
      .replace(/old 100:/g, "new 100:")
    expect(before.length).toBeGreaterThan(CAP)
    expect(after.length).toBeGreaterThan(CAP)

    const patch = createTwoFilesPatch("big.ts", "big.ts", before, after)
    const input: Snapshot.FileDiff[] = [
      diff({ file: "big.ts", before, after, patch, additions: 2, deletions: 2, status: "modified" }),
    ]

    const capped = Snapshot.capFileDiffs(input)
    expect(capped[0].before).toBe("")
    expect(capped[0].after).toBe("")
    expect(typeof capped[0].patch).toBe("string")
    expect(capped[0].patch!.length).toBeGreaterThan(0)

    const meta = getSingularPatch(capped[0].patch!)
    expect(meta.isPartial).toBe(true)
    expect(meta.hunks.length).toBeGreaterThan(0)
    expect(meta.additionLines.some((l) => l.includes("new"))).toBe(true)
    expect(meta.deletionLines.some((l) => l.includes("old"))).toBe(true)
  })

  test("patch is dramatically smaller than raw content", () => {
    const before = lines(3000, "src")
    const after = before.replace(/src 500:/g, "mod 500:")
    const patch = createTwoFilesPatch("large.ts", "large.ts", before, after)
    expect(patch.length).toBeLessThan(before.length * 0.5)
  })

  test("mixed array: large+patch capped, small unchanged, legacy blanked", () => {
    const big = lines(3000, "big")
    const bigAfter = big.replace(/big 10:/g, "changed 10:")
    const small = "hello\n"
    const smallAfter = "world\n"

    const items: Snapshot.FileDiff[] = [
      diff({
        file: "a.ts",
        before: big,
        after: bigAfter,
        patch: createTwoFilesPatch("a.ts", "a.ts", big, bigAfter),
        additions: 1,
        deletions: 1,
      }),
      diff({
        file: "b.ts",
        before: big,
        after: bigAfter,
        patch: createTwoFilesPatch("b.ts", "b.ts", big, bigAfter),
        additions: 1,
        deletions: 1,
      }),
      diff({
        file: "c.ts",
        before: small,
        after: smallAfter,
        patch: createTwoFilesPatch("c.ts", "c.ts", small, smallAfter),
        additions: 1,
        deletions: 1,
      }),
      diff({
        file: "d.ts",
        before: small,
        after: smallAfter,
        patch: createTwoFilesPatch("d.ts", "d.ts", small, smallAfter),
        additions: 1,
        deletions: 1,
      }),
      diff({ file: "e.ts", before: big, after: bigAfter, additions: 1, deletions: 1 }),
    ]

    const capped = Snapshot.capFileDiffs(items)

    // large + patch: content blanked, patch preserved
    expect(capped[0].before).toBe("")
    expect(capped[0].after).toBe("")
    expect(capped[0].patch).toBeDefined()
    expect(capped[1].before).toBe("")
    expect(capped[1].after).toBe("")
    expect(capped[1].patch).toBeDefined()

    // small: unchanged
    expect(capped[2].before).toBe(small)
    expect(capped[2].after).toBe(smallAfter)
    expect(capped[3].before).toBe(small)
    expect(capped[3].after).toBe(smallAfter)

    // legacy large (no patch): content blanked, patch stays undefined
    expect(capped[4].before).toBe("")
    expect(capped[4].after).toBe("")
    expect(capped[4].patch).toBeUndefined()
  })

  test("JSON roundtrip: serialize → deserialize → cap → parse", () => {
    const before = lines(3000, "json")
    const after = before.replace(/json 200:/g, "edited 200:")
    const patch = createTwoFilesPatch("round.ts", "round.ts", before, after)
    const input: Snapshot.FileDiff[] = [
      diff({ file: "round.ts", before, after, patch, additions: 1, deletions: 1, status: "modified" }),
    ]

    const json = JSON.stringify(input)
    const parsed: Snapshot.FileDiff[] = JSON.parse(json)
    const capped = Snapshot.capFileDiffs(parsed)

    expect(capped[0].before).toBe("")
    expect(capped[0].after).toBe("")
    expect(typeof capped[0].patch).toBe("string")

    const meta = getSingularPatch(capped[0].patch!)
    expect(meta.isPartial).toBe(true)
    expect(meta.hunks.length).toBeGreaterThan(0)
    expect(meta.additionLines.some((l) => l.includes("edited"))).toBe(true)
  })
})
