import { randomToken, sha256Hex, slugify } from "./crypto.js";

function mapPortalRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    slug: row.slug,
    propertyTitle: row.property_title || "",
    clientLabel: row.client_label || "",
    propertyAddress: row.property_address || "",
    deliveredAt: row.delivered_at || "",
    message: row.message || "",
    isActive: Number(row.is_active) !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accessCodeHash: row.access_code_hash || "",
    directToken: row.direct_token || "",
  };
}

function mapFileRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    portalId: row.portal_id,
    objectKey: row.object_key,
    name: row.name || "",
    title: row.title || "",
    caption: row.caption || "",
    alt: row.alt || "",
    type: row.type || "application/octet-stream",
    sizeBytes: Number(row.size_bytes || 0),
    order: Number(row.order_index || 0),
    createdAt: row.created_at,
  };
}

function groupFiles(files) {
  return files.reduce((map, file) => {
    const bucket = map.get(file.portalId) || [];
    bucket.push(file);
    map.set(file.portalId, bucket);
    return map;
  }, new Map());
}

function sortFiles(files) {
  return [...files].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
}

export function formatPortalFile(file, slug, origin) {
  return {
    id: file.id,
    name: file.name,
    title: file.title || file.name,
    caption: file.caption || "",
    alt: file.alt || file.title || file.name,
    type: file.type,
    sizeBytes: file.sizeBytes,
    order: file.order,
    createdAt: file.createdAt,
    previewUrl: `${origin}/api/portal/${encodeURIComponent(slug)}/asset/${encodeURIComponent(file.id)}`,
    downloadUrl: `${origin}/api/portal/${encodeURIComponent(slug)}/download/${encodeURIComponent(file.id)}`,
  };
}

export function formatAdminPortal(portal, files, origin) {
  return {
    id: portal.id,
    slug: portal.slug,
    propertyTitle: portal.propertyTitle,
    clientLabel: portal.clientLabel,
    propertyAddress: portal.propertyAddress,
    deliveredAt: portal.deliveredAt,
    message: portal.message,
    isActive: portal.isActive,
    hasAccessCode: Boolean(portal.accessCodeHash),
    accessCode: "",
    directToken: portal.directToken,
    portalUrl: `${origin}/client-access.html?portal=${encodeURIComponent(portal.slug)}`,
    privateUrl: `${origin}/client-access.html?portal=${encodeURIComponent(portal.slug)}&token=${encodeURIComponent(portal.directToken)}`,
    files: sortFiles(files).map((file) => formatPortalFile(file, portal.slug, origin)),
    updatedAt: portal.updatedAt,
  };
}

export function formatClientPortal(portal, files, origin) {
  return {
    slug: portal.slug,
    propertyTitle: portal.propertyTitle,
    clientLabel: portal.clientLabel,
    propertyAddress: portal.propertyAddress,
    deliveredAt: portal.deliveredAt,
    message: portal.message,
    isActive: portal.isActive,
    files: sortFiles(files).map((file) => formatPortalFile(file, portal.slug, origin)),
  };
}

export async function listPortals(env) {
  const portalResult = await env.DB.prepare(
    `SELECT id, slug, property_title, client_label, property_address, delivered_at, message, is_active, created_at, updated_at, access_code_hash, direct_token
     FROM portals
     ORDER BY updated_at DESC`
  ).all();
  const fileResult = await env.DB.prepare(
    `SELECT id, portal_id, object_key, name, title, caption, alt, type, size_bytes, order_index, created_at
     FROM portal_files
     ORDER BY order_index ASC, created_at ASC`
  ).all();

  const portals = (portalResult.results || []).map(mapPortalRow);
  const files = (fileResult.results || []).map(mapFileRow);
  const filesByPortal = groupFiles(files);

  return portals.map((portal) => ({
    portal,
    files: filesByPortal.get(portal.id) || [],
  }));
}

export async function getPortalById(env, portalId) {
  const row = await env.DB.prepare(
    `SELECT id, slug, property_title, client_label, property_address, delivered_at, message, is_active, created_at, updated_at, access_code_hash, direct_token
     FROM portals
     WHERE id = ?1`
  )
    .bind(portalId)
    .first();

  if (!row) {
    return null;
  }

  const filesResult = await env.DB.prepare(
    `SELECT id, portal_id, object_key, name, title, caption, alt, type, size_bytes, order_index, created_at
     FROM portal_files
     WHERE portal_id = ?1
     ORDER BY order_index ASC, created_at ASC`
  )
    .bind(portalId)
    .all();

  return {
    portal: mapPortalRow(row),
    files: (filesResult.results || []).map(mapFileRow),
  };
}

