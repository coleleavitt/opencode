import fs from "fs/promises"
import path from "path"
import { Global } from "../../global"
import type { WebAuth } from "./rbac"
import { Log } from "../../util/log"

export namespace UserStore {
  const log = Log.create({ service: "web-auth.user" })

  export interface User {
    id: string
    username: string
    passwordHash: string
    role: WebAuth.Role
    createdAt: number
    updatedAt: number
  }

  export type UserInfo = Omit<User, "passwordHash">

  function filepath() {
    return path.join(Global.Path.data, "users.json")
  }

  async function read(): Promise<User[]> {
    const file = Bun.file(filepath())
    const exists = await file.exists()
    if (!exists) return []
    const text = await file.text()
    if (!text.trim()) return []
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    // migrate from legacy object format { [id]: { id, username, hash, role, created, updated } }
    const users: User[] = Object.values(parsed).map((u: any) => ({
      id: u.id,
      username: u.username,
      passwordHash: u.passwordHash ?? u.hash ?? "",
      role: u.role ?? "admin",
      createdAt: u.createdAt ?? u.created ?? Date.now(),
      updatedAt: u.updatedAt ?? u.updated ?? Date.now(),
    }))
    await write(users)
    log.info("migrated users.json from legacy format", { count: users.length })
    return users
  }

  async function write(users: User[]) {
    await fs.mkdir(path.dirname(filepath()), { recursive: true })
    await Bun.write(filepath(), JSON.stringify(users, null, 2))
  }

  export async function list(): Promise<UserInfo[]> {
    const users = await read()
    return users.map(sanitize)
  }

  export async function count() {
    const users = await read()
    return users.length
  }

  export async function find(username: string) {
    const users = await read()
    return users.find((u) => u.username === username)
  }

  export async function get(id: string): Promise<UserInfo | undefined> {
    const users = await read()
    const user = users.find((u) => u.id === id)
    if (!user) return undefined
    return sanitize(user)
  }

  export async function create(input: { username: string; password: string; role: WebAuth.Role }): Promise<UserInfo> {
    const users = await read()
    if (users.some((u) => u.username === input.username)) {
      throw new Error(`User "${input.username}" already exists`)
    }
    const now = Date.now()
    const user: User = {
      id: crypto.randomUUID(),
      username: input.username,
      passwordHash: await Bun.password.hash(input.password),
      role: input.role,
      createdAt: now,
      updatedAt: now,
    }
    users.push(user)
    await write(users)
    log.info("created", { username: input.username, role: input.role })
    return sanitize(user)
  }

  export async function update(
    id: string,
    input: { password?: string; role?: WebAuth.Role },
  ): Promise<UserInfo | undefined> {
    const users = await read()
    const idx = users.findIndex((u) => u.id === id)
    if (idx === -1) return undefined
    if (input.password) users[idx].passwordHash = await Bun.password.hash(input.password)
    if (input.role) users[idx].role = input.role
    users[idx].updatedAt = Date.now()
    await write(users)
    log.info("updated", { id, role: input.role })
    return sanitize(users[idx])
  }

  export async function remove(id: string) {
    const users = await read()
    const filtered = users.filter((u) => u.id !== id)
    if (filtered.length === users.length) return false
    await write(filtered)
    log.info("removed", { id })
    return true
  }

  export async function verify(username: string, password: string): Promise<User | undefined> {
    const user = await find(username)
    if (!user) return undefined
    const valid = await Bun.password.verify(password, user.passwordHash)
    if (!valid) return undefined
    return user
  }

  function sanitize(user: User): UserInfo {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  }
}
