import { sqliteTable, text, integer, blob } from "drizzle-orm/sqlite-core"

export const BlobTable = sqliteTable("blob", {
  hash: text().primaryKey(),
  size: integer().notNull(),
  data: blob().notNull(),
})

export * as CasSql from "./cas.sql"
