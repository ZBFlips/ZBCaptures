import {
  DEFAULT_STATE,
  clearMedia,
  deleteMedia,
  hasSavedState,
  loadState,
  loadWorkspaceDirectoryHandle,
  listMedia,
  putMedia,
  saveWorkspaceDirectoryHandle,
  saveState,
  resetState,
  clearWorkspaceDirectoryHandle,
} from "./storage.js";
import {
  createAccessCode,
  createPortalId,
  ensureUniqueSlug,
} from "./portal-utils.js";
import {
  adminLogin,
  adminLogout,
  createCloudUploadTarget,
  deleteCloudPortal,
  deleteCloudPortalFile,
  finalizeCloudPortalFile,
  getAdminSession,
  listCloudPortals,
  saveCloudPortal,
  uploadFileToR2,
} from "./client-delivery-api.js";

const headerEl = document.getElementById("site-header");
const mainEl = document.getElementById("site-main");
const footerEl = document.getElementById("site-footer");
const PUBLISH_CONFIG_KEY = "portfolio-site-publish-config-v1";
const ADMIN_SESSION_KEY = "portfolio-admin-session-v1";
const LOCAL_ADMIN_PASSWORD_HASH = "38093ac6c3cc62c23555e732c9f361f170f75995bca045e5625a3d11b1de66eb";

let state = loadState();
let media = [];
const rowUrls = new Map();
let workspaceDirectoryHandle = null;
let cloudPortalBackendConfigured = false;
const portalUiState = new Map();
const OPTIMIZED_PUBLIC_IMAGE_PLACEMENTS = new Set(["hero", "reveal", "gallery", "featured", "contact", "services"]);
const PUBLIC_IMAGE_VARIANTS = [
  { name: "thumb", maxWidth: 640, quality: 0.7 },
  { name: "medium", maxWidth: 1280, quality: 0.82 },
  { name: "full", maxWidth: 2200, quality: 0.9 },
];
const PUBLIC_IMAGE_VARIANT_TYPE = "image/webp";
const PUBLIC_IMAGE_VARIANT_EXTENSION = "webp";

function safeText(value) {
  return String(value || "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (!value) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function portalUiSnapshot(portalId) {
  return portalUiState.get(portalId) || {
    message: "",
    tone: "neutral",
    selectedCount: 0,
    selectedBytes: 0,
    savePending: false,
    uploadPending: false,
    uploadStep: 0,
    uploadTotal: 0,
  };
}

function setPortalUiState(portalId, patch = {}) {
  const current = portalUiSnapshot(portalId);
  portalUiState.set(portalId, {
    ...current,
    ...patch,
  });
}

function clearPortalUiState(portalId, keys = []) {
  if (!portalUiState.has(portalId)) {
    return;
  }

  if (!keys.length) {
    portalUiState.delete(portalId);
    return;
  }

  const next = { ...portalUiSnapshot(portalId) };
  keys.forEach((key) => {
    delete next[key];
  });
  portalUiState.set(portalId, next);
}

function portalUploadSummary(portalId) {
  const snapshot = portalUiSnapshot(portalId);
  if (snapshot.uploadPending && snapshot.uploadTotal) {
    return `Uploading ${snapshot.uploadStep || 0} of ${snapshot.uploadTotal} files to private storage...`;
  }

  if (snapshot.selectedCount) {
    return `${snapshot.selectedCount} file${snapshot.selectedCount === 1 ? "" : "s"} selected (${formatBytes(snapshot.selectedBytes)})`;
  }

  return "Choose the finished shoot files here. Images and video upload directly to private storage.";
}

function portalFeedbackClass(tone) {
  return tone === "success"
    ? "portal-admin-feedback portal-admin-feedback--success"
    : tone === "warn"
      ? "portal-admin-feedback portal-admin-feedback--warn"
      : "portal-admin-feedback";
}

function flashButtonLabel(button, nextLabel, duration = 1600) {
  if (!button) {
    return;
  }

  const original = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = original;
  button.textContent = nextLabel;
  window.setTimeout(() => {
    if (button.isConnected) {
      button.textContent = button.dataset.originalLabel || original;
    }
  }, duration);
}

function loadPublishConfig() {
  try {
    const raw = localStorage.getItem(PUBLISH_CONFIG_KEY);
    if (!raw) {
      return {
        owner: "",
        repo: "",
        branch: "main",
        token: "",
      };
    }

    return JSON.parse(raw);
  } catch {
    return {
      owner: "",
      repo: "",
      branch: "main",
      token: "",
    };
  }
}

function savePublishConfig(config) {
  localStorage.setItem(PUBLISH_CONFIG_KEY, JSON.stringify(config));
}

let publishConfig = loadPublishConfig();

function isAdminUnlocked() {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === "granted";
  } catch {
    return false;
  }
}

function setAdminUnlocked(value) {
  try {
    if (value) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, "granted");
      return;
    }

    sessionStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    // Ignore session storage issues and fall back to per-load unlock checks.
  }
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadPublishedSiteData() {
  try {
    const response = await fetch("./content/site-data.json", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}

function mergePublishedState(published) {
  return {
    ...DEFAULT_STATE,
    ...published,
    settings: {
      ...DEFAULT_STATE.settings,
      ...(published.settings || {}),
    },
    services: Array.isArray(published.services) ? published.services : DEFAULT_STATE.services,
    clientPortals: Array.isArray(published.clientPortals) ? published.clientPortals : DEFAULT_STATE.clientPortals,
  };
}

function mergeClientPortals(localPortals = [], publishedPortals = []) {
  const byKey = new Map();

  for (const portal of publishedPortals) {
    if (!portal) {
      continue;
    }

    const key = portal.id || portal.slug;
    if (key) {
      byKey.set(key, { ...portal });
    }
  }

  for (const portal of localPortals) {
    if (!portal) {
      continue;
    }

    const key = portal.id || portal.slug;
    if (!key) {
      continue;
    }

    const current = byKey.get(key) || {};
    byKey.set(key, {
      ...current,
      ...portal,
      accessCode: portal.accessCode || current.accessCode || "",
    });
  }

  return Array.from(byKey.values());
}

function sortPortalFiles(items = []) {
  return [...items].sort((left, right) => {
    const leftOrder = Number.isFinite(Number(left.order)) ? Number(left.order) : 9999;
    const rightOrder = Number.isFinite(Number(right.order)) ? Number(right.order) : 9999;
    return leftOrder - rightOrder || String(left.name || left.title || "").localeCompare(String(right.name || right.title || ""));
  });
}

function portalRecordById(portalId) {
  return (state.clientPortals || []).find((portal) => portal.id === portalId) || null;
}

function mediaPreviewUrl(item) {
  let url = rowUrls.get(item.id);
  if (!url) {
    url = item.blob ? URL.createObjectURL(item.blob) : item.variants?.thumb?.src || item.src || "";
    if (item.blob) {
      rowUrls.set(item.id, url);
    }
  }

  return url;
}

function portalMediaItems(portalId) {
  return sortPortalFiles(portalRecordById(portalId)?.files || []);
}

function clientAccessBaseUrl() {
  return new URL("./client-access.html", window.location.href);
}

function portalUrl(portal) {
  const url = clientAccessBaseUrl();
  url.searchParams.set("portal", portal.slug || "");
  return url.toString();
}

function portalOneClickUrl(portal) {
  const url = clientAccessBaseUrl();
  url.searchParams.set("portal", portal.slug || "");
  if (portal.directToken) {
    url.searchParams.set("token", portal.directToken);
  }
  return url.toString();
}

async function copyToClipboard(text, fallbackMessage) {
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, message: fallbackMessage };
  } catch {
    window.prompt("Copy this value:", text);
    return { ok: false, message: fallbackMessage };
  }
}

function createClientPortalDraft() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: createPortalId(),
    slug: "",
    propertyTitle: "",
    clientLabel: "",
    propertyAddress: "",
    deliveredAt: today,
    message:
      "Your finished media is ready below. Preview the files and use the download buttons to save the original versions.",
    accessCode: createAccessCode(),
    isActive: true,
    files: [],
    hasAccessCode: false,
    directToken: "",
    portalUrl: "",
    privateUrl: "",
    cloudSynced: false,
  };
}

function mergePortalRecord(existingPortal, cloudPortal) {
  return {
    ...(existingPortal || {}),
    ...(cloudPortal || {}),
    accessCode: existingPortal?.accessCode || "",
    files: sortPortalFiles(cloudPortal?.files || existingPortal?.files || []),
    cloudSynced: true,
  };
}

function upsertPortalState(nextPortal) {
  const currentPortals = Array.isArray(state.clientPortals) ? state.clientPortals : [];
  const index = currentPortals.findIndex((portal) => portal.id === nextPortal.id);
  if (index < 0) {
    const mergedPortal = mergePortalRecord(null, nextPortal);
    state.clientPortals = [...currentPortals, mergedPortal];
    return mergedPortal;
  }

  const merged = mergePortalRecord(currentPortals[index], nextPortal);
  const updated = [...currentPortals];
  updated[index] = merged;
  state.clientPortals = updated;
  return merged;
}

function portalStatusMessage() {
  return cloudPortalBackendConfigured
    ? "Save a portal once to make it live instantly on Cloudflare, then upload files straight into private storage."
    : "Client delivery is still waiting for the Cloudflare R2/D1 bindings. Finish the setup steps before sharing portals.";
}

async function refreshCloudPortals() {
  try {
    const cloudPortals = await listCloudPortals();
    cloudPortalBackendConfigured = true;
    const merged = mergeClientPortals(state.clientPortals || [], cloudPortals).map((portal) =>
      mergePortalRecord((state.clientPortals || []).find((current) => current.id === portal.id), portal)
    );
    state.clientPortals = merged;
    saveState(state);
  } catch (error) {
    cloudPortalBackendConfigured = false;
    console.warn("Cloud portal backend unavailable", error);
  }
}

async function syncPortalToCloud(portalId, options = {}) {
  const portal = portalRecordById(portalId);
  if (!portal) {
    throw new Error("That client portal could not be found.");
  }

  const savedPortal = await saveCloudPortal(
    {
      id: portal.id,
      slug: portal.slug,
      propertyTitle: portal.propertyTitle,
      clientLabel: portal.clientLabel,
      propertyAddress: portal.propertyAddress,
      deliveredAt: portal.deliveredAt,
      message: portal.message,
      accessCode: String(portal.accessCode || "").trim(),
      isActive: portal.isActive !== false,
    },
    options
  );

  const merged = upsertPortalState(savedPortal);
  saveState(state);
  return merged;
}

