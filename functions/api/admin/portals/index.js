import { formatAdminPortal, listPortals, savePortal } from "../../../_lib/db.js";
import { requireAdmin } from "../../../_lib/auth.js";
import { errorResponse, json, readJson } from "../../../_lib/responses.js";

async function requireAdminOrError(context) {
  const session = await requireAdmin(context.request, context.env);
  if (!session) {
    return errorResponse(401, "Sign in to manage client portals.");
  }

  if (!context.env.DB) {
    return errorResponse(503, "D1 is not bound to this Pages project yet.");
  }

  return null;
}

export async function onRequestGet(context) {
  const failure = await requireAdminOrError(context);
  if (failure) {
    return failure;
  }

  const origin = new URL(context.request.url).origin;
  const portals = await listPortals(context.env);
  return json({
    portals: portals.map(({ portal, files }) => formatAdminPortal(portal, files, origin)),
  });
}

export async function onRequestPost(context) {
  const failure = await requireAdminOrError(context);
  if (failure) {
    return failure;
  }

  try {
    const body = await readJson(context.request);
    const saved = await savePortal(context.env, body);
    const origin = new URL(context.request.url).origin;
    return json({
      portal: formatAdminPortal(saved.portal, saved.files, origin),
    });
  } catch (error) {
    return errorResponse(400, error.message || "Unable to save the portal.");
  }
}
