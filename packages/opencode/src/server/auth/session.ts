import fs from "fs/promises"
import path from "path"
import { Global } from "../../global"
import type { WebAuth } from "./rbac"
import { Log } from "../../util/log"

export namespace WebSession {
  const log = Log.create({ service: "web-auth.session" })

  const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
  const ALG = { name: "HMAC", hash: "SHA-256" } as const

  export interface Payload {
    sub: string
    username: string
    role: WebAuth.Role
    iat: number
    exp: number
  }

  function secretPath() {
    return path.join(Global.Path.data, "jwt-secret")
  }

  let _key: CryptoKey | undefined

  async function key(): Promise<CryptoKey> {
    if (_key) return _key
    const file = Bun.file(secretPath())
    let raw: Uint8Array
    if (await file.exists()) {
      raw = new Uint8Array(await file.arrayBuffer())
    } else {
      raw = crypto.getRandomValues(new Uint8Array(64))
      await fs.mkdir(path.dirname(secretPath()), { recursive: true })
      await Bun.write(secretPath(), raw)
      log.info("generated jwt secret")
    }
    _key = await crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, ALG, false, ["sign", "verify"])
    return _key
  }

  function encode(obj: unknown) {
    return btoa(JSON.stringify(obj)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
  }

  function decode(str: string) {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (str.length % 4)) % 4)
    return JSON.parse(atob(padded))
  }

  export async function create(input: { id: string; username: string; role: WebAuth.Role }): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const payload: Payload = {
      sub: input.id,
      username: input.username,
      role: input.role,
      iat: now,
      exp: now + Math.floor(EXPIRY_MS / 1000),
    }
    const header = encode({ alg: "HS256", typ: "JWT" })
    const body = encode(payload)
    const data = new TextEncoder().encode(`${header}.${body}`)
    const k = await key()
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, data))
    const signature = btoa(String.fromCharCode(...sig))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
    return `${header}.${body}.${signature}`
  }

  export async function verify(token: string): Promise<Payload | undefined> {
    const parts = token.split(".")
    if (parts.length !== 3) return undefined
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    const sigStr = parts[2].replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (parts[2].length % 4)) % 4)
    const sig = Uint8Array.from(atob(sigStr), (c) => c.charCodeAt(0))
    const k = await key()
    const valid = await crypto.subtle.verify("HMAC", k, sig, data)
    if (!valid) return undefined
    const payload: Payload = decode(parts[1])
    if (payload.exp < Math.floor(Date.now() / 1000)) return undefined
    return payload
  }
}
