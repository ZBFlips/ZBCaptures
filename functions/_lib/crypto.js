const encoder = new TextEncoder();

function toBinary(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return binary;
}

export function bytesToBase64Url(bytes) {
  return btoa(toBinary(bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlToBytes(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value || "")));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret || "")),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
}

export async function signValue(value, secret) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(String(value || "")));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createSignedToken(payload, secret) {
  const payloadValue = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await signValue(payloadValue, secret);
  return `${payloadValue}.${signature}`;
}

export async function verifySignedToken(token, secret) {
  const [payloadValue, signature] = String(token || "").split(".");
  if (!payloadValue || !signature) {
    return null;
  }

  const expected = await signValue(payloadValue, secret);
  if (signature !== expected) {
    return null;
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadValue)));
    const now = Math.floor(Date.now() / 1000);
    if (payload?.exp && Number(payload.exp) < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function randomToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function slugify(value, fallback = "client-portal") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug || fallback;
}