async function uploadPortalFilesToCloud(portalId, files, onProgress) {
  const portal = await syncPortalToCloud(portalId);
  const existingItems = portalMediaItems(portal.id);
  let nextOrder = existingItems.length
    ? Math.max(...existingItems.map((item) => Number(item.order) || 0)) + 1
    : 0;

  let latestPortal = portal;
  for (const [index, file] of files.entries()) {
    onProgress?.(index + 1, files.length, file);
    const uploadTarget = await createCloudUploadTarget(portal.id, file);
    await uploadFileToR2(uploadTarget, file);
    latestPortal = await finalizeCloudPortalFile(portal.id, {
      fileId: uploadTarget.fileId,
      objectKey: uploadTarget.objectKey,
      name: file.name,
      title: file.name.replace(/\.[^.]+$/, ""),
      alt: file.name.replace(/\.[^.]+$/, ""),
      caption: "",
      type: file.type || "application/octet-stream",
      sizeBytes: file.size,
      order: nextOrder,
    });
    upsertPortalState(latestPortal);
    nextOrder += 1;
  }

  saveState(state);
  return latestPortal;
}

function renderHeader() {
  headerEl.innerHTML = `
    <div class="site-header">
      <div class="site-header__inner">
        <a class="brand" href="./index.html" aria-label="Back to site">
          <span class="brand__name">${safeText(state.settings.brandName)}</span>
          <span class="brand__tag">Admin dashboard</span>
        </a>
        <nav class="nav" aria-label="Admin navigation">
          <a href="./index.html">Preview site</a>
          <a href="./services.html">Services page</a>
          <a href="./client-access.html">Client access</a>
          ${isAdminUnlocked() ? `<button type="button" data-lock-admin>Lock admin</button>` : ""}
          <a href="./contact.html" class="nav__cta">Contact page</a>
        </nav>
      </div>
    </div>
  `;
}

function renderFooter() {
  footerEl.innerHTML = `
    <div class="footer">
      <div class="footer__inner">
        <div><strong>Admin storage</strong><div>Content persists in your browser using local storage and IndexedDB.</div></div>
        <div class="footer__links">
          <span class="status"><strong>${media.length}</strong> uploads</span>
          <span class="status"><strong>${state.services.length}</strong> services</span>
          <span class="status"><strong>${(state.clientPortals || []).length}</strong> client portals</span>
        </div>
      </div>
    </div>
  `;
}

function renderLockedAdmin(message = "") {
  renderHeader();
  renderFooter();
  mainEl.innerHTML = `
    <section class="admin-panel" style="max-width: 560px; margin: 48px auto 0;">
      <h1 class="admin-panel__title">Unlock Admin</h1>
      <p class="admin-panel__text">Enter the admin password to access the dashboard.</p>
      <form class="form" id="admin-password-form">
        <div class="field">
          <label for="admin-password">Password</label>
          <input id="admin-password" name="password" type="password" autocomplete="current-password" placeholder="Enter admin password" />
        </div>
        <button class="button button--accent" type="submit">Unlock admin</button>
        <div class="helper">${safeText(message || "This admin session stays unlocked on this device until you use Lock admin or the Cloudflare session expires.")}</div>
      </form>
    </section>
  `;
}

function wireHeaderActions() {
  headerEl.querySelector("[data-lock-admin]")?.addEventListener("click", async () => {
    setAdminUnlocked(false);
    try {
      await adminLogout();
    } catch (error) {
      console.warn("Could not clear the cloud admin session.", error);
    }
    renderLockedAdmin("Admin locked.");
    wireAdminUnlockForm();
  });
}

function wireAdminUnlockForm() {
  const form = document.getElementById("admin-password-form");
  const input = document.getElementById("admin-password");
  if (!form || !(input instanceof HTMLInputElement)) {
    return;
  }

  window.setTimeout(() => input.focus(), 0);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = input.value.trim();
    if (!password) {
      renderLockedAdmin("Enter the admin password to continue.");
      wireAdminUnlockForm();
      return;
    }

    try {
      await adminLogin(password);
      setAdminUnlocked(true);
      await bootstrap();
    } catch (error) {
      const digest = await sha256Hex(password);
      if (window.location.hostname === "localhost" && digest === LOCAL_ADMIN_PASSWORD_HASH) {
        setAdminUnlocked(true);
        await bootstrap();
        return;
      }

      renderLockedAdmin(error.message || "That password was not correct.");
      wireAdminUnlockForm();
    }
  });
}

