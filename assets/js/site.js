import { DEFAULT_STATE, loadState, listMedia } from "./storage.js";

const page = document.body.dataset.page;
const headerEl = document.getElementById("site-header");
const mainEl = document.getElementById("site-main");
const footerEl = document.getElementById("site-footer");
const lightboxEl = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxCaption = document.getElementById("lightbox-caption");

let state = loadState();
let mediaCache = [];
let objectUrls = [];

function safeText(value) {
  return String(value || "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
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
  };
}

async function loadPublishedSiteData() {
  try {
    const response = await fetch("./content/site-data.json", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

function navItems() {
  return [
    { href: "./index.html", label: "Home" },
    { href: "./services.html", label: "Services" },
    { href: "./contact.html", label: "Contact" },
    { href: "./admin.html", label: "Admin" },
  ];
}

function renderHeader() {
  const currentPath = location.pathname.split("/").pop() || "index.html";
  const links = navItems()
    .map(
      (item) => `
        <a href="${item.href}" ${currentPath === item.href.split("/").pop() ? 'aria-current="page"' : ""}>${item.label}</a>
      `
    )
    .join("");

  headerEl.innerHTML = `
    <div class="site-header">
      <div class="site-header__inner">
        <a class="brand" href="./index.html" aria-label="Go to home page">
          <span class="brand__name">${safeText(state.settings.brandName)}</span>
          <span class="brand__tag">${safeText(state.settings.brandTag)}</span>
        </a>
        <nav class="nav" aria-label="Primary navigation">
          ${links}
          <a class="nav__cta" href="./contact.html">${safeText(state.settings.heroCtas.secondaryLabel)}</a>
        </nav>
      </div>
    </div>
  `;
}

function renderFooter() {
  footerEl.innerHTML = `
    <div class="footer">
      <div class="footer__inner">
        <div>
          <strong>${safeText(state.settings.brandName)}</strong>
          <div>${safeText(state.settings.footerNote)}</div>
        </div>
        <div class="footer__links">
          <a href="./services.html">Services</a>
          <a href="./contact.html">Contact</a>
          <a href="./admin.html">Admin</a>
        </div>
      </div>
    </div>
  `;
}

function heroMedia() {
  return mediaCache.find((item) => item.placement === "hero") || null;
}

function heroRevealMedia() {
  return mediaCache.find((item) => item.placement === "reveal") || null;
}

function featuredMedia() {
  return mediaCache
    .filter((item) => item.placement === "gallery" || item.placement === "featured")
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function serviceMedia() {
  return mediaCache.filter((item) => item.placement === "services").sort((a, b) => (a.order || 0) - (b.order || 0));
}

function contactMedia() {
  return mediaCache.find((item) => item.placement === "contact") || null;
}

function videoMedia() {
  return mediaCache.find((item) => item.placement === "video") || null;
}

function mediaUrlFor(record) {
  if (record.src) {
    return record.src;
  }

  const match = objectUrls.find((entry) => entry.id === record.id);
  return match ? match.url : "";
}

function heroMarkup() {
  const backgroundImage = heroMedia();
  const revealImage = heroRevealMedia();
  const backgroundMarkup = backgroundImage
    ? `<img class="hero__backgroundImage" src="${mediaUrlFor(backgroundImage)}" alt="${safeText(backgroundImage.alt || backgroundImage.title || state.settings.brandName)}" />`
    : `<div class="hero__backgroundImage hero__backgroundImage--fallback" aria-hidden="true"></div>`;
  const revealMarkup = revealImage
    ? `<img class="hero__revealImage" src="${mediaUrlFor(revealImage)}" alt="${safeText(revealImage.alt || revealImage.title || "Reveal image")}" />`
    : "";

  const spotlight = featuredMedia()[0];
  const spotlightMarkup = spotlight
    ? `
      <article class="hero__card">
        <img class="hero__cardMedia" src="${mediaUrlFor(spotlight)}" alt="${safeText(spotlight.alt || spotlight.title || "Featured work")}" />
        <div class="hero__cardBody">
          <div class="hero__cardEyebrow">Featured frame</div>
          <h2 class="hero__cardTitle">${safeText(spotlight.title || "Selected work")}</h2>
          <p class="hero__cardLead">${safeText(spotlight.caption || "A single image can carry the whole listing.")}</p>
        </div>
      </article>
    `
    : `
      <article class="hero__card">
        <div class="hero__cardBody">
          <div class="hero__cardEyebrow">Built for speed</div>
          <h2 class="hero__cardTitle">Fast, sleek, and simple to manage.</h2>
          <p class="hero__cardLead">Upload photography, choose the placement, and let the page present the work without extra friction.</p>
        </div>
      </article>
    `;

  return `
    <section class="section hero" id="hero">
      <div class="hero__media">
        ${backgroundMarkup}
        ${revealMarkup}
      </div>
      <div class="hero__inner">
        <div class="hero__grid">
          <div class="hero__copy">
            <div class="hero__kicker">${safeText(state.settings.heroKicker)}</div>
            <h1 class="hero__title">${safeText(state.settings.heroHeadline)}</h1>
            <p class="hero__lead">${safeText(state.settings.heroLead)}</p>
            <div class="hero__actions">
              <a class="button button--accent" href="${state.settings.heroCtas.primaryHref}">${safeText(state.settings.heroCtas.primaryLabel)}</a>
              <a class="button" href="${state.settings.heroCtas.secondaryHref}">${safeText(state.settings.heroCtas.secondaryLabel)}</a>
            </div>
            <div class="hero__stats">
              ${state.settings.heroStats
                .map(
                  (stat) => `
                    <div class="stat">
                      <span class="stat__label">${safeText(stat.label)}</span>
                      <div class="stat__value">${safeText(stat.value)}</div>
                    </div>
                  `
                )
                .join("")}
            </div>
          </div>
          <div class="hero__rail">${spotlightMarkup}</div>
        </div>
      </div>
    </section>
  `;
}

function galleryMarkup() {
  const items = featuredMedia();
  if (!items.length) {
    return `
      <section class="section">
        <div class="section__eyebrow">Selected work</div>
        <h2 class="section__title">Add uploads in the admin panel to populate the portfolio.</h2>
        <p class="section__lead">The site is already wired to show images by placement. Upload media, choose gallery or featured, and it will appear here automatically.</p>
      </section>
    `;
  }

  return `
    <section class="section">
      <div class="section__eyebrow">Selected work</div>
      <h2 class="section__title">A portrait of the portfolio in motion.</h2>
      <p class="section__lead">${safeText(state.settings.servicesLead)}</p>
      <div class="media-grid" style="margin-top: 22px;">
        ${items
          .slice(0, 8)
          .map((item, index) => {
            const sizeClass = index === 0 ? "media-tile--large" : index === 3 ? "media-tile--wide" : "";
            return `
              <article class="media-tile ${sizeClass}">
                <button class="media-tile__button" data-preview data-id="${item.id}" type="button" aria-label="Preview ${safeText(item.title || "image")}">
                  <img class="media-tile__image" src="${mediaUrlFor(item)}" alt="${safeText(item.alt || item.title || "Portfolio image")}" />
                  <div class="media-tile__overlay">
                    <div class="media-tile__label">${safeText(item.featured ? "Featured" : item.placement)}</div>
                    <h3 class="media-tile__title">${safeText(item.title || "Untitled frame")}</h3>
                    <p class="media-tile__caption">${safeText(item.caption || "Add a caption in the admin panel.")}</p>
                  </div>
                </button>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function videoMarkup() {
  const embedUrl = state.settings.videoEmbedUrl;
  const record = videoMedia();

  if (!embedUrl && !record) {
    return `
      <section class="section">
        <div class="section__eyebrow">Motion</div>
        <h2 class="section__title">Add a video embed or upload a compressed clip.</h2>
        <p class="section__lead">If you want a reel on the homepage, place its URL in the admin panel. You can also store a lightweight video file in the browser media library.</p>
      </section>
    `;
  }

  if (embedUrl) {
    return `
      <section class="section video-panel">
        <div class="section__eyebrow">Motion</div>
        <h2 class="section__title">A moving piece that breaks the grid.</h2>
        <iframe src="${safeText(embedUrl)}" title="Video embed" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      </section>
    `;
  }

  return `
    <section class="section video-panel">
      <div class="section__eyebrow">Motion</div>
      <h2 class="section__title">${safeText(record.title || "Video feature")}</h2>
      <video controls playsinline>
        <source src="${mediaUrlFor(record)}" type="${safeText(record.type)}" />
      </video>
    </section>
  `;
}

function servicesMarkup() {
  const supportingMedia = serviceMedia();
  return `
    <section class="section">
      <div class="section__eyebrow">Services</div>
      <div class="grid grid--split" style="margin-top: 10px;">
        <div>
          <h2 class="section__title">Built to feel premium without feeling heavy.</h2>
          <p class="section__lead">${safeText(state.settings.servicesLead)}</p>
          <div class="section__actions">
            <a class="button button--accent" href="./services.html">View the full services page</a>
            <a class="button" href="./contact.html">Book a session</a>
          </div>
        </div>
        <div class="section-grid">
          ${state.services
            .map(
              (service) => `
                <article class="card card--interactive">
                  <div class="card__body">
                    <h3 class="card__title">${safeText(service.title)}</h3>
                    <p class="card__text">${safeText(service.description)}</p>
                    <div class="card__meta">
                      ${service.bullets
                        .map((bullet) => `<span class="pill">${safeText(bullet)}</span>`)
                        .join("")}
                    </div>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </div>
      ${supportingMedia.length ? `<div class="media-grid" style="margin-top: 22px;">${supportingMedia
        .slice(0, 3)
        .map(
          (item) => `
            <article class="media-tile">
              <img class="media-tile__image" src="${mediaUrlFor(item)}" alt="${safeText(item.alt || item.title || "Service image")}" />
              <div class="media-tile__overlay">
                <div class="media-tile__label">${safeText(item.featured ? "Featured service image" : "Service image")}</div>
                <h3 class="media-tile__title">${safeText(item.title || "Service image")}</h3>
                <p class="media-tile__caption">${safeText(item.caption || "Assigned from the admin panel.")}</p>
              </div>
            </article>
          `
        )
        .join("")}</div>` : ""}
    </section>
  `;
}

function contactMarkup() {
  const contactRecord = contactMedia();
  return `
    <section class="section">
      <div class="contact-layout">
        <div class="contact-panel">
          <div>
            <div class="section__eyebrow">Contact</div>
            <h2 class="section__title">Let’s turn the next property into something memorable.</h2>
            <p class="section__lead">${safeText(state.settings.contactLead)}</p>
          </div>
          <div class="contact-box">
            <div class="contact-row">
              <div class="contact-label">Email</div>
              <div class="contact-value"><a href="mailto:${safeText(state.settings.email)}">${safeText(state.settings.email)}</a></div>
            </div>
            <div class="contact-row">
              <div class="contact-label">Phone</div>
              <div class="contact-value"><a href="tel:${safeText(state.settings.phone)}">${safeText(state.settings.phone)}</a></div>
            </div>
            <div class="contact-row">
              <div class="contact-label">Instagram</div>
              <div class="contact-value">${safeText(state.settings.instagram)}</div>
            </div>
            <div class="contact-row">
              <div class="contact-label">Coverage</div>
              <div class="contact-value">${safeText(state.settings.serviceArea)}</div>
            </div>
          </div>
          <div class="contact-box">
            <strong>Best for:</strong>
            <div class="helper">Property launches, listing refreshes, luxury presentations, and media packages that need a clean, polished web presence.</div>
          </div>
        </div>
        <div class="contact-panel">
          ${contactRecord ? `<div class="card"><img class="card__image" src="${mediaUrlFor(contactRecord)}" alt="${safeText(contactRecord.alt || contactRecord.title || "Contact image")}" /></div>` : ""}
          <div class="contact-box">
            <form class="form" id="contact-form">
              <div class="field">
                <label for="name">Name</label>
                <input id="name" name="name" autocomplete="name" placeholder="Your name" />
              </div>
              <div class="field">
                <label for="email">Email</label>
                <input id="email" name="email" autocomplete="email" placeholder="you@example.com" />
              </div>
              <div class="field">
                <label for="message">Project details</label>
                <textarea id="message" name="message" placeholder="Property address, desired turnaround, number of photos, video needs, anything else."></textarea>
              </div>
              <button class="button button--accent" type="submit">Open email draft</button>
              <div class="helper">This version uses your email client so the site stays fast and doesn’t need a backend yet.</div>
            </form>
          </div>
        </div>
      </div>
    </section>
  `;
}

function servicesPageMarkup() {
  const serviceMediaItems = serviceMedia();
  return `
    <section class="section">
      <div class="section__eyebrow">Services</div>
      <h1 class="section__title">A simple offer structure with a premium presentation.</h1>
      <p class="section__lead">${safeText(state.settings.servicesLead)}</p>
    </section>

    <section class="section">
      <div class="section-grid grid--cards">
        ${state.services
          .map(
            (service, index) => `
              <article class="card card--interactive">
                <div class="card__body">
                  <div class="section__eyebrow">0${index + 1}</div>
                  <h2 class="card__title">${safeText(service.title)}</h2>
                  <p class="card__text">${safeText(service.description)}</p>
                  <div class="card__meta">
                    ${service.bullets.map((bullet) => `<span class="pill">${safeText(bullet)}</span>`).join("")}
                  </div>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>

    <section class="section">
      <div class="grid grid--split">
        <div>
          <div class="section__eyebrow">Process</div>
          <h2 class="section__title">A workflow that keeps the delivery clean.</h2>
          <div class="timeline" style="margin-top: 18px;">
            <div class="timeline__item">
              <div class="timeline__step">1</div>
              <div>
                <h3 class="timeline__title">Plan the shoot</h3>
                <p class="timeline__text">You share the property, the timeline, and any priorities that matter for the listing or campaign.</p>
              </div>
            </div>
            <div class="timeline__item">
              <div class="timeline__step">2</div>
              <div>
                <h3 class="timeline__title">Capture and curate</h3>
                <p class="timeline__text">The site is optimized for visual pacing so your best frames get room to breathe instead of getting buried.</p>
              </div>
            </div>
            <div class="timeline__item">
              <div class="timeline__step">3</div>
              <div>
                <h3 class="timeline__title">Deliver with clarity</h3>
                <p class="timeline__text">Everything is framed to feel modern, easy to scan, and ready for clients who expect something sharper than a standard template.</p>
              </div>
            </div>
          </div>
        </div>
        <div class="section-grid">
          ${serviceMediaItems.length
            ? serviceMediaItems
                .slice(0, 2)
                .map(
                  (item) => `
                    <article class="media-tile media-tile--wide">
                      <img class="media-tile__image" src="${mediaUrlFor(item)}" alt="${safeText(item.alt || item.title || "Service image")}" />
                      <div class="media-tile__overlay">
                        <div class="media-tile__label">${safeText(item.featured ? "Featured" : item.placement)}</div>
                        <h3 class="media-tile__title">${safeText(item.title || "Service image")}</h3>
                        <p class="media-tile__caption">${safeText(item.caption || "Assigned from the admin panel.")}</p>
                      </div>
                    </article>
                  `
                )
                .join("")
            : `
              <article class="card">
                <div class="card__body">
                  <h3 class="card__title">No service images yet.</h3>
                  <p class="card__text">Upload media in the admin dashboard and assign it to the services placement when you’re ready.</p>
                </div>
              </article>
            `}
        </div>
      </div>
    </section>
  `;
}

function homePageMarkup() {
  return [heroMarkup(), galleryMarkup(), videoMarkup(), servicesMarkup(), contactMarkup()].join("");
}

function openLightbox(recordId) {
  const record = mediaCache.find((item) => item.id === recordId);
  if (!record) {
    return;
  }

  const url = mediaUrlFor(record);
  lightboxImage.src = url;
  lightboxImage.alt = record.alt || record.title || "Portfolio image";
  lightboxCaption.textContent = [record.title, record.caption].filter(Boolean).join(" - ");
  lightboxEl.hidden = false;
  lightboxEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  if (!lightboxEl) {
    return;
  }

  lightboxEl.hidden = true;
  lightboxEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function wireHeroParallax() {
  const hero = document.getElementById("hero");
  if (!hero) {
    return;
  }

  const setHeroPoint = (x, y) => {
    hero.style.setProperty("--hero-x", `${x}%`);
    hero.style.setProperty("--hero-y", `${y}%`);
  };

  setHeroPoint(50, 50);

  hero.addEventListener("pointermove", (event) => {
    const bounds = hero.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    setHeroPoint(x, y);
  });

  hero.addEventListener("pointerleave", () => {
    setHeroPoint(50, 50);
  });
}

function wireLightbox() {
  if (!lightboxEl) {
    return;
  }

  lightboxEl.addEventListener("click", (event) => {
    if (event.target.closest("[data-lightbox-close]")) {
      closeLightbox();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lightboxEl.hidden) {
      closeLightbox();
    }
  });
}

function wirePreviewButtons() {
  document.querySelectorAll("[data-preview]").forEach((button) => {
    button.addEventListener("click", () => openLightbox(button.dataset.id));
  });
}

function wireContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = formData.get("name")?.toString().trim() || "";
    const email = formData.get("email")?.toString().trim() || "";
    const message = formData.get("message")?.toString().trim() || "";

    const subject = encodeURIComponent(`Project inquiry from ${name || "website visitor"}`);
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\n\nProject details:\n${message}\n`
    );

    window.location.href = `mailto:${state.settings.email}?subject=${subject}&body=${body}`;
  });
}

async function loadMedia() {
  mediaCache = await listMedia();
  objectUrls = mediaCache
    .filter((item) => item.blob)
    .map((item) => ({ id: item.id, url: URL.createObjectURL(item.blob) }));
}

function renderPage() {
  renderHeader();
  renderFooter();

  if (page === "home") {
    mainEl.innerHTML = homePageMarkup();
    wireHeroParallax();
    wirePreviewButtons();
    wireLightbox();
  }

  if (page === "services") {
    mainEl.innerHTML = servicesPageMarkup();
    wirePreviewButtons();
    wireLightbox();
  }

  if (page === "contact") {
    mainEl.innerHTML = contactMarkup();
    wireContactForm();
  }
}

async function bootstrap() {
  const published = await loadPublishedSiteData();
  if (published) {
    state = mergePublishedState(published);
    mediaCache = Array.isArray(published.media) ? published.media : [];
  } else {
    state = loadState();
    await loadMedia();
  }

  renderPage();

  window.addEventListener("beforeunload", () => {
    objectUrls.forEach((item) => URL.revokeObjectURL(item.url));
  });
}

bootstrap().catch((error) => {
  console.error(error);
  mainEl.innerHTML = `
    <section class="section">
      <div class="section__eyebrow">Error</div>
      <h1 class="section__title">Something blocked the page from loading.</h1>
      <p class="section__lead">Check the browser console for details. This usually means the browser restricted storage access in the current context.</p>
    </section>
  `;
});
