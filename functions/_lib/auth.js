import { createSignedToken, verifySignedToken } from "./crypto.js";

const ADMIN_COOKIE = "zb_admin_session";
const PORTAL_COOKIE = "zb_portal_session";
const TWO_WEEKS = 60 * 60 * 24 * 14;

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function cookieString(name, value, request, { maxAge = TWO_WEEKS, httpOnly = true } = {}) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" && !isLocalHost(url.hostname);
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    secure ? "Secure" : "",
    httpOnly ? "HttpOnly" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function parseCookies(request) {
  const raw = request.headers.get("cookie") || "";
  return raw.split(/;\s*/).reduce((cookies, part) => {
    if (!part) {
      return cookies;
    }

    const index = part.indexOf("=");
    if (index < 0) {
      return cookies;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

export async function createAdminSession(request, env) {
  const token = await createSignedToken(
    {
      scope: "admin",
      exp: Math.floor(Date.now() / 1000) + TWO_WEEKS,
    },
    env.SESSION_SECRET
  );

  return cookieString(ADMIN_COOKIE, encodeURIComponent(token), request, { maxAge: TWO_WEEKS });
}

export function clearAdminSession(request) {
  return cookieString(ADMIN_COOKIE, "", request, { maxAge: 0 });
}

export async function requireAdmin(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[ADMIN_COOKIE];
  if (!token) {
    return null;
  }

  const payload = await verifySignedToken(token, env.SESSION_SECRET);
  if (!payload || payload.scope !== "admin") {
    return null;
  }

  return payload;
}

export async function createPortalSessionCookie(request, env, slug) {
  const token = await createSignedToken(
    {
      scope: "portal",
      slug,
      exp: Math.floor(Date.now() / 1000) + TWO_WEEKS,
    },
    env.SESSION_SECRET
  );

  return cookieString(PORTAL_COOKIE, encodeURIComponent(token), request, { maxAge: TWO_WEEKS });
}

export function clearPortalSession(request) {
  return cookieString(PORTAL_COOKIE, "", request, { maxAge: 0 });
}

export async function requirePortalSession(request, env, slug) {
  const cookies = parseCookies(request);
  const token = cookies[PORTAL_COOKIE];
  if (!token) {
    return null;
  }

  const payload = await verifySignedToken(token, env.SESSION_SECRET);
  if (!payload || payload.scope !== "portal" || payload.slug !== slug) {
    return null;
  }

  return payload;
}
