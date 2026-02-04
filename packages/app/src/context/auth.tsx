import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal, onMount } from "solid-js"
import { useServer } from "./server"
import { usePlatform } from "./platform"

interface AuthUser {
  id: string
  username: string
  role: string
}

export const { use: useAuth, provider: AuthProvider } = createSimpleContext({
  name: "Auth",
  init: () => {
    const server = useServer()
    const platform = usePlatform()
    const [user, setUser] = createSignal<AuthUser | undefined>()
    const [checked, setChecked] = createSignal(false)

    const fetcher = platform.fetch ?? fetch

    onMount(async () => {
      const res = await fetcher(`${server.url}/web-auth/me`, { credentials: "include" }).catch(() => undefined)
      if (res?.ok) {
        const data = await res.json()
        setUser(data)
      }
      setChecked(true)
    })

    const authenticated = () => !!user()

    const logout = async () => {
      await fetcher(`${server.url}/web-auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined)
      window.location.href = `${server.url}/web-auth/login-page`
    }

    return { user, authenticated, checked, logout }
  },
})
