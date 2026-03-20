const encoder = new TextEncoder();
const decoder = new TextDecoder();

function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function base64ToUint8Array(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function derivePortalKey(accessCode, salt) {
  if (!window.crypto?.subtle) {
    throw new Error("This browser does not support the encryption required for client portals.");
  }

  const material = await crypto.subtle.importKey("raw", encoder.encode(String(accessCode || "")), "PBKDF2", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 150000,
      hash: "SHA-256",
    },
    material,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export function createPortalId() {
  return crypto.randomUUID ? crypto.randomUUID() : `portal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function ensureUniqueSlug(value, usedSlugs = new Set(), fallback = "client-portal") {
  const base = slugify(value) || fallback;
  let candidate = base;
  let suffix = 2;

  while (usedSlugs.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  usedSlugs.add(candidate);
  return candidate;
}

export function createAccessCode() {
  const adjectives = ["harbor", "sunset", "cedar", "atlas", "linen", "summit", "cypress", "golden"];
  const nouns = ["listing", "gallery", "studio", "estate", "market", "frame", "portal", "showing"];
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(1000 + Math.random() * 9000);
  return `${adjective}-${noun}-${number}`;
}

export async function encryptPortalPayload(payload, accessCode) {
  const code = String(accessCode || "").trim();
  if (!code) {
    throw new Error("Each client portal needs an access code before it can be saved.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePortalKey(code, salt);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encoder.encode(JSON.stringify(payload))
  );

  return {
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertext),
  };
}

export async function decryptPortalPayload(portal, accessCode) {
  const salt = base64ToUint8Array(portal?.salt);
  const iv = base64ToUint8Array(portal?.iv);
  const ciphertext = base64ToUint8Array(portal?.ciphertext);
  const key = await derivePortalKey(String(accessCode || "").trim(), salt);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    ciphertext
  );

  return JSON.parse(decoder.decode(plaintext));
}
