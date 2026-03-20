import {
  DEFAULT_STATE,
  clearMedia,
  deleteMedia,
  loadState,
  listMedia,
  putMedia,
  saveState,
  updateMedia,
  resetState,
} from "./storage.js";

const headerEl = document.getElementById("site-header");
const mainEl = document.getElementById("site-main");
const footerEl = document.getElementById("site-footer");
const PUBLISH_CONFIG_KEY = "portfolio-site-publish-config-v1";

let state = loadState();
let media = [];
const rowUrls = new Map();

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
        <button type="button" data-jump="#brand">Brand</button>
        <button type="button" data-jump="#uploads">General uploads</button>
        <button type="button" data-jump="#library">Library</button>
        <button type="button" data-jump="#services">Services</button>
        <button type="button" data-jump="#backup">Backup</button>
      </aside>

      <div class="admin-content">
        <section class="admin-panel" id="hero">
          <h2 class="admin-panel__title">Hero section</h2>
          <p class="admin-panel__text">Upload the daytime exterior and the night version here. The homepage uses the daytime image as the base and reveals the night image under the cursor, so this is the only place you need for the two-image effect.</p>
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
        </section>

        <section class="admin-panel" id="brand">
          <div class="admin-toolbar">
            <button class="button button--accent" type="button" id="save-all">Save all changes</button>
            <button class="button ghost" type="button" id="reset-demo">Reset to defaults</button>
            <button class="button ghost" type="button" id="export-data">Export JSON</button>
          </div>
          <h1 class="admin-panel__title">Brand settings</h1>
          <p class="admin-panel__text">Edit the words that show up across the site. The layout pulls directly from this data, so the front end updates without manual code edits.</p>

          <form class="admin-grid" id="brand-form">
            <div class="field">
              <label for="brandName">Brand name</label>
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
        </section>

        <section class="admin-panel" id="uploads">
          <h2 class="admin-panel__title">General uploads</h2>
          <p class="admin-panel__text">Use this for gallery images, featured work, services images, contact images, and video embeds. The Hero section above already handles the daytime and night pair.</p>
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
        </section>

        <section class="admin-panel" id="library">
          <h2 class="admin-panel__title">Media library</h2>
          <p class="admin-panel__text">Every upload can be re-placed, reordered, edited, or deleted from here.</p>
          <div class="media-list" id="media-list"></div>
        </section>

        <section class="admin-panel" id="services">
          <h2 class="admin-panel__title">Services</h2>
          <p class="admin-panel__text">Edit the service cards that appear on the home page and services page.</p>
          <div class="admin-grid" id="services-list"></div>
        </section>

        <section class="admin-panel" id="backup">
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

        <section class="admin-panel" id="publish">
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
      </div>
    </section>
  `;
}

async function uploadMediaFiles(files, { placement, title, caption = "", alt, order = 0 }) {
  if (!files.length) {
    throw new Error("Choose at least one image or video to upload.");
  }

  for (const file of files) {
    await putMedia({
      blob: file,
      name: file.name,
      type: file.type,
      title: title || file.name.replace(/\.[^.]+$/, ""),
      caption,
      alt: alt || title || file.name,
      placement,
      order,
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

function mediaEditorRow(item) {
  let url = rowUrls.get(item.id);
  if (!url) {
    url = URL.createObjectURL(item.blob);
    rowUrls.set(item.id, url);
  }

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
  target.innerHTML = media.length
    ? media.map((item) => mediaEditorRow(item)).join("")
    : `<div class="admin-note">No uploads yet. Use the upload form above to add your first images.</div>`;
}

function wireBrandForm() {
  const form = document.getElementById("brand-form");
  form.addEventListener("input", () => {
    setStateFromForm(form);
    renderFooter();
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
    } else {
      state.services[index][key] = field.value;
    }

    saveState(state);
  });
}

function wireMediaListEvents() {
  const target = document.getElementById("media-list");
  target.addEventListener("click", async (event) => {
    const saveButton = event.target.closest("[data-media-save]");
    if (saveButton) {
      const id = saveButton.dataset.mediaSave;
      const row = target.querySelector(`[data-media-row="${id}"]`);
      await updateMedia(id, {
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
  document.getElementById("save-all").addEventListener("click", () => {
    saveState(state);
    alert("Changes saved.");
  });

  document.getElementById("export-data").addEventListener("click", async () => {
    const exportPayload = {
      settings: state.settings,
      services: state.services,
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
      status.textContent = "Uploading media and site data...";
      await publishToGitHub();
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

async function publishToGitHub() {
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
      src: `./${path}`,
    });
  }

  const publishPayload = {
    settings: state.settings,
    services: state.services,
    media: uploadedMedia.map((item) => ({
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
  mainEl.innerHTML = adminMarkup();
  wireBrandForm();
  wireHeroUploads();
  wireUploadForm();
  wireServicesEditor();
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
