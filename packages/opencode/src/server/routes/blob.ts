import { Hono } from "hono"
import { Blob } from "../../storage/blob"
import { lazy } from "../../util/lazy"

export const BlobRoutes = lazy(() =>
  new Hono().get("/:id", async (c) => {
    const result = await Blob.read(c.req.param("id"))
    if (!result) return c.notFound()
    return c.body(result.data, {
      headers: {
        "Content-Type": result.mime,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  }),
)
