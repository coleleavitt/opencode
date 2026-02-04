export namespace WebAuth {
  export const roles = ["admin", "user", "viewer"] as const
  export type Role = (typeof roles)[number]

  export const permissions = [
    "session.read",
    "session.write",
    "session.delete",
    "config.read",
    "config.write",
    "provider.read",
    "provider.write",
    "mcp.read",
    "mcp.write",
    "file.read",
    "file.write",
    "pty.access",
    "user.manage",
    "instance.dispose",
  ] as const
  export type Permission = (typeof permissions)[number]

  const matrix: Record<Role, Set<Permission>> = {
    admin: new Set(permissions),
    user: new Set<Permission>([
      "session.read",
      "session.write",
      "session.delete",
      "config.read",
      "config.write",
      "provider.read",
      "provider.write",
      "mcp.read",
      "mcp.write",
      "file.read",
      "file.write",
      "pty.access",
      "instance.dispose",
    ]),
    viewer: new Set<Permission>(["session.read", "config.read", "provider.read", "mcp.read", "file.read"]),
  }

  export function has(role: Role, permission: Permission) {
    return matrix[role]?.has(permission) ?? false
  }

  export function all(role: Role): Permission[] {
    return [...(matrix[role] ?? [])]
  }
}
