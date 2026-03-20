const encoder = new TextEncoder();

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  return crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value);
}

async function hmac(keyBytes, value) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function formatAmzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function encodeUriPath(path) {
  return path
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment)
        .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    )
    .join("/");
}

function sanitizeFileName(name) {
  return String(name || "upload.bin")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function signingKey(secret, dateStamp) {
  const kDate = await hmac(encoder.encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmac(kDate, "auto");
  const kService = await hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

export function buildObjectKey(portalId, fileId, name) {
  return `portals/${portalId}/originals/${fileId}-${sanitizeFileName(name) || "upload.bin"}`;
}

export async function createPresignedUploadUrl(env, objectKey, { expiresIn = 900 } = {}) {
  const { amzDate, dateStamp } = formatAmzDate();
  const bucketName = env.R2_BUCKET_NAME;
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodeUriPath(bucketName)}/${encodeUriPath(objectKey)}`;
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.R2_ACCESS_KEY_ID}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  });

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    query
      .toString()
      .split("&")
      .sort()
      .join("&"),
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hex(await sha256(canonicalRequest)),
  ].join("\n");

  const signature = hex(await hmac(await signingKey(env.R2_SECRET_ACCESS_KEY, dateStamp), stringToSign));
  query.set("X-Amz-Signature", signature);

  return `https://${host}${canonicalUri}?${query.toString()}`;
}

export function contentDisposition(fileName, disposition = "attachment") {
  const encoded = encodeURIComponent(fileName)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
  return `${disposition}; filename*=UTF-8''${encoded}`;
}
