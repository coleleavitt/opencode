import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { UserStore } from "../auth/user"
import { WebSession } from "../auth/session"
import { RateLimit } from "../auth/rate-limit"
import { LoginPage } from "../auth/login"
import { AuthMiddleware } from "../auth/middleware"
import { WebAuth } from "../auth/rbac"
import { Log } from "../../util/log"
import { Flag } from "../../flag/flag"

const log = Log.create({ service: "web-auth" })

export const WebAuthRoutes = lazy(() =>
  new Hono()
    .post("/login", async (c) => {
      const ip = c.req.header("x-forwarded-for") ?? "unknown"
      const limit = RateLimit.check(ip)
      if (!limit.allowed) {
        return c.json({ error: "Too many attempts. Try again later." }, 429)
      }

      const body = await c.req
        .json<{ username?: string; password?: string }>()
        .catch(() => ({}) as { username?: string; password?: string })
      if (!body.username || !body.password) {
        return c.json({ error: "Username and password required" }, 400)
      }

      const user = await UserStore.verify(body.username, body.password)
      if (!user) {
        RateLimit.record(ip)
        return c.json({ error: "Invalid credentials" }, 401)
      }

      const token = await WebSession.create({ id: user.id, username: user.username, role: user.role })
      c.header("set-cookie", `opencode_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`)
      log.info("login", { username: user.username })
      return c.json({ token, user: { id: user.id, username: user.username, role: user.role } })
    })
    .post("/logout", async (c) => {
      c.header("set-cookie", "opencode_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
      return c.json({ ok: true })
    })
    .post("/setup", async (c) => {
      const count = await UserStore.count()
      if (count > 0) {
        return c.json({ error: "Setup already completed" }, 400)
      }

      const body = await c.req
        .json<{ username?: string; password?: string }>()
        .catch(() => ({}) as { username?: string; password?: string })
      if (!body.username || !body.password) {
        return c.json({ error: "Username and password required" }, 400)
      }
      if (body.password.length < 8) {
        return c.json({ error: "Password must be at least 8 characters" }, 400)
      }

      const user = await UserStore.create({ username: body.username, password: body.password, role: "admin" })
      const token = await WebSession.create({ id: user.id, username: user.username, role: "admin" })
      c.header("set-cookie", `opencode_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`)
      log.info("setup", { username: user.username })
      return c.json({ token, user })
    })
    .get("/login-page", async (c) => {
      if (Flag.OPENCODE_AUTH_DISABLED) return c.redirect("/")
      const count = await UserStore.count()
      if (count === 0) return c.redirect("/web-auth/setup-page")
      return c.html(LoginPage.login())
    })
    .get("/setup-page", async (c) => {
      if (Flag.OPENCODE_AUTH_DISABLED) return c.redirect("/")
      const count = await UserStore.count()
      if (count > 0) return c.redirect("/web-auth/login-page")
      return c.html(LoginPage.setup())
    })
    .get("/me", async (c) => {
      const u = AuthMiddleware.user(c)
      if (!u) return c.json({ error: "Unauthorized" }, 401)
      return c.json(u)
    })
    .get("/users", async (c) => {
      const u = AuthMiddleware.user(c)
      if (!u || u.role !== "admin") return c.json({ error: "Forbidden" }, 403)
      return c.json(await UserStore.list())
    })
    .post("/users", async (c) => {
      const u = AuthMiddleware.user(c)
      if (!u || u.role !== "admin") return c.json({ error: "Forbidden" }, 403)
      const body = await c.req
        .json<{ username?: string; password?: string; role?: string }>()
        .catch(() => ({}) as { username?: string; password?: string; role?: string })
      if (!body.username || !body.password) {
        return c.json({ error: "Username and password required" }, 400)
      }
      const role = (body.role ?? "user") as WebAuth.Role
      if (!WebAuth.roles.includes(role)) {
        return c.json({ error: "Invalid role" }, 400)
      }
      const user = await UserStore.create({ username: body.username, password: body.password, role })
      return c.json(user, 201)
    })
    .put("/users/:id", async (c) => {
      const u = AuthMiddleware.user(c)
      if (!u || u.role !== "admin") return c.json({ error: "Forbidden" }, 403)
      const id = c.req.param("id")
      const body = await c.req
        .json<{ password?: string; role?: string }>()
        .catch(() => ({}) as { password?: string; role?: string })
      if (body.role && !WebAuth.roles.includes(body.role as WebAuth.Role)) {
        return c.json({ error: "Invalid role" }, 400)
      }
      const updated = await UserStore.update(id, {
        password: body.password,
        role: body.role as WebAuth.Role | undefined,
      })
      if (!updated) return c.json({ error: "User not found" }, 404)
      return c.json(updated)
    })
    .delete("/users/:id", async (c) => {
      const u = AuthMiddleware.user(c)
      if (!u || u.role !== "admin") return c.json({ error: "Forbidden" }, 403)
      const id = c.req.param("id")
      if (id === u.id) return c.json({ error: "Cannot delete yourself" }, 400)
      const removed = await UserStore.remove(id)
      if (!removed) return c.json({ error: "User not found" }, 404)
      return c.json({ ok: true })
    }),
)