function adminMarkup() {
  return `
    <section class="admin-shell">
      <aside class="admin-nav">
        <button type="button" class="is-active" data-jump="#hero">Hero</button>
        <button type="button" data-jump="#portfolio">Portfolio</button>
        <button type="button" data-jump="#gallery-order">Gallery order</button>
        <button type="button" data-jump="#client-delivery">Client delivery</button>
        <button type="button" data-jump="#services">Services</button>
        <button type="button" data-jump="#settings">Settings</button>
      </aside>

      <div class="admin-content">
        <div class="admin-banner">
          <div>
            <h1 class="admin-panel__title">Admin dashboard</h1>
            <p class="admin-panel__text">Edit the hero, gallery, services, and contact details here. Use the save button below to write everything to the site files so uploads and text changes stay put.</p>
          </div>
          <div class="admin-toolbar admin-toolbar--banner">
            <button class="button button--accent" type="button" id="save-all">Save changes</button>
            <span class="status" id="save-status">Waiting for edits.</span>
          </div>
        </div>

        <section class="admin-panel" id="hero">
          <h2 class="admin-panel__title">Hero and header</h2>
          <p class="admin-panel__text">Use this area for the header logo, the daytime and night hero images, and the featured frame copy on the homepage.</p>
          <form class="hero-upload-grid" data-header-logo-upload>
            <div class="hero-upload-card">
              <div class="section__eyebrow">Header logo image</div>
              <p class="admin-note">This image appears in the sticky header across the site.</p>
              <div class="field">
                <label for="header-logo-file">Image file</label>
                <input id="header-logo-file" data-header-logo-file type="file" accept="image/*" />
              </div>
              <div class="field">
                <label for="header-logo-alt">Alt text</label>
                <input id="header-logo-alt" data-header-logo-alt type="text" placeholder="ZB Captures logo" />
              </div>
              <button class="button button--accent" type="submit">Upload header logo</button>
            </div>
          </form>

          <div class="hero-upload-grid">
            <form class="hero-upload-card" data-hero-upload="hero">
              <div class="section__eyebrow">Daytime background</div>
              <p class="admin-note">This is the image visitors see first on the home page.</p>
              <div class="field">
                <label for="hero-day-file">Image file</label>
                <input id="hero-day-file" data-hero-file type="file" accept="image/*" />
              </div>
              <div class="field">
                <label for="hero-day-alt">Alt text</label>
                <input id="hero-day-alt" data-hero-alt type="text" placeholder="Daytime home exterior" />
              </div>
              <button class="button button--accent" type="submit">Upload daytime background</button>
            </form>

            <form class="hero-upload-card" data-hero-upload="reveal">
              <div class="section__eyebrow">Night reveal</div>
              <p class="admin-note">This image appears inside the circular cursor spotlight.</p>
              <div class="field">
                <label for="hero-night-file">Image file</label>
                <input id="hero-night-file" data-hero-file type="file" accept="image/*" />
              </div>
              <div class="field">
                <label for="hero-night-alt">Alt text</label>
                <input id="hero-night-alt" data-hero-alt type="text" placeholder="Nighttime home exterior" />
              </div>
              <button class="button button--accent" type="submit">Upload night reveal</button>
            </form>
          </div>

          <div class="hero-copy-card" style="margin-top: 14px;">
            <div class="section__eyebrow">Featured frame copy</div>
            <p class="admin-note">This text appears in the smaller feature card inside the hero area.</p>
            <form class="admin-grid" id="featured-frame-form">
              <div class="field">
                <label for="featuredFrameTitle">Title</label>
                <input id="featuredFrameTitle" name="featuredFrameTitle" value="${safeText(state.settings.featuredFrameTitle || "Selected work")}" />
              </div>
              <div class="field" style="grid-column: 1 / -1;">
                <label for="featuredFrameLead">Subtext</label>
                <textarea id="featuredFrameLead" name="featuredFrameLead">${safeText(state.settings.featuredFrameLead || "A single image can carry the whole listing.")}</textarea>
              </div>
              <div class="field" style="grid-column: 1 / -1;">
                <label for="featuredFrameMediaId">Featured frame image</label>
                <select id="featuredFrameMediaId" name="featuredFrameMediaId">
                  <option value="">Auto-pick first gallery image</option>
                </select>
              </div>
            </form>
          </div>
        </section>

        <section class="admin-panel" id="portfolio">
          <h2 class="admin-panel__title">Portfolio</h2>
          <p class="admin-panel__text">Upload gallery images, assign featured work, or attach a video. The media library below lets you edit everything in one place.</p>
          <form class="admin-grid" id="upload-form">
            <div class="field" style="grid-column: 1 / -1;">
              <label for="file">Images or video</label>
              <input id="file" name="file" type="file" accept="image/*,video/*" multiple />
            </div>
            <div class="field">
              <label for="placement">Placement</label>
              <select id="placement" name="placement">
                <option value="gallery">Gallery grid</option>
                <option value="featured">Featured</option>
                <option value="logo">Header logo</option>
                <option value="hero">Daytime background</option>
                <option value="reveal">Night reveal</option>
                <option value="services">Services page</option>
                <option value="contact">Contact page</option>
                <option value="video">Video section</option>
                <option value="hidden">Hidden</option>
              </select>
            </div>
            <div class="field">
              <label for="order">Order</label>
              <input id="order" name="order" type="number" value="0" />
            </div>
            <div class="field">
              <label for="title">Title</label>
              <input id="title" name="title" placeholder="Sunlit kitchen" />
            </div>
            <div class="field">
              <label for="alt">Alt text</label>
              <input id="alt" name="alt" placeholder="Interior image description" />
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label for="caption">Caption</label>
              <textarea id="caption" name="caption" placeholder="Short note shown in the portfolio tiles"></textarea>
            </div>
            <div style="grid-column: 1 / -1;">
              <button class="button button--accent" type="submit">Upload selected files</button>
            </div>
          </form>
          <div class="media-list" id="media-list"></div>
        </section>

        <section class="admin-panel" id="gallery-order">
          <h2 class="admin-panel__title">Gallery order</h2>
          <p class="admin-panel__text">Reorder the images that appear on the home page gallery with simple up and down controls. The first 16 image placements are what surface on the page.</p>
          <div class="admin-toolbar">
            <span class="admin-note" id="gallery-order-status">Use the arrows to move images up or down.</span>
          </div>
          <div class="gallery-order-list" id="gallery-order-list"></div>
        </section>

        <section class="admin-panel" id="client-delivery">
          <h2 class="admin-panel__title">Client delivery</h2>
          <p class="admin-panel__text">Create private client portals backed by Cloudflare R2. Save the portal, upload the finished shoot, then copy either the portal link or the one-click private link.</p>
          <div class="admin-toolbar">
            <button class="button button--accent" type="button" id="add-client-portal">Create client portal</button>
            <span class="admin-note" id="client-portal-status">${safeText(portalStatusMessage())}</span>
          </div>
          <div class="admin-note" style="margin-bottom: 18px;">
            These portals no longer publish client media into GitHub. Once a portal is saved here, it can go live immediately without a site redeploy.
          </div>
          <div class="portal-admin-list" id="client-portals-list"></div>
        </section>

        <section class="admin-panel" id="services">
          <h2 class="admin-panel__title">Services</h2>
          <p class="admin-panel__text">Edit the service cards that appear on the home page and services page.</p>
          <div class="admin-toolbar">
            <button class="button button--accent" type="button" id="save-services">Save services</button>
            <span class="admin-note" id="services-status">Your edits autosave in this browser, and this button gives you an explicit save action.</span>
          </div>
          <div class="admin-grid" id="services-list"></div>
        </section>

        <section class="admin-panel" id="proof">
          <h2 class="admin-panel__title">Why agents book this</h2>
          <p class="admin-panel__text">Edit the proof section that appears on the services page. You can change the headline and the three supporting cards without touching the code.</p>
          <div class="admin-toolbar">
            <button class="button button--accent" type="button" id="save-proof">Save proof section</button>
            <span class="admin-note" id="proof-status">Your edits autosave in this browser, and this button gives you an explicit save action.</span>
          </div>
          <form class="admin-grid" id="proof-form">
            <div class="field" style="grid-column: 1 / -1;">
              <label for="proofEyebrow">Section eyebrow</label>
              <input id="proofEyebrow" name="proofEyebrow" value="${safeText(state.settings.proofEyebrow || "Why agents book this")}" />
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label for="proofTitle">Headline</label>
              <textarea id="proofTitle" name="proofTitle">${safeText(state.settings.proofTitle || "Everything is designed to make the listing feel more valuable, not more complicated.")}</textarea>
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label for="proofLead">Subtext</label>
              <textarea id="proofLead" name="proofLead">${safeText(state.settings.proofLead || "The experience stays clean, fast, and premium, so the focus stays on the property and the confidence it creates for buyers.")}</textarea>
            </div>
            ${Array.isArray(state.settings.proofCards) && state.settings.proofCards.length
              ? state.settings.proofCards
                  .map(
                    (card, index) => `
                      <article class="card" style="grid-column: 1 / -1;">
                        <div class="card__body">
                          <div class="section__eyebrow">Proof card ${index + 1}</div>
                          <div class="field">
                            <label for="proofCard${index + 1}Eyebrow">Eyebrow</label>
                            <input id="proofCard${index + 1}Eyebrow" name="proofCard${index + 1}Eyebrow" value="${safeText(card.eyebrow || "")}" />
                          </div>
                          <div class="field">
                            <label for="proofCard${index + 1}Title">Title</label>
                            <textarea id="proofCard${index + 1}Title" name="proofCard${index + 1}Title">${safeText(card.title || "")}</textarea>
                          </div>
                          <div class="field">
                            <label for="proofCard${index + 1}Text">Text</label>
                            <textarea id="proofCard${index + 1}Text" name="proofCard${index + 1}Text">${safeText(card.text || "")}</textarea>
                          </div>
                        </div>
                      </article>
                    `
                  )
                  .join("")
              : ""}
          </form>
        </section>

        <section class="admin-panel" id="settings">
          <div class="admin-toolbar">
            <button class="button ghost" type="button" id="reset-demo">Reset to defaults</button>
            <button class="button ghost" type="button" id="export-data">Export JSON</button>
          </div>
          <h1 class="admin-panel__title">Site settings</h1>
          <p class="admin-panel__text">Edit the words that show up across the site. The logo section above controls the top-left header mark, while this text is used for the footer and fallback branding.</p>

          <form class="admin-grid" id="brand-form">
            <div class="field">
              <label for="brandName">Footer / fallback name</label>
              <input id="brandName" name="brandName" value="${safeText(state.settings.brandName)}" />
            </div>
            <div class="field">
              <label for="brandTag">Brand tag</label>
              <input id="brandTag" name="brandTag" value="${safeText(state.settings.brandTag)}" />
            </div>
            <div class="field">
              <label for="heroKicker">Hero kicker</label>
              <input id="heroKicker" name="heroKicker" value="${safeText(state.settings.heroKicker)}" />
            </div>
            <div class="field">
              <label for="heroHeadline">Hero headline</label>
              <input id="heroHeadline" name="heroHeadline" value="${safeText(state.settings.heroHeadline)}" />
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label for="heroLead">Hero lead</label>
              <textarea id="heroLead" name="heroLead">${safeText(state.settings.heroLead)}</textarea>
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label for="servicesLead">Services lead</label>
              <textarea id="servicesLead" name="servicesLead">${safeText(state.settings.servicesLead)}</textarea>
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label for="contactLead">Contact lead</label>
              <textarea id="contactLead" name="contactLead">${safeText(state.settings.contactLead)}</textarea>
            </div>
            <div class="field">
              <label for="serviceArea">Service area</label>
              <input id="serviceArea" name="serviceArea" value="${safeText(state.settings.serviceArea)}" />
            </div>
            <div class="field">
              <label for="videoEmbedUrl">Video embed URL</label>
              <input id="videoEmbedUrl" name="videoEmbedUrl" value="${safeText(state.settings.videoEmbedUrl)}" placeholder="https://..." />
            </div>
            <div class="field">
              <label for="email">Contact email</label>
              <input id="email" name="email" value="${safeText(state.settings.email)}" />
            </div>
            <div class="field">
              <label for="contactNotificationEndpoint">Contact notification endpoint</label>
              <input id="contactNotificationEndpoint" name="contactNotificationEndpoint" value="${safeText(state.settings.contactNotificationEndpoint || "")}" placeholder="https://..." />
              <div class="admin-note">Leave this blank to use the built-in <code>/api/contact</code> endpoint on your Cloudflare Pages site. Paste a custom webhook only if you want to override it.</div>
            </div>
            <div class="field">
              <label for="phone">Phone</label>
              <input id="phone" name="phone" value="${safeText(state.settings.phone)}" />
            </div>
            <div class="field">
              <label for="instagram">Instagram</label>
              <input id="instagram" name="instagram" value="${safeText(state.settings.instagram)}" />
            </div>
            <div class="field">
              <label for="responseTime">Response time note</label>
              <input id="responseTime" name="responseTime" value="${safeText(state.settings.responseTime)}" />
            </div>
          </form>

          <section class="admin-panel admin-panel--nested" id="local-files">
            <h2 class="admin-panel__title">Local files</h2>
            <p class="admin-panel__text">Link this browser to the project folder so the admin panel can write directly into the site files on your computer.</p>
            <div class="admin-toolbar">
              <button class="button button--accent" type="button" id="link-local-folder">Link local folder</button>
              <button class="button ghost" type="button" id="unlink-local-folder">Forget folder</button>
            </div>
            <div class="admin-note" id="local-folder-status">No local folder linked yet.</div>
          </section>

          <details class="admin-details">
            <summary>Advanced</summary>
            <section class="admin-panel admin-panel--nested" id="backup">
              <h2 class="admin-panel__title">Backup and restore</h2>
              <p class="admin-panel__text">Export the current text and layout data as JSON. Media itself is stored in the browser on this device, so keep the browser profile intact unless you are moving to a backend.</p>
              <div class="admin-toolbar">
                <label class="button ghost" for="import-file">Import JSON</label>
                <input id="import-file" type="file" accept="application/json" hidden />
                <button class="button ghost danger" type="button" id="clear-media">Clear media library</button>
              </div>
              <div class="admin-note">
                Public portfolio media still stays in this browser until you save or publish it. Save or publish now exports eligible public images as WebP thumb, medium, and full variants automatically. Client delivery still uses Cloudflare storage instead of GitHub once the backend bindings are configured.
              </div>
            </section>

            <section class="admin-panel admin-panel--nested" id="publish">
              <h2 class="admin-panel__title">Publish to GitHub Pages</h2>
              <p class="admin-panel__text">This is the live-publish path. Enter a fine-grained GitHub token with repository contents write access for this repo, then publish your local changes straight into the GitHub Pages source branch.</p>
              <div class="admin-grid">
                <div class="field">
                  <label for="githubOwner">Repository owner</label>
                  <input id="githubOwner" name="githubOwner" value="${safeText(publishConfig.owner)}" placeholder="your-github-username" />
                </div>
                <div class="field">
                  <label for="githubRepo">Repository name</label>
                  <input id="githubRepo" name="githubRepo" value="${safeText(publishConfig.repo)}" placeholder="portfolio-site" />
                </div>
                <div class="field">
                  <label for="githubBranch">Branch</label>
                  <input id="githubBranch" name="githubBranch" value="${safeText(publishConfig.branch || "main")}" placeholder="main" />
                </div>
                <div class="field">
                  <label for="githubToken">GitHub token</label>
                  <input id="githubToken" name="githubToken" type="password" value="${safeText(publishConfig.token)}" placeholder="fine-grained PAT" />
                </div>
              </div>
              <div class="admin-toolbar" style="margin-top: 18px;">
                <button class="button button--accent" type="button" id="publish-live">Publish live</button>
                <button class="button ghost" type="button" id="save-publish-config">Save publish settings</button>
                <button class="button ghost" type="button" id="load-live-state">Load live state</button>
              </div>
              <div class="admin-note" id="publish-status">Publishing updates <code>content/site-data.json</code> and the public portfolio media only. Eligible public images are exported as WebP thumb, medium, and full variants. Client delivery portals now live outside the repo.</div>
            </section>
          </details>
        </section>
      </div>
    </section>
  `;
}

async function uploadMediaFiles(files, { placement, title, caption = "", alt, order = 0, portalId = "" }) {
  if (!files.length) {
    throw new Error("Choose at least one image or video to upload.");
  }

  for (const [index, file] of files.entries()) {
    await putMedia({
      blob: file,
      name: file.name,
      type: file.type,
      title: title || file.name.replace(/\.[^.]+$/, ""),
      caption,
      alt: alt || title || file.name,
      placement,
      order: order + index,
      portalId,
    });
  }
}

function setStateFromForm(form) {
  const formData = new FormData(form);
  state.settings = {
    ...state.settings,
    brandName: formData.get("brandName")?.toString() || DEFAULT_STATE.settings.brandName,
    brandTag: formData.get("brandTag")?.toString() || "",
    heroKicker: formData.get("heroKicker")?.toString() || "",
    heroHeadline: formData.get("heroHeadline")?.toString() || "",
    heroLead: formData.get("heroLead")?.toString() || "",
    servicesLead: formData.get("servicesLead")?.toString() || "",
    contactLead: formData.get("contactLead")?.toString() || "",
    serviceArea: formData.get("serviceArea")?.toString() || "",
    videoEmbedUrl: formData.get("videoEmbedUrl")?.toString() || "",
    email: formData.get("email")?.toString() || "",
    contactNotificationEndpoint: formData.get("contactNotificationEndpoint")?.toString() || "",
    phone: formData.get("phone")?.toString() || "",
    instagram: formData.get("instagram")?.toString() || "",
    responseTime: formData.get("responseTime")?.toString() || "",
  };
  saveState(state);
}

