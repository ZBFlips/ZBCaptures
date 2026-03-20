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
  encryptPortalPayload,
} from "./portal-utils.js";

const headerEl = document.getElementById("site-header");
const mainEl = document.getElementById("site-main");
const footerEl = document.getElementById("site-footer");
const PUBLISH_CONFIG_KEY = "portfolio-site-publish-config-v1";

let state = loadState();
let media = [];
const rowUrls = new Map();
let workspaceDirectoryHandle = null;

function safeText(value) {
  return String(value || "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
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

function mediaPreviewUrl(item) {
  let url = rowUrls.get(item.id);
  if (!url) {
    url = item.blob ? URL.createObjectURL(item.blob) : item.src || "";
    if (item.blob) {
      rowUrls.set(item.id, url);
    }
  }

  return url;
}

function portalMediaItems(portalId) {
  return media
    .filter((item) => item.portalId === portalId)
    .sort((a, b) => {
      const left = Number.isFinite(Number(a.order)) ? Number(a.order) : 9999;
      const right = Number.isFinite(Number(b.order)) ? Number(b.order) : 9999;
      return left - right || String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""));
    });
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
  if (portal.accessCode) {
    url.searchParams.set("code", portal.accessCode);
  }
  return url.toString();
}

async function copyToClipboard(text, fallbackMessage) {
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    alert(fallbackMessage);
  } catch {
    window.prompt("Copy this value:", text);
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
  };
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
          <p class="admin-panel__text">Create private-ish client portals that still work on GitHub Pages. Each portal gets its own access code, encrypted delivery data, and downloadable originals.</p>
          <div class="admin-toolbar">
            <button class="button button--accent" type="button" id="add-client-portal">Create client portal</button>
            <span class="admin-note" id="client-portal-status">Share either the portal URL plus access code, or the one-click private link.</span>
          </div>
          <div class="admin-note" style="margin-bottom: 18px;">
            GitHub Pages is static hosting, so this uses encrypted portal data and unlisted media file paths rather than true server-side authentication.
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
              <div class="admin-note">Paste the Cloudflare Worker URL or any webhook endpoint that stores submissions and forwards them to your inbox. Leave blank to keep the default email draft flow.</div>
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
                For a production launch, the next step is to swap this browser storage layer for a real database and file bucket so uploads sync across devices.
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
              <div class="admin-note" id="publish-status">Publishing updates <code>content/site-data.json</code> plus any uploaded media files into the repo.</div>
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
  const shareUrl = portal.slug ? portalUrl(portal) : "";
  const privateUrl = portal.slug && portal.accessCode ? portalOneClickUrl(portal) : "";
  const accessNote = portal.accessCode
    ? "This access code is stored in this browser and is used to encrypt the portal when you save."
    : "Published portal codes are not recoverable from GitHub Pages. Set a new code if you need to share this portal again.";

  return `
    <article class="portal-admin-card" data-portal-card="${portal.id}">
      <div class="portal-admin-card__header">
        <div>
          <div class="section__eyebrow">Client portal</div>
          <h3 class="card__title">${safeText(portal.propertyTitle || portal.clientLabel || "Untitled delivery")}</h3>
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
          <code>${safeText(shareUrl || "Save to generate the final portal URL.")}</code>
        </div>
        <div class="portal-admin-share__row">
          <strong>One-click private link</strong>
          <code>${safeText(privateUrl || "Add an access code to generate a one-click link.")}</code>
        </div>
      </div>

      <div class="admin-toolbar">
        <button class="button ghost" type="button" data-copy-portal-url="${portal.id}" ${shareUrl ? "" : "disabled"}>Copy portal URL</button>
        <button class="button ghost" type="button" data-copy-portal-link="${portal.id}" ${privateUrl ? "" : "disabled"}>Copy private link</button>
        <button class="button ghost" type="button" data-generate-portal-code="${portal.id}">Generate code</button>
        <button class="button ghost danger" type="button" data-delete-portal="${portal.id}">Delete portal</button>
      </div>

      <form class="portal-upload-form" data-portal-upload="${portal.id}">
        <div class="field" style="grid-column: 1 / -1;">
          <label>Upload images or video for this portal</label>
          <input type="file" accept="image/*,video/*" multiple data-portal-upload-input="${portal.id}" />
        </div>
        <button class="button button--accent" type="submit">Upload to portal</button>
      </form>

      <div class="portal-asset-grid">
        ${items.length
          ? items
              .map(
                (item) => `
                  <article class="portal-asset-card">
                    ${String(item.type || "").startsWith("image/")
                      ? `<img class="portal-asset-card__thumb" src="${mediaPreviewUrl(item)}" alt="${safeText(item.alt || item.title || item.name || "Portal asset")}" />`
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
          : `<div class="admin-note">No files in this portal yet. Upload the finished media above.</div>`}
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
    : `<div class="admin-note">No client portals yet. Create one above, upload the finished media, and then save or publish to share it.</div>`;
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
    blob: item.blob || null,
  };
}

