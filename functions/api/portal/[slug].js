import { requirePortalSession } from "../../_lib/auth.js";
import { formatClientPortal, getPortalBySlug } from "../../_lib/db.js";
import { errorResponse, json } from "../../_lib/responses.js";

export async function onRequestGet(context) {
  if (!context.env.DB || !context.env.SESSION_SECRET) {
    return errorResponse(503, "Client delivery is not configured yet.");
  }

  const slug = String(context.params.slug || "").trim();
  if (!slug) {
    return errorResponse(400, "Portal ID is required.");
  }

  const session = await requirePortalSession(context.request, context.env, slug);
  if (!session) {
    return errorResponse(401, "Unlock this delivery portal to continue.");
  }

  const portalBundle = await getPortalBySlug(context.env, slug);
  if (!portalBundle || portalBundle.portal.isActive === false) {
    return errorResponse(404, "That delivery portal is not available right now.");
  }

  const origin = new URL(context.request.url).origin;
  return json({
    portal: formatClientPortal(portalBundle.portal, portalBundle.files, origin),
  });
}