export async function getPortalBySlug(env, slug) {
  const row = await env.DB.prepare(
    `SELECT id
     FROM portals
     WHERE slug = ?1`
  )
    .bind(slug)
    .first();

  if (!row?.id) {
    return null;
  }

  return getPortalById(env, row.id);
}

async function ensureUniqueSlug(env, proposedSlug, currentPortalId = "") {
  const base = slugify(proposedSlug);
  let candidate = base;
  let suffix = 2;

  while (true) {
    const row = await env.DB.prepare("SELECT id FROM portals WHERE slug = ?1").bind(candidate).first();
    if (!row || row.id === currentPortalId) {
      return candidate;
    }

    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

export async function savePortal(env, input) {
  const existing = input.id ? await getPortalById(env, input.id) : null;
  const now = new Date().toISOString();
  const propertyTitle = String(input.propertyTitle || existing?.portal.propertyTitle || "").trim();
  const clientLabel = String(input.clientLabel || existing?.portal.clientLabel || "").trim();
  const propertyAddress = String(input.propertyAddress || existing?.portal.propertyAddress || "").trim();
  const deliveredAt = String(input.deliveredAt || existing?.portal.deliveredAt || "").trim();
  const message = String(input.message || existing?.portal.message || "").trim();
  const isActive = input.isActive === undefined ? existing?.portal.isActive !== false : input.isActive !== false;
  const requestedSlug = String(input.slug || propertyTitle || clientLabel || existing?.portal.slug || input.id || "").trim();
  const slug = await ensureUniqueSlug(env, requestedSlug || "client-portal", existing?.portal.id || "");
  const nextAccessCode = String(input.accessCode || "").trim();
  const accessCodeHash = nextAccessCode ? await sha256Hex(nextAccessCode) : existing?.portal.accessCodeHash || "";

  if (!accessCodeHash) {
    throw new Error("Add an access code before saving this portal.");
  }

  const directToken = input.rotateDirectLink || !existing?.portal.directToken ? randomToken(28) : existing.portal.directToken;

  if (existing?.portal) {
    await env.DB.prepare(
      `UPDATE portals
       SET slug = ?2,
           property_title = ?3,
           client_label = ?4,
           property_address = ?5,
           delivered_at = ?6,
           message = ?7,
           is_active = ?8,
           access_code_hash = ?9,
           direct_token = ?10,
           updated_at = ?11
       WHERE id = ?1`
    )
      .bind(
        existing.portal.id,
        slug,
        propertyTitle,
        clientLabel,
        propertyAddress,
        deliveredAt,
        message,
        isActive ? 1 : 0,
        accessCodeHash,
        directToken,
        now
      )
      .run();

    return getPortalById(env, existing.portal.id);
  }

  const id = String(input.id || crypto.randomUUID());
  await env.DB.prepare(
    `INSERT INTO portals (
      id, slug, property_title, client_label, property_address, delivered_at, message, is_active, access_code_hash, direct_token, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
  )
    .bind(id, slug, propertyTitle, clientLabel, propertyAddress, deliveredAt, message, isActive ? 1 : 0, accessCodeHash, directToken, now, now)
    .run();

  return getPortalById(env, id);
}

export async function deletePortal(env, portalId) {
  const existing = await getPortalById(env, portalId);
  if (!existing) {
    return null;
  }

  await env.DB.prepare("DELETE FROM portal_files WHERE portal_id = ?1").bind(portalId).run();
  await env.DB.prepare("DELETE FROM portals WHERE id = ?1").bind(portalId).run();
  return existing;
}

export async function createPortalFile(env, input) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO portal_files (
      id, portal_id, object_key, name, title, caption, alt, type, size_bytes, order_index, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
  )
    .bind(
      input.id,
      input.portalId,
      input.objectKey,
      input.name,
      input.title || input.name,
      input.caption || "",
      input.alt || input.title || input.name,
      input.type || "application/octet-stream",
      Number(input.sizeBytes || 0),
      Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
      now
    )
    .run();

  return getPortalById(env, input.portalId);
}

export async function getPortalFile(env, portalId, fileId) {
  const row = await env.DB.prepare(
    `SELECT id, portal_id, object_key, name, title, caption, alt, type, size_bytes, order_index, created_at
     FROM portal_files
     WHERE portal_id = ?1 AND id = ?2`
  )
    .bind(portalId, fileId)
    .first();

  return mapFileRow(row);
}

export async function deletePortalFile(env, portalId, fileId) {
  const file = await getPortalFile(env, portalId, fileId);
  if (!file) {
    return null;
  }

  await env.DB.prepare("DELETE FROM portal_files WHERE portal_id = ?1 AND id = ?2").bind(portalId, fileId).run();
  return file;
}