function buildPublicMediaRecord(item) {
  const { blob, data, portalId, ...rest } = item;
  return {
    ...rest,
    src: rest.src || `./assets/uploads/${rest.id}.${guessExtension(rest)}`,
  };
}

async function buildPublishedClientPortals(mediaDrafts) {
  const usedSlugs = new Set();
  const localPortals = (Array.isArray(state.clientPortals) ? state.clientPortals : []).map((portal) => ({ ...portal }));
  const publishedPortals = [];

  for (const portal of localPortals) {
    const label = portal.propertyTitle || portal.clientLabel || "client portal";
    portal.slug = ensureUniqueSlug(portal.slug || label, usedSlugs);
    portal.isActive = portal.isActive !== false;
    portal.accessCode = String(portal.accessCode || "").trim();

    if (!portal.accessCode) {
      throw new Error(`Add an access code for ${label} before saving.`);
    }

    const encryptedMedia = mediaDrafts
      .filter((item) => item.portalId === portal.id)
      .sort((a, b) => {
        const left = Number.isFinite(Number(a.order)) ? Number(a.order) : 9999;
        const right = Number.isFinite(Number(b.order)) ? Number(b.order) : 9999;
        return left - right || String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""));
      })
      .map((item, index) => {
        const record = buildMediaSaveRecord({
          ...item,
          placement: "client",
          portalId: portal.id,
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
        });

        return {
          id: record.id,
          name: record.name,
          type: record.type,
          createdAt: record.createdAt,
          title: record.title,
          caption: record.caption,
          alt: record.alt,
          order: record.order,
          src: record.src,
        };
      });

    const encryptedPayload = await encryptPortalPayload(
      {
        propertyTitle: portal.propertyTitle || "",
        clientLabel: portal.clientLabel || "",
        propertyAddress: portal.propertyAddress || "",
        deliveredAt: portal.deliveredAt || "",
        message: portal.message || "",
        media: encryptedMedia,
      },
      portal.accessCode
    );

    publishedPortals.push({
      id: portal.id,
      slug: portal.slug,
      propertyTitle: portal.propertyTitle || "",
      clientLabel: portal.clientLabel || "",
      deliveredAt: portal.deliveredAt || "",
      isActive: portal.isActive !== false,
      ...encryptedPayload,
    });
  }

  return { localPortals, publishedPortals };
}

