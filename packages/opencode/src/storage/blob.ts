import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Log } from "../util"

const log = Log.create({ service: "blob" })
const THRESHOLD = 64 * 1024

const root = path.join(Global.Path.data, "blob")
await fs.mkdir(root, { recursive: true })

export namespace Blob {
  export function dir() {
    return root
  }

  export function isDataURL(url: string) {
    return url.startsWith("data:")
  }

  export function shouldExternalize(url: string) {
    return isDataURL(url) && url.length > THRESHOLD
  }

  export function toDataURL(data: Uint8Array, mime: string) {
    return "data:" + mime + ";base64," + Buffer.from(data).toString("base64")
  }

  export async function write(buf: Uint8Array, mime: string) {
    const id = new Bun.CryptoHasher("sha256").update(buf).digest("hex")
    const prefix = id.slice(0, 2)
    const folder = path.join(root, prefix)
    await fs.mkdir(folder, { recursive: true })
    await Promise.all([Bun.write(path.join(folder, id), buf), Bun.write(path.join(folder, id + ".mime"), mime)])
    return id
  }

  export async function read(id: string) {
    const file = Bun.file(path.join(root, id.slice(0, 2), id))
    if (!(await file.exists())) return undefined
    const mime = await Bun.file(path.join(root, id.slice(0, 2), id + ".mime")).text()
    const data = new Uint8Array(await file.arrayBuffer())
    return { data, mime }
  }

  export async function resolve(id: string) {
    const result = await read(id)
    if (!result) return undefined
    return toDataURL(result.data, result.mime)
  }

  export async function externalize(url: string) {
    const idx = url.indexOf(",")
    const head = url.slice(0, idx)
    const body = url.slice(idx + 1)
    const mime = head.slice(5).replace(";base64", "")
    const buf = head.includes(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body))
    const id = await write(new Uint8Array(buf), mime)
    const kb = Math.round(buf.length / 1024)
    log.info("externalized", { id: id.slice(0, 12), mime, kb })
    return { blob: id, mime }
  }
}