async function refreshMedia() {
  media = await listMedia();
}

function renderServicesEditor() {
  const target = document.getElementById("services-list");
  target.innerHTML = state.services
    .map(
      (service, index) => `
        <article class="card">
          <div class="card__body">
            <div class="section__eyebrow">Service ${index + 1}</div>
            <div class="field">
              <label>Title</label>
              <input data-service-field="title" data-service-index="${index}" value="${safeText(service.title)}" />
            </div>
            <div class="field">
              <label>Price</label>
              <input data-service-field="price" data-service-index="${index}" value="${safeText(service.price || "")}" placeholder="$250" />
            </div>
            <label class="field field--checkbox">
              <span class="field__label">Featured package</span>
              <input data-service-field="featured" data-service-index="${index}" type="checkbox" ${service.featured ? "checked" : ""} />
            </label>
            <div class="field">
              <label>Description</label>
              <textarea data-service-field="description" data-service-index="${index}">${safeText(service.description)}</textarea>
            </div>
            <div class="field">
              <label>Bullets, one per line</label>
              <textarea data-service-field="bullets" data-service-index="${index}">${safeText(service.bullets.join("\n"))}</textarea>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function galleryOrderItems() {
  return media
    .filter((item) => !item.type || String(item.type).startsWith("image/"))
    .filter((item) => item.placement === "gallery" || item.placement === "featured")
    .sort((a, b) => (a.order || 0) - (b.order || 0) || (b.createdAt || 0) - (a.createdAt || 0));
}

function renderGalleryOrderEditor() {
  const target = document.getElementById("gallery-order-list");
  if (!target) {
    return;
  }

  const items = galleryOrderItems();
  target.innerHTML = items.length
    ? items
        .map(
          (item, index) => `
            <article class="gallery-order-item" data-gallery-order-item="${item.id}">
              <img class="gallery-order-item__thumb" src="${mediaPreviewUrl(item)}" alt="${safeText(item.alt || item.title || "Gallery image")}" />
              <div class="gallery-order-item__meta">
                <div class="gallery-order-item__title">
                  <strong>${safeText(item.title || "Untitled")}</strong>
                  <span>#${index + 1}</span>
                </div>
                <div class="gallery-order-item__sub">${safeText(item.placement || "gallery")}</div>
              </div>
              <div class="gallery-order-item__actions">
                <button class="button ghost" type="button" data-gallery-order-up="${item.id}">Up</button>
                <button class="button ghost" type="button" data-gallery-order-down="${item.id}">Down</button>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="admin-note">Upload gallery images to use the reorder controls.</div>`;
}

function clientPortalCard(portal) {
  const items = portalMediaItems(portal.id);
  const ui = portalUiSnapshot(portal.id);
  const shareUrl = portal.portalUrl || (portal.slug ? portalUrl(portal) : "");
  const privateUrl = portal.privateUrl || (portal.slug && portal.directToken ? portalOneClickUrl(portal) : "");
  const accessNote = portal.accessCode
    ? "This access code will replace the current code the next time you save this portal."
    : portal.hasAccessCode
      ? "The current access code is already saved in Cloudflare. Enter a new one only if you want to rotate it."
      : "Add an access code, then save this portal before sharing it.";
  const cloudStatus = portal.cloudSynced
    ? "Live in Cloudflare"
    : "Saved only in this browser until you click Save portal";
  const feedback = ui.message || (portal.cloudSynced ? "Portal is ready to share. Upload more files or copy the link below." : "Make any edits you need, then click Save portal to make this delivery live.");
  const saveLabel = ui.savePending ? "Saving..." : "Save portal";
  const uploadLabel = ui.uploadPending
    ? `Uploading ${Math.max(ui.uploadStep || 0, 1)} / ${Math.max(ui.uploadTotal || 1, 1)}...`
    : "Upload to private storage";

  return `
    <article class="portal-admin-card" data-portal-card="${portal.id}">
      <div class="portal-admin-card__header">
        <div>
          <div class="section__eyebrow">Client portal</div>
          <h3 class="card__title">${safeText(portal.propertyTitle || portal.clientLabel || "Untitled delivery")}</h3>
          <div class="admin-note">${safeText(cloudStatus)}</div>
        </div>
        <label class="field field--checkbox">
          <span class="field__label">Portal active</span>
          <input data-portal-field="isActive" data-portal-id="${portal.id}" type="checkbox" ${portal.isActive !== false ? "checked" : ""} />
        </label>
      </div>

      <div class="admin-grid admin-grid--three">
        <div class="field">
          <label>Property title</label>
          <input data-portal-field="propertyTitle" data-portal-id="${portal.id}" value="${safeText(portal.propertyTitle || "")}" placeholder="123 Main Street" />
        </div>
        <div class="field">
          <label>Client / brokerage</label>
          <input data-portal-field="clientLabel" data-portal-id="${portal.id}" value="${safeText(portal.clientLabel || "")}" placeholder="Agent or brokerage name" />
        </div>
        <div class="field">
          <label>Delivered date</label>
          <input data-portal-field="deliveredAt" data-portal-id="${portal.id}" type="date" value="${safeText(portal.deliveredAt || "")}" />
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <label>Property address</label>
          <input data-portal-field="propertyAddress" data-portal-id="${portal.id}" value="${safeText(portal.propertyAddress || "")}" placeholder="Full property address" />
        </div>
        <div class="field">
          <label>Portal ID</label>
          <input data-portal-field="slug" data-portal-id="${portal.id}" value="${safeText(portal.slug || "")}" placeholder="Generated on save if left blank" />
        </div>
        <div class="field">
          <label>Access code</label>
          <input data-portal-field="accessCode" data-portal-id="${portal.id}" value="${safeText(portal.accessCode || "")}" placeholder="Required to unlock this portal" />
          <div class="admin-note">${safeText(accessNote)}</div>
        </div>
        <div class="field">
          <label>Files in portal</label>
          <input value="${items.length} uploaded" readonly />
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <label>Client note</label>
          <textarea data-portal-field="message" data-portal-id="${portal.id}" placeholder="Message shown on the delivery page">${safeText(portal.message || "")}</textarea>
        </div>
      </div>

      <div class="portal-admin-share">
        <div class="portal-admin-share__row">
          <strong>Portal URL</strong>
          <code>${safeText(shareUrl || "Save this portal to generate the final portal URL.")}</code>
        </div>
        <div class="portal-admin-share__row">
          <strong>One-click private link</strong>
          <code>${safeText(privateUrl || "Save this portal to generate the one-click private link.")}</code>
        </div>
      </div>

      <div class="admin-toolbar">
        <button class="button button--accent" type="button" data-save-portal="${portal.id}" ${ui.savePending ? "disabled" : ""}>${saveLabel}</button>
        <button class="button ghost" type="button" data-copy-portal-url="${portal.id}" ${shareUrl ? "" : "disabled"}>Copy portal URL</button>
        <button class="button ghost" type="button" data-copy-portal-link="${portal.id}" ${privateUrl ? "" : "disabled"}>Copy private link</button>
        <button class="button ghost" type="button" data-generate-portal-code="${portal.id}">Generate code</button>
        <button class="button ghost" type="button" data-rotate-portal-link="${portal.id}" ${portal.cloudSynced ? "" : "disabled"}>Refresh private link</button>
        <button class="button ghost danger" type="button" data-delete-portal="${portal.id}">Delete portal</button>
      </div>

      <div class="${portalFeedbackClass(ui.tone)}" data-portal-feedback>${safeText(feedback)}</div>

      <form class="portal-upload-form" data-portal-upload="${portal.id}">
        <div class="field" style="grid-column: 1 / -1;">
          <label>Upload images or video for this portal</label>
          <input type="file" accept="image/*,video/*" multiple data-portal-upload-input="${portal.id}" />
        </div>
        <div class="portal-upload-meta" data-portal-upload-meta>${safeText(portalUploadSummary(portal.id))}</div>
        <button class="button button--accent" type="submit" data-portal-upload-button ${ui.uploadPending ? "disabled" : ""}>${safeText(uploadLabel)}</button>
      </form>

      <div class="portal-asset-grid">
        ${items.length
          ? items
              .map(
                (item) => `
                  <article class="portal-asset-card">
                    ${String(item.type || "").startsWith("image/")
                      ? `<img class="portal-asset-card__thumb" src="${safeText(item.previewUrl || mediaPreviewUrl(item))}" alt="${safeText(item.alt || item.title || item.name || "Portal asset")}" />`
                      : `<div class="portal-asset-card__thumb portal-asset-card__thumb--video">Video</div>`}
                    <div class="portal-asset-card__body">
                      <strong>${safeText(item.title || item.name || "Portal asset")}</strong>
                      <div class="admin-note">${safeText(item.name || item.type || "Uploaded file")}</div>
                    </div>
                    <button class="button ghost danger" type="button" data-delete-portal-media="${item.id}">Delete</button>
                  </article>
                `
              )
              .join("")
          : `<div class="admin-note">No files in this portal yet. Save the portal, then upload the finished media above.</div>`}
      </div>
    </article>
  `;
}

function renderClientPortalsEditor() {
  const target = document.getElementById("client-portals-list");
  if (!target) {
    return;
  }

  const portals = Array.isArray(state.clientPortals) ? state.clientPortals : [];
  target.innerHTML = portals.length
    ? portals.map((portal) => clientPortalCard(portal)).join("")
    : `<div class="admin-note">No client portals yet. Create one above, save it to Cloudflare, then upload the finished media and copy the delivery link.</div>`;
}

function updatePortalCardUi(portalId) {
  const card = document.querySelector(`[data-portal-card="${portalId}"]`);
  if (!card) {
    return;
  }

  const portal = portalRecordById(portalId);
  if (!portal) {
    return;
  }

  const ui = portalUiSnapshot(portalId);
  const feedback = card.querySelector("[data-portal-feedback]");
  const uploadMeta = card.querySelector("[data-portal-upload-meta]");
  const uploadButton = card.querySelector("[data-portal-upload-button]");
  const saveButton = card.querySelector(`[data-save-portal="${portalId}"]`);

  if (feedback) {
    const message = ui.message || (portal.cloudSynced ? "Portal is ready to share. Upload more files or copy the link below." : "Make any edits you need, then click Save portal to make this delivery live.");
    feedback.textContent = message;
    feedback.className = portalFeedbackClass(ui.tone);
  }

  if (uploadMeta) {
    uploadMeta.textContent = portalUploadSummary(portalId);
  }

  if (uploadButton) {
    uploadButton.disabled = Boolean(ui.uploadPending);
    uploadButton.textContent = ui.uploadPending
      ? `Uploading ${Math.max(ui.uploadStep || 0, 1)} / ${Math.max(ui.uploadTotal || 1, 1)}...`
      : "Upload to private storage";
  }

  if (saveButton) {
    saveButton.disabled = Boolean(ui.savePending);
    saveButton.textContent = ui.savePending ? "Saving..." : "Save portal";
  }
}

function mediaEditorRow(item) {
  const url = mediaPreviewUrl(item);

  return `
    <article class="media-row" data-media-row="${item.id}">
      <img class="media-row__thumb" src="${url}" alt="${safeText(item.alt || item.title || "Upload")}" />
      <div class="media-row__meta">
        <div class="media-row__title">
          <strong>${safeText(item.title || "Untitled")}</strong>
          <span class="media-row__id">${safeText(item.id)}</span>
        </div>
        <div class="field">
          <label>Caption</label>
          <textarea data-media-field="caption" data-media-id="${item.id}">${safeText(item.caption || "")}</textarea>
        </div>
        <div class="field">
          <label>Alt</label>
          <input data-media-field="alt" data-media-id="${item.id}" value="${safeText(item.alt || "")}" />
        </div>
      </div>
      <div class="field">
        <label>Title</label>
        <input data-media-field="title" data-media-id="${item.id}" value="${safeText(item.title || "")}" />
      </div>
      <div class="field">
        <label>Placement</label>
        <select data-media-field="placement" data-media-id="${item.id}">
          <option value="gallery" ${item.placement === "gallery" ? "selected" : ""}>Gallery</option>
          <option value="featured" ${item.placement === "featured" ? "selected" : ""}>Featured</option>
          <option value="logo" ${item.placement === "logo" ? "selected" : ""}>Header logo</option>
          <option value="hero" ${item.placement === "hero" ? "selected" : ""}>Daytime background</option>
          <option value="reveal" ${item.placement === "reveal" ? "selected" : ""}>Night reveal</option>
          <option value="services" ${item.placement === "services" ? "selected" : ""}>Services</option>
          <option value="contact" ${item.placement === "contact" ? "selected" : ""}>Contact</option>
          <option value="video" ${item.placement === "video" ? "selected" : ""}>Video</option>
          <option value="hidden" ${item.placement === "hidden" ? "selected" : ""}>Hidden</option>
        </select>
      </div>
      <div class="field">
        <label>Order</label>
        <input data-media-field="order" data-media-id="${item.id}" type="number" value="${Number.isFinite(item.order) ? item.order : 0}" />
      </div>
      <div class="media-actions">
        <button class="button ghost" type="button" data-media-save="${item.id}">Save</button>
        <button class="button ghost danger" type="button" data-media-delete="${item.id}">Delete</button>
      </div>
    </article>
  `;
}

async function renderMediaList() {
  const target = document.getElementById("media-list");
  const publicItems = media.filter((item) => !item.portalId);
  const portalItemCount = media.length - publicItems.length;
  target.innerHTML = publicItems.length
    ? `${portalItemCount ? `<div class="admin-note">Client delivery uploads are managed in the Client delivery section below. ${portalItemCount} portal file${portalItemCount === 1 ? "" : "s"} hidden from this library.</div>` : ""}${publicItems.map((item) => mediaEditorRow(item)).join("")}`
    : `<div class="admin-note">${portalItemCount ? "Only client delivery uploads exist right now. Manage those in the Client delivery section." : "No uploads yet. Use the upload form above to add your first images."}</div>`;
}

function wireBrandForm() {
  const form = document.getElementById("brand-form");
  form.addEventListener("input", () => {
    setStateFromForm(form);
    renderFooter();
  });
}

function wireFeaturedFrameForm() {
  const form = document.getElementById("featured-frame-form");
  if (!form) {
    return;
  }

  form.addEventListener("input", () => {
    state.settings.featuredFrameTitle =
      form.querySelector('[name="featuredFrameTitle"]').value || "Selected work";
    state.settings.featuredFrameLead =
      form.querySelector('[name="featuredFrameLead"]').value ||
      "A single image can carry the whole listing.";
    state.settings.featuredFrameMediaId = form.querySelector('[name="featuredFrameMediaId"]').value || "";
    saveState(state);
  });
}

function collectProofCardsFromForm(form) {
  return [1, 2, 3].map((index) => ({
    eyebrow: form.querySelector(`[name="proofCard${index}Eyebrow"]`)?.value || "",
    title: form.querySelector(`[name="proofCard${index}Title"]`)?.value || "",
    text: form.querySelector(`[name="proofCard${index}Text"]`)?.value || "",
  }));
}

function wireProofForm() {
  const form = document.getElementById("proof-form");
  if (!form) {
    return;
  }

  const status = document.getElementById("proof-status");
  const saveButton = document.getElementById("save-proof");

  saveButton?.addEventListener("click", () => {
    state.settings.proofEyebrow =
      form.querySelector('[name="proofEyebrow"]').value || "Why agents book this";
    state.settings.proofTitle =
      form.querySelector('[name="proofTitle"]').value ||
      "Everything is designed to make the listing feel more valuable, not more complicated.";
    state.settings.proofLead =
      form.querySelector('[name="proofLead"]').value ||
      "The experience stays clean, fast, and premium, so the focus stays on the property and the confidence it creates for buyers.";
    state.settings.proofCards = collectProofCardsFromForm(form);
    saveState(state);
    if (status) {
      status.textContent = "Proof section saved.";
    }
    alert("Proof section saved.");
  });

  form.addEventListener("input", () => {
    state.settings.proofEyebrow =
      form.querySelector('[name="proofEyebrow"]').value || "Why agents book this";
    state.settings.proofTitle =
      form.querySelector('[name="proofTitle"]').value ||
      "Everything is designed to make the listing feel more valuable, not more complicated.";
    state.settings.proofLead =
      form.querySelector('[name="proofLead"]').value ||
      "The experience stays clean, fast, and premium, so the focus stays on the property and the confidence it creates for buyers.";
    state.settings.proofCards = collectProofCardsFromForm(form);
    saveState(state);
    if (status) {
      status.textContent = "Proof section autosaved in this browser.";
    }
  });
}

function renderFeaturedFrameOptions() {
  const select = document.querySelector('[name="featuredFrameMediaId"]');
  if (!select) {
    return;
  }

  const selectedId = state.settings.featuredFrameMediaId || "";
  const imageMedia = media.filter((item) => !item.type || String(item.type).startsWith("image/"));
  const options = [
    `<option value="" ${selectedId ? "" : "selected"}>Auto-pick first gallery image</option>`,
    ...imageMedia.map(
      (item) =>
        `<option value="${safeText(item.id)}" ${selectedId === item.id ? "selected" : ""}>${safeText(item.title || item.name || item.id)}${item.placement ? ` (${safeText(item.placement)})` : ""}</option>`
    ),
  ].join("");

  select.innerHTML = options;
}

function syncSettingsFromForms() {
  const brandForm = document.getElementById("brand-form");
  if (brandForm) {
    setStateFromForm(brandForm);
  }

  const featuredFrameForm = document.getElementById("featured-frame-form");
  if (featuredFrameForm) {
    state.settings.featuredFrameTitle =
      featuredFrameForm.querySelector('[name="featuredFrameTitle"]').value || "Selected work";
    state.settings.featuredFrameLead =
      featuredFrameForm.querySelector('[name="featuredFrameLead"]').value ||
      "A single image can carry the whole listing.";
    state.settings.featuredFrameMediaId =
      featuredFrameForm.querySelector('[name="featuredFrameMediaId"]').value || "";
  }

  const proofForm = document.getElementById("proof-form");
  if (proofForm) {
    state.settings.proofEyebrow =
      proofForm.querySelector('[name="proofEyebrow"]').value || "Why agents book this";
    state.settings.proofTitle =
      proofForm.querySelector('[name="proofTitle"]').value ||
      "Everything is designed to make the listing feel more valuable, not more complicated.";
    state.settings.proofLead =
      proofForm.querySelector('[name="proofLead"]').value ||
      "The experience stays clean, fast, and premium, so the focus stays on the property and the confidence it creates for buyers.";
    state.settings.proofCards = collectProofCardsFromForm(proofForm);
  }
}

function syncServicesFromEditor() {
  const nextServices = state.services.map((service, index) => {
    const next = { ...service };
    const inputs = document.querySelectorAll(`[data-service-index="${index}"]`);
    inputs.forEach((field) => {
      const key = field.dataset.serviceField;
      if (!key) {
        return;
      }

      if (key === "bullets") {
        next.bullets = field.value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        return;
      }

      if (key === "featured") {
        next.featured = field.checked;
        return;
      }

      next[key] = field.value;
    });

    return next;
  });

  state.services = nextServices;
}

function isOptimizablePublicImage(item) {
  return (
    !item?.portalId &&
    String(item?.type || "").startsWith("image/") &&
    OPTIMIZED_PUBLIC_IMAGE_PLACEMENTS.has(String(item?.placement || "gallery"))
  );
}

function variantRelativePath(itemId, variantName) {
  return `assets/uploads/${itemId}-${variantName}.${PUBLIC_IMAGE_VARIANT_EXTENSION}`;
}

function scaledDimensions(width, height, maxWidth) {
  const safeWidth = Math.max(1, Math.round(Number(width) || maxWidth || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || safeWidth));
  if (!maxWidth || safeWidth <= maxWidth) {
    return { width: safeWidth, height: safeHeight };
  }

  const scale = maxWidth / safeWidth;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

async function loadSourceBlobForVariants(item) {
  if (item?.blob instanceof Blob) {
    return item.blob;
  }

  if (!item?.src) {
    throw new Error(`No image source is available for ${item?.title || item?.id || "this media item"}.`);
  }

  const response = await fetch(item.src, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load ${item.title || item.id || "this image"} for optimization.`);
  }

  return response.blob();
}

function loadRenderableImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.onload = () =>
      resolve({
        image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        revoke() {
          URL.revokeObjectURL(url);
        },
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to decode one of the uploaded images."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("This browser could not encode the optimized image format."));
      },
      type,
      quality
    );
  });
}

async function buildOptimizedImagePackage(item) {
  const sourceBlob = await loadSourceBlobForVariants(item);
  const { image, width, height, revoke } = await loadRenderableImage(sourceBlob);

  try {
    const generatedFiles = [];
    const variants = {};

    for (const variant of PUBLIC_IMAGE_VARIANTS) {
      const target = scaledDimensions(width, height, variant.maxWidth);
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("The browser could not prepare the image optimizer.");
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, target.width, target.height);

      const blob = await canvasToBlob(canvas, PUBLIC_IMAGE_VARIANT_TYPE, variant.quality);
      const relativePath = variantRelativePath(item.id, variant.name);

      generatedFiles.push({
        path: relativePath,
        type: PUBLIC_IMAGE_VARIANT_TYPE,
        data: await blobToBase64(blob),
      });

      variants[variant.name] = {
        src: `./${relativePath}`,
        type: PUBLIC_IMAGE_VARIANT_TYPE,
        width: target.width,
        height: target.height,
      };
    }

    return {
      src: variants.full?.src || item.src || "",
      type: PUBLIC_IMAGE_VARIANT_TYPE,
      variants,
      generatedFiles,
    };
  } finally {
    revoke();
  }
}

