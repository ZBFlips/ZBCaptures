import { deletePortal, formatAdminPortal, savePortal } from "../../../_lib/db.js";
import { requireAdmin } from "../../../_lib/auth.js";
import { errorResponse, json, readJson } from "../../../_lib/responses.js";

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

export async function onRequestPut(context) {
  const failure = await requireAdminOrError(context);
  if (failure) {
    return failure;
  }

  try {
    const body = await readJson(context.request);
    const saved = await savePortal(context.env, {
      ...body,
      id: context.params.portalId,
    });
    const origin = new URL(context.request.url).origin;
    return json({
      portal: formatAdminPortal(saved.portal, saved.files, origin),
    });
  } catch (error) {
    return errorResponse(400, error.message || "Unable to update the portal.");
  }
}

export async function onRequestDelete(context) {
  const failure = await requireAdminOrError(context);
  if (failure) {
    return failure;
  }

  const deleted = await deletePortal(context.env, context.params.portalId);
  if (!deleted) {
    return errorResponse(404, "That portal could not be found.");
  }

  await Promise.all(deleted.files.map((file) => context.env.MEDIA_BUCKET.delete(file.objectKey)));
  return json({ ok: true });
}
