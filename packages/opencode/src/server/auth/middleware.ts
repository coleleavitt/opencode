import type { Context, Next } from "hono"
import { WebSession } from "./session"
import { UserStore } from "./user"
import { Flag } from "../../flag/flag"
import type { WebAuth } from "./rbac"

export namespace AuthMiddleware {
  export interface AuthUser {
    id: string
    username: string
    role: WebAuth.Role
  }

  const AUTH_KEY = "web-auth-user"

  export function user(c: Context): AuthUser | undefined {
    return c.get(AUTH_KEY)
  }

  export async function authenticate(c: Context, next: Next) {
    if (Flag.OPENCODE_AUTH_DISABLED) return next()
    if ((await UserStore.count()) === 0) return next()

    const result = (await fromCookie(c)) ?? (await fromBearer(c)) ?? (await fromQuery(c)) ?? (await fromBasic(c))

    if (result) {
      c.set(AUTH_KEY, result)
      return next()
    }

    if (isApiRequest(c)) {
      return c.json({ error: "Unauthorized" }, 401)
    }
    return c.redirect("/web-auth/login-page")
  }

  export function require(...requiredPermissions: WebAuth.Permission[]) {
    return async (c: Context, next: Next) => {
      if (Flag.OPENCODE_AUTH_DISABLED) return next()

      const u = user(c)
      if (!u) return c.json({ error: "Unauthorized" }, 401)

      const { has } = await import("./rbac").then((m) => m.WebAuth)
      for (const perm of requiredPermissions) {
        if (!has(u.role, perm)) {
          return c.json({ error: "Forbidden", required: perm }, 403)
        }
      }
      return next()
    }
  }

  async function fromCookie(c: Context): Promise<AuthUser | undefined> {
    const cookie = c.req.header("cookie")
    if (!cookie) return undefined
    const match = cookie.match(/(?:^|;\s*)opencode_session=([^;]+)/)
    if (!match) return undefined
    const payload = await WebSession.verify(match[1])
    if (!payload) return undefined
    return { id: payload.sub, username: payload.username, role: payload.role }
  }

  async function fromBearer(c: Context): Promise<AuthUser | undefined> {
    const header = c.req.header("authorization")
    if (!header?.startsWith("Bearer ")) return undefined
    const payload = await WebSession.verify(header.slice(7))
    if (!payload) return undefined
    return { id: payload.sub, username: payload.username, role: payload.role }
  }

  async function fromQuery(c: Context): Promise<AuthUser | undefined> {
    const token = c.req.query("token")
    if (!token) return undefined
    const payload = await WebSession.verify(token)
    if (!payload) return undefined
    return { id: payload.sub, username: payload.username, role: payload.role }
  }

  async function fromBasic(c: Context): Promise<AuthUser | undefined> {
    const header = c.req.header("authorization")
    if (!header?.startsWith("Basic ")) return undefined
    const decoded = atob(header.slice(6))
    const colon = decoded.indexOf(":")
    if (colon === -1) return undefined
    const username = decoded.slice(0, colon)
    const password = decoded.slice(colon + 1)
    const verified = await UserStore.verify(username, password)
    if (!verified) return undefined
    return { id: verified.id, username: verified.username, role: verified.role }
  }

  function isApiRequest(c: Context) {
    const accept = c.req.header("accept") ?? ""
    const contentType = c.req.header("content-type") ?? ""
    return (
      accept.includes("application/json") ||
      contentType.includes("application/json") ||
      c.req.path.startsWith("/session") ||
      c.req.path.startsWith("/config") ||
      c.req.path.startsWith("/event") ||
      c.req.path.startsWith("/provider")
    )
  }
}