function collectMediaDraftsFromDom() {
  const draftById = new Map(media.map((item) => [item.id, item]));

  return Array.from(document.querySelectorAll("[data-media-row]")).map((row) => {
    const id = row.dataset.mediaRow;
    const base = draftById.get(id) || { id };

    return {
      ...base,
      title: row.querySelector('[data-media-field="title"]')?.value || "",
      caption: row.querySelector('[data-media-field="caption"]')?.value || "",
      alt: row.querySelector('[data-media-field="alt"]')?.value || "",
      placement: row.querySelector('[data-media-field="placement"]')?.value || "gallery",
      order: Number(row.querySelector('[data-media-field="order"]')?.value || 0),
    };
  });
}

function collectAllMediaDrafts() {
  const editedDrafts = collectMediaDraftsFromDom();
  const editedById = new Map(editedDrafts.map((item) => [item.id, item]));
  return media.map((item) => editedById.get(item.id) || item);
}

function buildMediaSaveRecord(item) {
  const extension = guessExtension(item);
  return {
    id: item.id,
    name: item.name || item.title || item.id,
    type: item.type || (item.src ? `image/${extension}` : "image/jpeg"),
    createdAt: item.createdAt || Date.now(),
    title: item.title || "",
    caption: item.caption || "",
    alt: item.alt || "",
    placement: item.placement || "gallery",
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : 0,
    featured: Boolean(item.featured),
    portalId: item.portalId || "",
    src: item.src || `./assets/uploads/${item.id}.${extension}`,
    variants: item.variants || null,
    blob: item.blob || null,
  };
}

function buildPublicMediaRecord(item) {
  const { blob, data, generatedFiles, portalId, ...rest } = item;
  return {
    ...rest,
    src: rest.src || `./assets/uploads/${rest.id}.${guessExtension(rest)}`,
    variants: rest.variants || null,
  };
}

async function buildPublishedClientPortals(mediaDrafts) {
  const usedSlugs = new Set();
  const localPortals = (Array.isArray(state.clientPortals) ? state.clientPortals : []).map((portal) => ({ ...portal }));

  for (const portal of localPortals) {
    const label = portal.propertyTitle || portal.clientLabel || "client portal";
    portal.slug = ensureUniqueSlug(portal.slug || label, usedSlugs);
    portal.isActive = portal.isActive !== false;
    portal.accessCode = String(portal.accessCode || "").trim();
  }

  return { localPortals, publishedPortals: [] };
}

async function buildSavePayload() {
  syncSettingsFromForms();
  syncServicesFromEditor();

  const mediaDrafts = collectAllMediaDrafts().filter((item) => !item.portalId);
  const { localPortals, publishedPortals } = await buildPublishedClientPortals(mediaDrafts);
  const payloadMedia = await Promise.all(
    mediaDrafts.map(async (item) => {
      const record = buildMediaSaveRecord(item);
      if (isOptimizablePublicImage(record) && (record.blob || !record.variants?.full?.src)) {
        const optimized = await buildOptimizedImagePackage(record);
        record.generatedFiles = optimized.generatedFiles;
        record.variants = optimized.variants;
        record.src = optimized.src;
        record.type = optimized.type;
      } else if (record.blob) {
        record.data = await blobToBase64(record.blob);
      }

      delete record.blob;
      return record;
    })
  );
  const publicMedia = payloadMedia.filter((item) => !item.portalId).map((item) => buildPublicMediaRecord(item));

  return {
    settings: state.settings,
    services: state.services,
    localClientPortals: localPortals,
    clientPortals: publishedPortals,
    media: payloadMedia,
    publicMedia,
    mediaDrafts,
    savedAt: new Date().toISOString(),
  };
}

async function saveToLocalFiles(payload) {
  const { mediaDrafts, localClientPortals, ...serializablePayload } = payload;
  const response = await fetch("./__admin/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(serializablePayload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Unable to save the site files.");
  }

  return response.json().catch(() => ({}));
}

async function ensureWorkspacePermission(handle) {
  if (!handle) {
    return false;
  }

  if (typeof handle.requestPermission !== "function" || typeof handle.queryPermission !== "function") {
    return true;
  }

  const current = await handle.queryPermission({ mode: "readwrite" });
  if (current === "granted") {
    return true;
  }

  const requested = await handle.requestPermission({ mode: "readwrite" });
  return requested === "granted";
}

async function writeFileToWorkspace(rootHandle, relativePath, contents) {
  const segments = String(relativePath)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!segments.length) {
    throw new Error("Invalid file path.");
  }

  const fileName = segments.pop();
  let directory = rootHandle;

  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }

  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
}

async function saveToLocalFolder(payload) {
  if (!window.showDirectoryPicker) {
    throw new Error("This browser does not support direct folder saves.");
  }

  if (!workspaceDirectoryHandle) {
    throw new Error("Link the project folder first.");
  }

  const allowed = await ensureWorkspacePermission(workspaceDirectoryHandle);
  if (!allowed) {
    throw new Error("Permission to write to the project folder was denied.");
  }

  for (const item of payload.media) {
    if (!item) {
      continue;
    }

    if (Array.isArray(item.generatedFiles) && item.generatedFiles.length) {
      for (const file of item.generatedFiles) {
        if (!file?.data || !file?.path) {
          continue;
        }

        const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
        await writeFileToWorkspace(workspaceDirectoryHandle, normalizeRelativePath(file.path), bytes);
      }
      continue;
    }

    const extension = guessExtension(item);
    const relativePath = item.src ? normalizeRelativePath(item.src) : `assets/uploads/${item.id}.${extension}`;
    if (item.data) {
      const bytes = Uint8Array.from(atob(item.data), (char) => char.charCodeAt(0));
      await writeFileToWorkspace(workspaceDirectoryHandle, relativePath, bytes);
    }
  }

  const siteData = {
    settings: payload.settings,
    services: payload.services,
    clientPortals: payload.clientPortals,
    media: payload.publicMedia || [],
    savedAt: new Date().toISOString(),
  };

  await writeFileToWorkspace(
    workspaceDirectoryHandle,
    "content/site-data.json",
    `${JSON.stringify(siteData, null, 2)}\n`
  );

  return siteData;
}

function updateLocalFolderStatus(message) {
  const status = document.getElementById("local-folder-status");
  if (!status) {
    return;
  }

  if (message) {
    status.textContent = message;
    return;
  }

  status.textContent = workspaceDirectoryHandle
    ? `Linked folder: ${workspaceDirectoryHandle.name || "project folder"}`
    : "No local folder linked yet.";
}

function normalizeRelativePath(path) {
  return String(path || "")
    .replace(/^[./\\]+/, "")
    .replace(/\\/g, "/");
}

async function seedMediaFromPublished(publishedMedia) {
  if (!Array.isArray(publishedMedia) || !publishedMedia.length) {
    return;
  }

  const existing = await listMedia();
  const existingIds = new Set(existing.map((item) => item.id));

  for (const item of publishedMedia) {
    if (existingIds.has(item.id)) {
      continue;
    }

    await putMedia({
      ...item,
      blob: null,
      src: item.src || "",
      name: item.name || item.title || item.id,
      type: item.type || "image/jpeg",
    });
  }
}

function wireHeaderLogoUpload() {
  const form = document.querySelector("[data-header-logo-upload]");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fileInput = form.querySelector("[data-header-logo-file]");
    const altInput = form.querySelector("[data-header-logo-alt]");
    const file = fileInput.files?.[0];
    if (!file) {
      alert("Choose an image file first.");
      return;
    }

    try {
      await uploadMediaFiles([file], {
        placement: "logo",
        title: "Header logo",
        alt: altInput?.value.trim() || "Header logo",
        order: 0,
      });
      form.reset();
      await syncAndRender();
    } catch (error) {
      alert(error.message || "Unable to upload the header logo.");
    }
  });
}

function wireHeroUploads() {
  document.querySelectorAll("[data-hero-upload]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const placement = form.dataset.heroUpload;
      const fileInput = form.querySelector('[data-hero-file]');
      const altInput = form.querySelector('[data-hero-alt]');
      const file = fileInput.files?.[0];
      const title = placement === "hero" ? "Daytime background" : "Night reveal";
      const alt = altInput?.value.trim() || title;

      if (!file) {
        alert("Choose an image file first.");
        return;
      }

      try {
        await uploadMediaFiles([file], {
          placement,
          title,
          alt,
          order: 0,
        });
        form.reset();
        await syncAndRender();
      } catch (error) {
        alert(error.message || "Unable to upload the hero image.");
      }
    });
  });
}

function wireUploadForm() {
  const form = document.getElementById("upload-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const placement = form.querySelector('[name="placement"]').value;
    const title = form.querySelector('[name="title"]').value;
    const caption = form.querySelector('[name="caption"]').value;
    const alt = form.querySelector('[name="alt"]').value;
    const order = Number(form.querySelector('[name="order"]').value || 0);
    const selectedFiles = Array.from(document.getElementById("file").files || []);

    try {
      await uploadMediaFiles(selectedFiles, {
        placement,
        title,
        caption,
        alt,
        order,
      });
      form.reset();
      form.querySelector('[name="placement"]').value = placement;
      form.querySelector('[name="order"]').value = order;
      await syncAndRender();
    } catch (error) {
      alert(error.message || "Unable to upload selected files.");
    }
  });
}

function wireServicesEditor() {
  const target = document.getElementById("services-list");
  const status = document.getElementById("services-status");

  function persistServices(message = "Services saved.") {
    saveState(state);
    if (status) {
      status.textContent = message;
    }
  }

  document.getElementById("save-services").addEventListener("click", () => {
    persistServices("Services saved.");
    alert("Services saved.");
  });

  target.addEventListener("input", (event) => {
    const field = event.target.closest("[data-service-field]");
    if (!field) {
      return;
    }

    const index = Number(field.dataset.serviceIndex);
    const key = field.dataset.serviceField;
    if (!state.services[index]) {
      return;
    }

    if (key === "bullets") {
      state.services[index].bullets = field.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } else if (key === "featured") {
      state.services[index].featured = field.checked;
    } else {
      state.services[index][key] = field.value;
    }

    persistServices("Services autosaved.");
  });
}

async function persistGalleryOrder() {
  const items = galleryOrderItems();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    await putMedia({
      ...item,
      order: index,
    });
  }

  await syncAndRender();
}

function wireGalleryOrderEditor() {
  const target = document.getElementById("gallery-order-list");
  const status = document.getElementById("gallery-order-status");
  if (!target) {
    return;
  }

  target.addEventListener("click", async (event) => {
    const upButton = event.target.closest("[data-gallery-order-up]");
    const downButton = event.target.closest("[data-gallery-order-down]");
    const direction = upButton ? -1 : downButton ? 1 : 0;
    const targetId = upButton?.dataset.galleryOrderUp || downButton?.dataset.galleryOrderDown;

    if (!direction || !targetId) {
      return;
    }

    const items = galleryOrderItems();
    const index = items.findIndex((item) => item.id === targetId);
    if (index < 0) {
      return;
    }

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) {
      return;
    }

    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);

    for (let position = 0; position < reordered.length; position += 1) {
      await putMedia({
        ...reordered[position],
        order: position,
      });
    }

    if (status) {
      status.textContent = "Gallery order saved.";
    }
    await syncAndRender();
  });
}