async function buildSavePayload() {
  syncSettingsFromForms();
  syncServicesFromEditor();

  const mediaDrafts = collectAllMediaDrafts();
  const { localPortals, publishedPortals } = await buildPublishedClientPortals(mediaDrafts);
  const payloadMedia = await Promise.all(
    mediaDrafts.map(async (item) => {
      const record = buildMediaSaveRecord(item);
      if (record.blob) {
        record.data = await blobToBase64(record.blob);
      }
      delete record.blob;
      return record;
    })
  );

  return {
    settings: state.settings,
    services: state.services,
    localClientPortals: localPortals,
    clientPortals: publishedPortals,
    media: payloadMedia,
    publicMedia: payloadMedia.filter((item) => !item.portalId).map((item) => buildPublicMediaRecord(item)),
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

  const mediaOutput = [];

  for (const item of payload.media) {
    if (!item) {
      continue;
    }

    const extension = guessExtension(item);
    const relativePath = item.src ? normalizeRelativePath(item.src) : `assets/uploads/${item.id}.${extension}`;
    const finalPath = relativePath;

    if (item.data) {
      const bytes = Uint8Array.from(atob(item.data), (char) => char.charCodeAt(0));
      await writeFileToWorkspace(workspaceDirectoryHandle, finalPath, bytes);
    }

    mediaOutput.push({
      id: String(item.id),
      name: String(item.name || item.title || item.id),
      type: String(item.type || "application/octet-stream"),
      createdAt: item.createdAt,
      title: String(item.title || ""),
      caption: String(item.caption || ""),
      alt: String(item.alt || ""),
      placement: String(item.placement || "gallery"),
      order: item.order,
      featured: Boolean(item.featured),
      portalId: String(item.portalId || ""),
      src: `./${finalPath.replace(/^\.?\//, "")}`,
    });
  }

  const siteData = {
    settings: payload.settings,
    services: payload.services,
    clientPortals: payload.clientPortals,
    media: mediaOutput.filter((item) => !item.portalId).map(({ portalId, ...rest }) => rest),
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

    const portal = (state.clientPortals || []).find((item) => item.id === field.dataset.portalId);
    if (!portal) {
      return;
    }

    const key = field.dataset.portalField;
    if (!key) {
      return;
    }

    portal[key] = field.type === "checkbox" ? field.checked : field.value;
    persist("Client portal autosaved in this browser.");
  });

  target?.addEventListener("click", async (event) => {
    const copyPortalUrlButton = event.target.closest("[data-copy-portal-url]");
    if (copyPortalUrlButton) {
      const portal = (state.clientPortals || []).find((item) => item.id === copyPortalUrlButton.dataset.copyPortalUrl);
      if (portal?.slug) {
        await copyToClipboard(portalUrl(portal), "Portal URL copied.");
      }
      return;
    }

    const copyPortalLinkButton = event.target.closest("[data-copy-portal-link]");
    if (copyPortalLinkButton) {
      const portal = (state.clientPortals || []).find((item) => item.id === copyPortalLinkButton.dataset.copyPortalLink);
      if (portal?.slug && portal?.accessCode) {
        await copyToClipboard(portalOneClickUrl(portal), "Private link copied.");
      }
      return;
    }

    const generateCodeButton = event.target.closest("[data-generate-portal-code]");
    if (generateCodeButton) {
      const portal = (state.clientPortals || []).find((item) => item.id === generateCodeButton.dataset.generatePortalCode);
      if (!portal) {
        return;
      }

      portal.accessCode = createAccessCode();
      persist("A new access code was generated.");
      await syncAndRender();
      return;
    }

    const deletePortalButton = event.target.closest("[data-delete-portal]");
    if (deletePortalButton) {
      const portalId = deletePortalButton.dataset.deletePortal;
      const portal = (state.clientPortals || []).find((item) => item.id === portalId);
      if (!portal) {
        return;
      }

      if (!confirm(`Delete the portal "${portal.propertyTitle || portal.clientLabel || "Untitled delivery"}" and remove its uploaded files from the local library?`)) {
        return;
      }

      for (const item of portalMediaItems(portalId)) {
        const url = rowUrls.get(item.id);
        if (url) {
          URL.revokeObjectURL(url);
          rowUrls.delete(item.id);
        }
        await deleteMedia(item.id);
      }

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

      const url = rowUrls.get(mediaId);
      if (url) {
        URL.revokeObjectURL(url);
        rowUrls.delete(mediaId);
      }

      await deleteMedia(mediaId);
      if (status) {
        status.textContent = "Portal file deleted.";
      }
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

    const currentItems = portalMediaItems(portalId);
    const nextOrder = currentItems.length
      ? Math.max(...currentItems.map((item) => Number(item.order) || 0)) + 1
      : 0;

    try {
      await uploadMediaFiles(files, {
        placement: "client",
        portalId,
        order: nextOrder,
      });
      form.reset();
      if (status) {
        status.textContent = "Portal media uploaded.";
      }
      await syncAndRender();
    } catch (error) {
      alert(error.message || "Unable to upload the selected portal files.");
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
        saveStatus.textContent = "Saving changes...";
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
      status.textContent = "Uploading media and site data...";
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
  const uploadedMedia = [];
  for (const item of media) {
    if (!item.blob) {
      uploadedMedia.push(item);
      continue;
    }

    const extension = guessExtension(item);
    const path = `assets/uploads/${item.id}.${extension}`;
    const base64 = await blobToBase64(item.blob);
    await putRepoFile(path, base64, `Publish media ${item.title || item.id}`);
    uploadedMedia.push({
      id: item.id,
      name: item.name,
      type: item.type,
      createdAt: item.createdAt,
      title: item.title,
      caption: item.caption,
      alt: item.alt,
      placement: item.placement,
      order: item.order,
      featured: item.featured,
      portalId: item.portalId || "",
      src: `./${path}`,
    });
  }

  const publishPayload = {
    settings: portalPayload.settings || state.settings,
    services: portalPayload.services || state.services,
    clientPortals: portalPayload.clientPortals || [],
    media: uploadedMedia
      .filter((item) => !item.portalId)
      .map((item) => ({
        id: item.id,
        title: item.title,
        caption: item.caption,
        alt: item.alt,
        placement: item.placement,
        order: item.order,
        featured: item.featured,
        type: item.type,
        src: item.src || `./assets/uploads/${item.id}.${guessExtension(item)}`,
      })),
  };

  const json = JSON.stringify(publishPayload, null, 2);
  const encoded = btoa(
    Array.from(new TextEncoder().encode(json), (byte) => String.fromCharCode(byte)).join("")
  );
  await putRepoFile("content/site-data.json", encoded, "Publish portfolio content");
}

async function bootstrap() {
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

  mainEl.innerHTML = adminMarkup();
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
