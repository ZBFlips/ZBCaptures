function joinPath(parts) {
  return parts.map((part) => encodeURIComponent(String(part || ""))).join("/");
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { error: await response.text().catch(() => "") };

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}.`);
  }

  return payload;
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  return parseResponse(response);
}

export async function getAdminSession() {
  return requestJson("./api/admin/session");
}

export async function adminLogin(password) {
  return requestJson("./api/admin/session", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function adminLogout() {
  return requestJson("./api/admin/session", {
    method: "DELETE",
  });
}

export async function listCloudPortals() {
  const payload = await requestJson("./api/admin/portals");
  return Array.isArray(payload.portals) ? payload.portals : [];
}

export async function saveCloudPortal(portal, options = {}) {
  const method = portal?.id ? "PUT" : "POST";
  const path = portal?.id ? `./api/admin/portals/${joinPath([portal.id])}` : "./api/admin/portals";
  const payload = await requestJson(path, {
    method,
    body: JSON.stringify({
      ...portal,
      rotateDirectLink: Boolean(options.rotateDirectLink),
    }),
  });

  return payload.portal;
}

export async function deleteCloudPortal(portalId) {
  return requestJson(`./api/admin/portals/${joinPath([portalId])}`, {
    method: "DELETE",
  });
}

export async function createCloudUploadTarget(portalId, file) {
  return requestJson(`./api/admin/portals/${joinPath([portalId])}/upload-url`, {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    }),
  });
}

export async function uploadFileToR2(uploadTarget, file) {
  const response = await fetch(uploadTarget.uploadUrl, {
    method: uploadTarget.method || "PUT",
    body: file,
    headers: uploadTarget.headers || {
      "Content-Type": file.type || "application/octet-stream",
    },
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}.`);
  }
}

export async function finalizeCloudPortalFile(portalId, fileRecord) {
  const payload = await requestJson(`./api/admin/portals/${joinPath([portalId])}/files`, {
    method: "POST",
    body: JSON.stringify(fileRecord),
  });

  return payload.portal;
}

export async function deleteCloudPortalFile(portalId, fileId) {
  const payload = await requestJson(`./api/admin/portals/${joinPath([portalId, "files", fileId])}`, {
    method: "DELETE",
  });

  return payload.portal;
}

export async function unlockCloudPortal({ slug, accessCode = "", token = "" }) {
  const payload = await requestJson("./api/portal/unlock", {
    method: "POST",
    body: JSON.stringify({
      portal: slug,
      accessCode,
      token,
    }),
  });

  return payload.portal;
}

export async function loadUnlockedCloudPortal(slug) {
  const payload = await requestJson(`./api/portal/${joinPath([slug])}`);
  return payload.portal;
}