function wireClientPortalsEditor() {
  const target = document.getElementById("client-portals-list");
  const addButton = document.getElementById("add-client-portal");
  const status = document.getElementById("client-portal-status");

  function persist(message) {
    saveState(state);
    if (status) {
      status.textContent = message;
    }
  }

  addButton?.addEventListener("click", async () => {
    state.clientPortals = [...(state.clientPortals || []), createClientPortalDraft()];
    persist("Client portal created.");
    await syncAndRender();
  });

  target?.addEventListener("input", (event) => {
    const field = event.target.closest("[data-portal-field]");
    if (!field) {
      return;
    }

    const portal = portalRecordById(field.dataset.portalId);
    if (!portal) {
      return;
    }

    const key = field.dataset.portalField;
    if (!key) {
      return;
    }

    portal[key] = field.type === "checkbox" ? field.checked : field.value;
    portal.cloudSynced = false;
    setPortalUiState(portal.id, {
      message: "Unsaved changes. Click Save portal to update the live delivery.",
      tone: "warn",
    });
    persist("Client portal saved in this browser. Click Save portal to make the cloud version live.");
  });

  target?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-portal-upload-input]");
    if (!input) {
      return;
    }

    const portalId = input.dataset.portalUploadInput;
    const files = Array.from(input.files || []);
    setPortalUiState(portalId, {
      selectedCount: files.length,
      selectedBytes: files.reduce((total, file) => total + (file.size || 0), 0),
      message: files.length ? "Files selected. Click upload when you're ready." : "",
      tone: files.length ? "neutral" : "neutral",
    });
    updatePortalCardUi(portalId);
  });

  target?.addEventListener("click", async (event) => {
    const savePortalButton = event.target.closest("[data-save-portal]");
    if (savePortalButton) {
      const portalId = savePortalButton.dataset.savePortal;
      try {
        setPortalUiState(portalId, {
          savePending: true,
          message: "Saving portal details to Cloudflare...",
          tone: "neutral",
        });
        updatePortalCardUi(portalId);
        const portal = await syncPortalToCloud(portalId);
        upsertPortalState(portal);
        setPortalUiState(portalId, {
          savePending: false,
          message: `Saved. ${portal.propertyTitle || portal.clientLabel || "Client delivery"} is now live and ready to share.`,
          tone: "success",
        });
        persist(`Portal saved. ${portal.propertyTitle || portal.clientLabel || "Client delivery"} is now live in Cloudflare.`);
        await syncAndRender();
      } catch (error) {
        setPortalUiState(portalId, {
          savePending: false,
          message: error.message || "Unable to save this client portal.",
          tone: "warn",
        });
        alert(error.message || "Unable to save this client portal.");
        if (status) {
          status.textContent = error.message || "Unable to save this client portal.";
        }
      }
      return;
    }

    const copyPortalUrlButton = event.target.closest("[data-copy-portal-url]");
    if (copyPortalUrlButton) {
      const portal = portalRecordById(copyPortalUrlButton.dataset.copyPortalUrl);
      if (portal?.slug) {
        await copyToClipboard(portal.portalUrl || portalUrl(portal), "Portal URL copied.");
        setPortalUiState(portal.id, {
          message: "Portal URL copied. This is the standard link to send with the access code.",
          tone: "success",
        });
        persist("Portal URL copied.");
        flashButtonLabel(copyPortalUrlButton, "Copied");
        updatePortalCardUi(portal.id);
      }
      return;
    }

    const copyPortalLinkButton = event.target.closest("[data-copy-portal-link]");
    if (copyPortalLinkButton) {
      const portal = portalRecordById(copyPortalLinkButton.dataset.copyPortalLink);
      if (portal?.slug && (portal?.directToken || portal?.privateUrl)) {
        await copyToClipboard(portal.privateUrl || portalOneClickUrl(portal), "Private link copied.");
        setPortalUiState(portal.id, {
          message: "Private link copied. This one opens the gallery without asking for the access code.",
          tone: "success",
        });
        persist("Private link copied.");
        flashButtonLabel(copyPortalLinkButton, "Copied");
        updatePortalCardUi(portal.id);
      }
      return;
    }

    const generateCodeButton = event.target.closest("[data-generate-portal-code]");
    if (generateCodeButton) {
      const portal = portalRecordById(generateCodeButton.dataset.generatePortalCode);
      if (!portal) {
        return;
      }

      portal.accessCode = createAccessCode();
      portal.cloudSynced = false;
      setPortalUiState(portal.id, {
        message: "A new access code was generated. Save the portal to make it live.",
        tone: "warn",
      });
      persist("A new access code was generated. Save the portal to make it live.");
      await syncAndRender();
      return;
    }

    const rotatePortalLinkButton = event.target.closest("[data-rotate-portal-link]");
    if (rotatePortalLinkButton) {
      try {
        const targetPortalId = rotatePortalLinkButton.dataset.rotatePortalLink;
        setPortalUiState(targetPortalId, {
          message: "Refreshing the one-click private link...",
          tone: "neutral",
        });
        updatePortalCardUi(targetPortalId);
        const portal = await syncPortalToCloud(targetPortalId, { rotateDirectLink: true });
        upsertPortalState(portal);
        setPortalUiState(portal.id, {
          message: "The one-click private link was refreshed.",
          tone: "success",
        });
        persist("The one-click private link was refreshed.");
        await syncAndRender();
      } catch (error) {
        alert(error.message || "Unable to refresh the private link.");
      }
      return;
    }

    const deletePortalButton = event.target.closest("[data-delete-portal]");
    if (deletePortalButton) {
      const portalId = deletePortalButton.dataset.deletePortal;
      const portal = portalRecordById(portalId);
      if (!portal) {
        return;
      }

      if (!confirm(`Delete the portal "${portal.propertyTitle || portal.clientLabel || "Untitled delivery"}" and remove its uploaded files from private storage?`)) {
        return;
      }

      if (portal.cloudSynced) {
        await deleteCloudPortal(portalId);
      }

      clearPortalUiState(portalId);
      state.clientPortals = (state.clientPortals || []).filter((item) => item.id !== portalId);
      persist("Client portal deleted.");
      await syncAndRender();
      return;
    }

    const deletePortalMediaButton = event.target.closest("[data-delete-portal-media]");
    if (deletePortalMediaButton) {
      const mediaId = deletePortalMediaButton.dataset.deletePortalMedia;
      if (!confirm("Delete this file from the client portal?")) {
        return;
      }

      const portalCard = deletePortalMediaButton.closest("[data-portal-card]");
      const portalId = portalCard?.dataset.portalCard;
      if (!portalId) {
        return;
      }

      const updatedPortal = await deleteCloudPortalFile(portalId, mediaId);
      upsertPortalState(updatedPortal);
      setPortalUiState(portalId, {
        message: "Portal file deleted.",
        tone: "success",
      });
      persist("Portal file deleted.");
      await syncAndRender();
    }
  });

  target?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-portal-upload]");
    if (!form) {
      return;
    }

    event.preventDefault();
    const portalId = form.dataset.portalUpload;
    const fileInput = form.querySelector(`[data-portal-upload-input="${portalId}"]`);
    const files = Array.from(fileInput?.files || []);
    if (!files.length) {
      alert("Choose at least one image or video to upload.");
      return;
    }

    try {
      setPortalUiState(portalId, {
        uploadPending: true,
        uploadStep: 0,
        uploadTotal: files.length,
        message: `Preparing ${files.length} file${files.length === 1 ? "" : "s"} for upload...`,
        tone: "neutral",
      });
      updatePortalCardUi(portalId);
      if (status) {
        status.textContent = "Uploading portal files to private storage...";
      }
      const updatedPortal = await uploadPortalFilesToCloud(portalId, files, (current, total, file) => {
        setPortalUiState(portalId, {
          uploadPending: true,
          uploadStep: current,
          uploadTotal: total,
          message: `Uploading ${current} of ${total}: ${file.name}`,
          tone: "neutral",
        });
        updatePortalCardUi(portalId);
      });
      upsertPortalState(updatedPortal);
      form.reset();
      setPortalUiState(portalId, {
        uploadPending: false,
        uploadStep: 0,
        uploadTotal: 0,
        selectedCount: 0,
        selectedBytes: 0,
        message: `Upload complete. ${files.length} new file${files.length === 1 ? "" : "s"} added to this portal.`,
        tone: "success",
      });
      persist("Portal media uploaded to Cloudflare.");
      await syncAndRender();
    } catch (error) {
      setPortalUiState(portalId, {
        uploadPending: false,
        message: error.message || "Unable to upload the selected portal files.",
        tone: "warn",
      });
      alert(error.message || "Unable to upload the selected portal files.");
      if (status) {
        status.textContent = error.message || "Unable to upload the selected portal files.";
      }
    }
  });
}

function wireMediaListEvents() {
  const target = document.getElementById("media-list");
  target.addEventListener("click", async (event) => {
    const saveButton = event.target.closest("[data-media-save]");
    if (saveButton) {
      const id = saveButton.dataset.mediaSave;
      const row = target.querySelector(`[data-media-row="${id}"]`);
      const current = media.find((item) => item.id === id) || { id };
      await putMedia({
        ...current,
        title: row.querySelector('[data-media-field="title"]').value,
        caption: row.querySelector('[data-media-field="caption"]').value,
        alt: row.querySelector('[data-media-field="alt"]').value,
        placement: row.querySelector('[data-media-field="placement"]').value,
        order: Number(row.querySelector('[data-media-field="order"]').value || 0),
      });
      await syncAndRender();
      return;
    }

    const deleteButton = event.target.closest("[data-media-delete]");
    if (!deleteButton) {
      return;
    }

    if (!confirm("Delete this upload from the media library?")) {
      return;
    }

    const url = rowUrls.get(deleteButton.dataset.mediaDelete);
    if (url) {
      URL.revokeObjectURL(url);
      rowUrls.delete(deleteButton.dataset.mediaDelete);
    }

    await deleteMedia(deleteButton.dataset.mediaDelete);
    await syncAndRender();
  });
}

