import { requirePortalSession } from "../../../../_lib/auth.js";
import { getPortalBySlug, getPortalFile } from "../../../../_lib/db.js";
import { errorResponse } from "../../../../_lib/responses.js";
import { contentDisposition } from "../../../../_lib/r2.js";

export async function onRequestGet(context) {
  if (!context.env.DB || !context.env.MEDIA_BUCKET || !context.env.SESSION_SECRET) {
    return errorResponse(503, "Client delivery is not configured yet.");
  }

  const slug = String(context.params.slug || "").trim();
  const session = await requirePortalSession(context.request, context.env, slug);
  if (!session) {
    return errorResponse(401, "Unlock this delivery portal to continue.");
  }

  const portalBundle = await getPortalBySlug(context.env, slug);
  if (!portalBundle) {
    return errorResponse(404, "That delivery portal was not found.");
  }

  const file = await getPortalFile(context.env, portalBundle.portal.id, context.params.fileId);
  if (!file) {
    return errorResponse(404, "That file was not found.");
  }

  const object = await context.env.MEDIA_BUCKET.get(file.objectKey);
  if (!object) {
    return errorResponse(404, "That file is no longer available.");
  }

  const headers = new Headers();
  headers.set("content-type", file.type || "application/octet-stream");
  headers.set("content-disposition", contentDisposition(file.name || file.title || file.id, "inline"));
  headers.set("cache-control", "private, no-store");
  if (typeof object.size === "number") {
    headers.set("content-length", String(object.size));
  }

  return new Response(object.body, {
    headers,
  });
}
