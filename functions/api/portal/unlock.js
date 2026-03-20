import { createPortalSessionCookie } from "../../_lib/auth.js";
import { formatClientPortal, getPortalBySlug } from "../../_lib/db.js";
import { sha256Hex } from "../../_lib/crypto.js";
import { errorResponse, json, readJson } from "../../_lib/responses.js";

export async function onRequestPost(context) {
  if (!context.env.DB || !context.env.SESSION_SECRET) {
    return errorResponse(503, "Client delivery is not configured yet.");
  }

  try {
    const body = await readJson(context.request);
    const slug = String(body.portal || "").trim();
    const accessCode = String(body.accessCode || "").trim();
    const token = String(body.token || "").trim();

    if (!slug) {
      return errorResponse(400, "Enter the portal ID you were sent.");
    }

    const portalBundle = await getPortalBySlug(context.env, slug);
    if (!portalBundle || portalBundle.portal.isActive === false) {
      return errorResponse(404, "That delivery portal is not available right now.");
    }

    const matchesToken = token && token === portalBundle.portal.directToken;
    const matchesAccessCode = accessCode && (await sha256Hex(accessCode)) === portalBundle.portal.accessCodeHash;

    if (!matchesToken && !matchesAccessCode) {
      return errorResponse(401, "That access code did not match this portal.");
    }

    const origin = new URL(context.request.url).origin;
    return json(
      {
        portal: formatClientPortal(portalBundle.portal, portalBundle.files, origin),
      },
      {
        headers: {
          "set-cookie": await createPortalSessionCookie(context.request, context.env, portalBundle.portal.slug),
        },
      }
    );
  } catch (error) {
    return errorResponse(400, error.message || "Unable to unlock this delivery portal.");
  }
}