function wireBackupButtons() {
  const saveStatus = document.getElementById("save-status");
  const linkButton = document.getElementById("link-local-folder");
  const unlinkButton = document.getElementById("unlink-local-folder");

  updateLocalFolderStatus();

  linkButton?.addEventListener("click", async () => {
    if (!window.showDirectoryPicker) {
      alert("This browser does not support linking a local folder.");
      return;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      workspaceDirectoryHandle = handle;
      await saveWorkspaceDirectoryHandle(handle);
      updateLocalFolderStatus(`Linked folder: ${handle.name || "project folder"}`);
      if (saveStatus) {
        saveStatus.textContent = "Local folder linked.";
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        alert(error.message || "Could not link the local folder.");
      }
    }
  });

  unlinkButton?.addEventListener("click", async () => {
    workspaceDirectoryHandle = null;
    await clearWorkspaceDirectoryHandle();
    updateLocalFolderStatus();
    if (saveStatus) {
      saveStatus.textContent = "Local folder unlinked.";
    }
  });

  document.getElementById("save-all").addEventListener("click", async () => {
    try {
      if (saveStatus) {
        saveStatus.textContent = "Generating optimized media and saving changes...";
      }

      const payload = await buildSavePayload();
      state.settings = payload.settings;
      state.services = payload.services;
      state.clientPortals = payload.localClientPortals;
      saveState(state);

      await clearMedia();
      rowUrls.forEach((url) => URL.revokeObjectURL(url));
      rowUrls.clear();
      for (const item of payload.mediaDrafts) {
        await putMedia(item);
      }

      await syncAndRender();

      if (workspaceDirectoryHandle) {
        await saveToLocalFolder(payload);
        if (saveStatus) {
          saveStatus.textContent = "Saved to the linked local folder.";
        }
        alert("Changes saved to the linked local folder.");
        return;
      }

      await saveToLocalFiles(payload);

      if (saveStatus) {
        saveStatus.textContent = "Saved to the site files.";
      }
      alert("Changes saved to the site files.");
    } catch (error) {
      const message =
        error?.message ||
        (workspaceDirectoryHandle
          ? "Saved in the browser, but the linked local folder could not be written. Check folder permissions and try again."
          : "Saved in the browser. To write the actual project files, link the local folder in Settings > Local files and save again.");
      if (saveStatus) {
        saveStatus.textContent = message;
      }
      alert(message);
    }
  });

  document.getElementById("export-data").addEventListener("click", async () => {
    const exportPayload = {
      settings: state.settings,
      services: state.services,
      clientPortals: state.clientPortals,
      media: media.map(({ blob, ...rest }) => rest),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "portfolio-export.json";
    link.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("reset-demo").addEventListener("click", async () => {
    if (!confirm("Reset brand text and service cards to the defaults?")) {
      return;
    }
    await clearMedia();
    rowUrls.forEach((url) => URL.revokeObjectURL(url));
    rowUrls.clear();
    resetState();
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    saveState(state);
    await syncAndRender();
  });

  document.getElementById("clear-media").addEventListener("click", async () => {
    if (!confirm("Remove every upload from the media library?")) {
      return;
    }
    await clearMedia();
    rowUrls.forEach((url) => URL.revokeObjectURL(url));
    rowUrls.clear();
    await syncAndRender();
  });

  document.getElementById("import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    const parsed = JSON.parse(text);
    if (parsed.settings) {
      state.settings = { ...state.settings, ...parsed.settings };
    }
    if (Array.isArray(parsed.services)) {
      state.services = parsed.services;
    }
    if (Array.isArray(parsed.clientPortals)) {
      state.clientPortals = parsed.clientPortals;
    }
    if (Array.isArray(parsed.media)) {
      await clearMedia();
      rowUrls.forEach((url) => URL.revokeObjectURL(url));
      rowUrls.clear();
      for (const item of parsed.media) {
        await putMedia({
          ...item,
          blob: null,
          src: item.src || "",
        });
      }
    }
    saveState(state);
    await syncAndRender();
    event.target.value = "";
  });

  document.getElementById("save-publish-config").addEventListener("click", () => {
    publishConfig = {
      owner: document.getElementById("githubOwner").value.trim(),
      repo: document.getElementById("githubRepo").value.trim(),
      branch: document.getElementById("githubBranch").value.trim() || "main",
      token: document.getElementById("githubToken").value.trim(),
    };
    savePublishConfig(publishConfig);
    alert("Publish settings saved on this device.");
  });

  document.getElementById("load-live-state").addEventListener("click", async () => {
    try {
      const response = await fetch("./content/site-data.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("No published site data found yet.");
      }
      const published = await response.json();
      if (published.settings) {
        state.settings = { ...state.settings, ...published.settings };
      }
      if (Array.isArray(published.services)) {
        state.services = published.services;
      }
      if (Array.isArray(published.clientPortals)) {
        state.clientPortals = mergeClientPortals(state.clientPortals || [], published.clientPortals);
      }
      if (Array.isArray(published.media)) {
        const portalOnlyMedia = media.filter((item) => item.portalId);
        await clearMedia();
        rowUrls.forEach((url) => URL.revokeObjectURL(url));
        rowUrls.clear();
        for (const item of portalOnlyMedia) {
          await putMedia(item);
        }
        for (const item of published.media) {
          await putMedia({
            ...item,
            blob: null,
            src: item.src || "",
          });
        }
      }
      saveState(state);
      await syncAndRender();
      alert("Loaded the live site data into the editor.");
    } catch (error) {
      alert(error.message || "Unable to load live state.");
    }
  });

  document.getElementById("publish-live").addEventListener("click", async () => {
    const status = document.getElementById("publish-status");
    try {
      publishConfig = {
        owner: document.getElementById("githubOwner").value.trim(),
        repo: document.getElementById("githubRepo").value.trim(),
        branch: document.getElementById("githubBranch").value.trim() || "main",
        token: document.getElementById("githubToken").value.trim(),
      };

      if (!publishConfig.owner || !publishConfig.repo || !publishConfig.token) {
        throw new Error("Add the repo owner, repo name, and token first.");
      }

      savePublishConfig(publishConfig);
      status.textContent = "Generating optimized media...";
      const payload = await buildSavePayload();
      state.settings = payload.settings;
      state.services = payload.services;
      state.clientPortals = payload.localClientPortals;
      saveState(state);
      media = payload.mediaDrafts;
      await clearMedia();
      rowUrls.forEach((url) => URL.revokeObjectURL(url));
      rowUrls.clear();
      for (const item of payload.mediaDrafts) {
        await putMedia(item);
      }
      status.textContent = "Uploading optimized media and site data...";
      await publishToGitHub(payload);
      status.textContent = "Published. GitHub Pages may take a short moment to rebuild.";
      alert("Published to GitHub.");
    } catch (error) {
      status.textContent = error.message || "Publish failed.";
      alert(error.message || "Publish failed.");
    }
  });
}

function wireJumpLinks() {
  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.querySelector(button.dataset.jump);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function syncAndRender() {
  state = loadState();
  await refreshMedia();
  renderHeader();
  renderFooter();
  wireHeaderActions();
  renderFeaturedFrameOptions();
  renderGalleryOrderEditor();
  renderClientPortalsEditor();
  renderServicesEditor();
  await renderMediaList();
}

function guessExtension(item) {
  const name = item.name || "";
  const match = name.match(/\.([a-z0-9]+)$/i);
  if (match) {
    return match[1].toLowerCase();
  }

  if (!item.type) {
    return "bin";
  }

  if (item.type.includes("avif")) return "avif";
  if (item.type.includes("jpeg")) return "jpg";
  if (item.type.includes("png")) return "png";
  if (item.type.includes("webp")) return "webp";
  if (item.type.includes("gif")) return "gif";
  if (item.type.includes("mp4")) return "mp4";
  if (item.type.includes("quicktime")) return "mov";
  if (item.type.includes("webm")) return "webm";
  return "bin";
}

async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function encodePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function githubRequest(path, options = {}) {
  const url = `https://api.github.com${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${publishConfig.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `GitHub request failed: ${response.status}`);
  }

  return response.json();
}

async function putRepoFile(path, content, message) {
  let sha = null;
  try {
    const existing = await githubRequest(
      `/repos/${publishConfig.owner}/${publishConfig.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(publishConfig.branch)}`,
      { method: "GET" }
    );
    sha = existing.sha;
  } catch {
    sha = null;
  }

  const body = {
    message,
    content,
    branch: publishConfig.branch,
  };

  if (sha) {
    body.sha = sha;
  }

  return githubRequest(`/repos/${publishConfig.owner}/${publishConfig.repo}/contents/${encodePath(path)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

async function publishToGitHub(portalPayload = {}) {
  for (const item of portalPayload.media || []) {
    if (Array.isArray(item.generatedFiles) && item.generatedFiles.length) {
      for (const file of item.generatedFiles) {
        if (!file?.path || !file?.data) {
          continue;
        }

        await putRepoFile(file.path, file.data, `Publish media ${item.title || item.id}`);
      }
      continue;
    }

    const path = normalizeRelativePath(item.src || `assets/uploads/${item.id}.${guessExtension(item)}`);
    if (item.data) {
      await putRepoFile(path, item.data, `Publish media ${item.title || item.id}`);
    }
  }

  const publishPayload = {
    settings: portalPayload.settings || state.settings,
    services: portalPayload.services || state.services,
    clientPortals: [],
    media: portalPayload.publicMedia || [],
  };

  const json = JSON.stringify(publishPayload, null, 2);
  const encoded = btoa(
    Array.from(new TextEncoder().encode(json), (byte) => String.fromCharCode(byte)).join("")
  );
  await putRepoFile("content/site-data.json", encoded, "Publish portfolio content");
}

async function bootstrap() {
  if (!isAdminUnlocked()) {
    try {
      const session = await getAdminSession();
      if (session?.authenticated) {
        setAdminUnlocked(true);
      } else {
        renderLockedAdmin();
        wireAdminUnlockForm();
        return;
      }
    } catch {
      renderLockedAdmin();
      wireAdminUnlockForm();
      return;
    }
  }

  const published = await loadPublishedSiteData();
  if (published && !hasSavedState()) {
    state = mergePublishedState(published);
  } else {
    state = loadState();
  }

  saveState(state);
  workspaceDirectoryHandle = await loadWorkspaceDirectoryHandle().catch(() => null);

  if (Array.isArray(published?.media)) {
    await seedMediaFromPublished(published.media);
  }

  await refreshCloudPortals();

  mainEl.innerHTML = adminMarkup();
  wireHeaderActions();
  wireHeaderLogoUpload();
  wireBrandForm();
  wireFeaturedFrameForm();
  wireProofForm();
  wireHeroUploads();
  wireUploadForm();
  wireServicesEditor();
  wireGalleryOrderEditor();
  wireClientPortalsEditor();
  wireMediaListEvents();
  wireBackupButtons();
  wireJumpLinks();
  await syncAndRender();

  window.addEventListener("beforeunload", () => {
    rowUrls.forEach((url) => URL.revokeObjectURL(url));
  });
}

bootstrap().catch((error) => {
  console.error(error);
  mainEl.innerHTML = `
    <section class="admin-panel">
      <h1 class="admin-panel__title">Admin could not load</h1>
      <p class="admin-panel__text">Open the browser console for details. This usually means storage access was blocked in the current context.</p>
    </section>
  `;
});
