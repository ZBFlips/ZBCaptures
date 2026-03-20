import { getPortalById } from "../../../../_lib/db.js";
import { requireAdmin } from "../../../../_lib/auth.js";
import { errorResponse, json, readJson } from "../../../../_lib/responses.js";
import { buildObjectKey, createPresignedUploadUrl } from "../../../../_lib/r2.js";

async function requireAdminOrError(context) {
  const session = await requireAdmin(context.request, context.env);
  if (!session) {
    return errorResponse(401, "Sign in to manage client portals.");
  }

  const required = ["DB", "MEDIA_BUCKET", "R2_BUCKET_NAME", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  for (const key of required) {
    if (!context.env[key]) {
      return errorResponse(503, `Cloudflare binding ${key} is not configured yet.`);
    }
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
    const fileName = String(body.fileName || "").trim();
    if (!fileName) {
      return errorResponse(400, "A file name is required before uploading.");
    }

    const fileId = crypto.randomUUID();
    const objectKey = buildObjectKey(portalBundle.portal.id, fileId, fileName);
    const uploadUrl = await createPresignedUploadUrl(context.env, objectKey);

    return json({
      fileId,
      objectKey,
      uploadUrl,
      method: "PUT",
      headers: {
        "Content-Type": String(body.contentType || "application/octet-stream"),
      },
    });
  } catch (error) {
    return errorResponse(400, error.message || "Unable to start the upload.");
  }
}
