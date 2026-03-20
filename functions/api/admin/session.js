import { clearAdminSession, createAdminSession, requireAdmin } from "../../_lib/auth.js";
import { errorResponse, json, readJson } from "../../_lib/responses.js";

function assertSecrets(env) {
  if (!env.SESSION_SECRET || !env.ADMIN_PASSWORD) {
    throw new Error("Cloudflare admin secrets are not configured yet.");
  }
}

export async function onRequestGet(context) {
  try {
    assertSecrets(context.env);
  } catch (error) {
    return errorResponse(503, error.message);
  }

  const session = await requireAdmin(context.request, context.env);
  return json({ authenticated: Boolean(session) });
}

export async function onRequestPost(context) {
  try {
    assertSecrets(context.env);
    const body = await readJson(context.request);
    const password = String(body.password || "").trim();

    if (!password) {
      return errorResponse(400, "Enter the admin password.");
    }

    if (password !== String(context.env.ADMIN_PASSWORD)) {
      return errorResponse(401, "That password was not correct.");
    }

    return json(
      {
        ok: true,
      },
      {
        headers: {
          "set-cookie": await createAdminSession(context.request, context.env),
        },
      }
    );
  } catch (error) {
    return errorResponse(500, error.message || "Unable to sign in.");
  }
}

export async function onRequestDelete(context) {
  return json(
    {
      ok: true,
    },
    {
      headers: {
        "set-cookie": clearAdminSession(context.request),
      },
    }
  );
}
