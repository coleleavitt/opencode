import { describe, test, expect, afterAll } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Blob } from "../../src/storage/blob"

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const ids: string[] = []

afterAll(async () => {
  for (const id of ids) {
    const dir = path.join(Blob.dir(), id.slice(0, 2))
    await fs.rm(path.join(dir, id), { force: true })
    await fs.rm(path.join(dir, id + ".mime"), { force: true })
  }
})

describe("Blob", () => {
  test("write + read roundtrip", async () => {
    const id = await Blob.write(PNG, "image/png")
    ids.push(id)
    const result = await Blob.read(id)
    expect(result).toBeDefined()
    expect(result!.mime).toBe("image/png")
    expect(new Uint8Array(result!.data)).toEqual(PNG)
  })

  test("dedup: same bytes produce same ID", async () => {
    const a = await Blob.write(PNG, "image/png")
    const b = await Blob.write(PNG, "image/png")
    ids.push(a, b)
    expect(a).toBe(b)
  })

  test("shouldExternalize: below threshold false, above true", () => {
    const small = Blob.toDataURL(new Uint8Array(100), "image/png")
    expect(Blob.shouldExternalize(small)).toBe(false)

    const big = Blob.toDataURL(new Uint8Array(65 * 1024), "image/png")
    expect(Blob.shouldExternalize(big)).toBe(true)

    expect(Blob.shouldExternalize("https://example.com/img.png")).toBe(false)
  })

  test("externalize data URL then read back matches original", async () => {
    const url = "data:image/png;base64," + Buffer.from(PNG).toString("base64")
    const { blob, mime } = await Blob.externalize(url)
    ids.push(blob)
    expect(mime).toBe("image/png")

    const result = await Blob.read(blob)
    expect(result).toBeDefined()
    expect(new Uint8Array(result!.data)).toEqual(PNG)
  })

  test("resolve returns valid data URL", async () => {
    const id = await Blob.write(PNG, "image/png")
    ids.push(id)
    const url = await Blob.resolve(id)
    expect(url).toBeDefined()
    expect(Blob.isDataURL(url!)).toBe(true)

    const expected = "data:image/png;base64," + Buffer.from(PNG).toString("base64")
    expect(url).toBe(expected)
  })

  test("read missing blob returns undefined", async () => {
    const result = await Blob.read("0000000000000000000000000000000000000000000000000000000000000000")
    expect(result).toBeUndefined()
  })

  test("resolve missing blob returns undefined", async () => {
    const result = await Blob.resolve("0000000000000000000000000000000000000000000000000000000000000000")
    expect(result).toBeUndefined()
  })
})
