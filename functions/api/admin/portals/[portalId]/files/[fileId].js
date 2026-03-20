import { deletePortalFile, formatAdminPortal, getPortalById } from "../../../../../_lib/db.js";
import { requireAdmin } from "../../../../../_lib/auth.js";
import { errorResponse, json } from "../../../../../_lib/responses.js";

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

export async function onRequestDelete(context) {
  const failure = await requireAdminOrError(context);
  if (failure) {
    return failure;
  }

  const deleted = await deletePortalFile(context.env, context.params.portalId, context.params.fileId);
  if (!deleted) {
    return errorResponse(404, "That file could not be found.");
  }

  await context.env.MEDIA_BUCKET.delete(deleted.objectKey);
  const updated = await getPortalById(context.env, context.params.portalId);
  const origin = new URL(context.request.url).origin;
  return json({
    portal: formatAdminPortal(updated.portal, updated.files, origin),
  });
}
