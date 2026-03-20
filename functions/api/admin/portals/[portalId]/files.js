import { createPortalFile, formatAdminPortal, getPortalById } from "../../../../_lib/db.js";
import { requireAdmin } from "../../../../_lib/auth.js";
import { errorResponse, json, readJson } from "../../../../_lib/responses.js";

async function requireAdminOrError(context) {
  const session = await requireAdmin(context.request, context.env);
  if (!session) {
    return errorResponse(401, "Sign in to manage client portals.");
  }

  if (!context.env.DB || !context.env.MEDIA_BUCKET) {
    return errorResponse(503, "Client delivery bindings are not configured yet.");
  }

  return null;
}

export async function onRequestPost(context) {
  const failure = await requireAdminOrError(context);
  if (failure) {
    return failure;
  }

  const portalBundle = await getPortalById(context.env, context.params.portalId);
  if (!portalBundle) {
    return errorResponse(404, "Save this portal before uploading files.");
  }

  try {
    const body = await readJson(context.request);
    if (!body.fileId || !body.objectKey) {
      return errorResponse(400, "Missing upload details for this file.");
    }

    const object = await context.env.MEDIA_BUCKET.head(body.objectKey);
    if (!object) {
      return errorResponse(400, "That upload was not found in R2 yet. Try the upload again.");
    }

    const updated = await createPortalFile(context.env, {
      id: body.fileId,
      portalId: portalBundle.portal.id,
      objectKey: body.objectKey,
      name: body.name || body.fileName || "upload",
      title: body.title || body.name || body.fileName || "upload",
      caption: body.caption || "",
      alt: body.alt || body.title || body.name || body.fileName || "Client delivery media",
      type: body.type || object.httpMetadata?.contentType || "application/octet-stream",
      sizeBytes: body.sizeBytes || object.size || 0,
      order: body.order || 0,
    });

    const origin = new URL(context.request.url).origin;
    return json({
      portal: formatAdminPortal(updated.portal, updated.files, origin),
    });
  } catch (error) {
    return errorResponse(400, error.message || "Unable to finalize the uploaded file.");
  }
}
