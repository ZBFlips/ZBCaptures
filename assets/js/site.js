import { decryptPortalPayload } from "./portal-utils.js";
import { DEFAULT_STATE, hasSavedState, loadState, listMedia } from "./storage.js";
import { loadUnlockedCloudPortal, unlockCloudPortal } from "./client-delivery-api.js";

const page = document.body.dataset.page;
const headerEl = document.getElementById("site-header");
const mainEl = document.getElementById("site-main");
const footerEl = document.getElementById("site-footer");
const lightboxEl = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxCount = document.getElementById("lightbox-count");
let headerMenuController = null;
let heroEffectController = null;
const lightboxPrev = document.querySelector("[data-lightbox-prev]");
const lightboxNext = document.querySelector("[data-lightbox-next]");

document.documentElement.classList.add("js");

const CLIENT_PORTAL_SESSION_PREFIX = "portfolio-client-portal-access:";

let state = loadState();
let mediaCache = [];
let objectUrls = [];
let activePortalData = null;
let activePortalMedia = [];
let clientPortalError = "";
let lightboxItems = [];
let lightboxIndex = -1;

function safeText(value) {
  return String(value || "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
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

function mergePublishedState(published) {
  return {
    ...DEFAULT_STATE,
    ...published,
    settings: {
      ...DEFAULT_STATE.settings,
      ...(published?.settings || {}),
    },
    services: Array.isArray(published?.services) ? published.services : DEFAULT_STATE.services,
    clientPortals: Array.isArray(published?.clientPortals) ? published.clientPortals : DEFAULT_STATE.clientPortals,
  };
}

function mergeMediaRecords(localMedia, publishedMedia) {
  const merged = [];
  const seen = new Set();

  for (const item of localMedia || []) {
    merged.push(item);
    if (item?.id) {
      seen.add(item.id);
    }
  }

  for (const item of publishedMedia || []) {
    if (item?.id && seen.has(item.id)) {
      continue;
    }

    merged.push(item);
  }

  return merged;
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
    { href: "./client-access.html", label: "Client Access" },
    { href: "./admin.html", label: "Admin" },
  ];
}

function headerLogoMedia() {
  return mediaCache
    .filter((item) => !item.portalId)
    .filter((item) => item.placement === "logo")
    .sort((a, b) => (a.order || 0) - (b.order || 0))[0] || null;
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
  const logo = headerLogoMedia();
  const logoMarkup = logo
    ? `<img class="brand__logo" src="${mediaUrlFor(logo)}" alt="${safeText(logo.alt || logo.title || state.settings.brandName)}" />`
    : `<span class="brand__name">${safeText(state.settings.brandName)}</span>`;

  headerEl.innerHTML = `
    <div class="site-header">
      <div class="site-header__inner">
        <a class="brand" href="./index.html" aria-label="Go to home page">
          ${logoMarkup}
          <span class="brand__tag">${safeText(state.settings.brandTag)}</span>
        </a>
        <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav" aria-label="Open navigation menu">
          <span class="nav-toggle__line"></span>
          <span class="nav-toggle__line"></span>
          <span class="nav-toggle__line"></span>
        </button>
        <nav class="nav" id="site-nav" data-site-nav aria-label="Primary navigation">
          ${links}
          <a class="nav__cta" href="./contact.html">${safeText(state.settings.heroCtas.secondaryLabel)}</a>
        </nav>
      </div>
    </div>
  `;
}

function wireHeaderMenu() {
  headerMenuController?.abort();
  headerMenuController = new AbortController();

  const toggle = headerEl.querySelector("[data-nav-toggle]");
  const nav = headerEl.querySelector("[data-site-nav]");
  const headerFrame = headerEl.querySelector(".site-header");
  if (!toggle || !nav || !headerFrame) {
    return;
  }

  const { signal } = headerMenuController;
  const mobileQuery = window.matchMedia("(max-width: 720px)");

  const closeMenu = () => {
    nav.classList.remove("is-open");
    headerFrame.classList.remove("site-header--menu-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation menu");
  };

  const openMenu = () => {
    nav.classList.add("is-open");
    headerFrame.classList.add("site-header--menu-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close navigation menu");
  };

  toggle.addEventListener(
    "click",
    () => {
      if (!mobileQuery.matches) {
        return;
      }

      if (nav.classList.contains("is-open")) {
        closeMenu();
        return;
      }

      openMenu();
    },
    { signal }
  );

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener(
      "click",
      () => {
        closeMenu();
      },
      { signal }
    );
  });

  window.addEventListener(
    "resize",
    () => {
      if (!mobileQuery.matches) {
        closeMenu();
      }
    },
    { signal }
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!mobileQuery.matches || !nav.classList.contains("is-open")) {
        return;
      }

      if (!headerFrame.contains(event.target)) {
        closeMenu();
      }
    },
    { signal }
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    },
    { signal }
  );
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
          <a href="./client-access.html">Client Access</a>
          <a href="./admin.html">Admin</a>
        </div>
      </div>
    </div>
  `;
}

function heroMedia() {
  return mediaCache.find((item) => !item.portalId && item.placement === "hero") || null;
}

function heroRevealMedia() {
  return mediaCache.find((item) => !item.portalId && item.placement === "reveal") || null;
}

function featuredMedia() {
  return mediaCache
    .filter((item) => !item.portalId)
    .filter((item) => item.placement === "gallery" || item.placement === "featured")
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function featuredFrameMedia() {
  const selectedId = state.settings.featuredFrameMediaId;
  if (selectedId) {
    const selected = mediaCache.find((item) => item.id === selectedId && !item.portalId);
    if (selected && (!selected.type || String(selected.type).startsWith("image/"))) {
      return selected;
    }
  }

  return featuredMedia().find((item) => !item.type || String(item.type).startsWith("image/")) || null;
}

function contactMedia() {
  return mediaCache.find((item) => !item.portalId && item.placement === "contact") || null;
}

function videoMedia() {
  return mediaCache.find((item) => !item.portalId && item.placement === "video") || null;
}

function lightboxRecords() {
  return [...mediaCache, ...activePortalMedia];
}

function mediaUrlFor(record) {
  if (record?.previewUrl) {
    return record.previewUrl;
  }

  if (record?.src) {
    return record.src;
  }

  const match = objectUrls.find((entry) => entry.id === record?.id);
  return match ? match.url : "";
}

function portalDownloadUrl(record) {
  return record?.downloadUrl || mediaUrlFor(record);
}

function findRecordById(recordId) {
  return lightboxRecords().find((item) => item.id === recordId) || null;
}

function refreshPreviewItems() {
  lightboxItems = Array.from(document.querySelectorAll("[data-preview]"));
}

function updateLightboxMeta() {
  if (lightboxCount) {
    lightboxCount.textContent = lightboxItems.length ? `${lightboxIndex + 1} / ${lightboxItems.length}` : "";
  }

  const hasMany = lightboxItems.length > 1;
  if (lightboxPrev) {
    lightboxPrev.disabled = !hasMany;
  }
  if (lightboxNext) {
    lightboxNext.disabled = !hasMany;
  }
}

function renderLightboxRecord(record) {
  if (!record) {
    return;
  }

  const url = mediaUrlFor(record);
  lightboxImage.src = url;
  lightboxImage.alt = record.alt || record.title || record.name || "Portfolio image";
  lightboxCaption.textContent = [record.title || record.name, record.caption].filter(Boolean).join(" - ");
  updateLightboxMeta();
}

function heroMarkup() {
  const backgroundImage = heroMedia();
  const revealImage = heroRevealMedia();
  const backgroundMarkup = backgroundImage
    ? `<img class="hero__backgroundImage" src="${mediaUrlFor(backgroundImage)}" alt="${safeText(backgroundImage.alt || backgroundImage.title || state.settings.brandName)}" fetchpriority="high" decoding="async" />`
    : `<div class="hero__backgroundImage hero__backgroundImage--fallback" aria-hidden="true"></div>`;
  const revealMarkup = revealImage
    ? `<img class="hero__revealImage" src="${mediaUrlFor(revealImage)}" alt="${safeText(revealImage.alt || revealImage.title || "Reveal image")}" fetchpriority="high" decoding="async" />`
    : "";

  const spotlight = featuredFrameMedia();
  const spotlightTitle = state.settings.featuredFrameTitle || "Selected work";
  const spotlightLead = state.settings.featuredFrameLead || "A single image can carry the whole listing.";
  const spotlightMarkup = spotlight
    ? `
      <article class="hero__card">
        <img class="hero__cardMedia" src="${mediaUrlFor(spotlight)}" alt="${safeText(spotlight.alt || spotlight.title || "Featured work")}" loading="eager" fetchpriority="high" decoding="async" />
        <div class="hero__cardBody">
          <div class="hero__cardEyebrow">Featured frame</div>
          <h2 class="hero__cardTitle">${safeText(spotlightTitle)}</h2>
          <p class="hero__cardLead">${safeText(spotlightLead)}</p>
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
              <a class="button button--accent" href="${safeText(state.settings.heroCtas.primaryHref)}">${safeText(state.settings.heroCtas.primaryLabel)}</a>
              <a class="button" href="${safeText(state.settings.heroCtas.secondaryHref)}">${safeText(state.settings.heroCtas.secondaryLabel)}</a>
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
  const topItems = items.slice(0, 4);
  const middleItems = items.slice(4, 12);
  const bottomItems = items.slice(12, 16);
  const showReelArrows = middleItems.length > 4;

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
      <div class="gallery-copy">
        <h2 class="section__title">What you'll receive</h2>
        <p class="section__lead">Consistent quality across every property, no matter the size.</p>
      </div>
      <div class="gallery-mobile-strip" aria-label="Portfolio gallery">
        <div class="gallery-mobile-strip__rail">
          ${items
            .map(
              (item) => `
                <article class="gallery-mobile-strip__item">
                  <button class="gallery-mobile-strip__button" data-preview data-id="${item.id}" type="button" aria-label="Preview ${safeText(item.title || item.name || "image")}">
                    <img class="gallery-mobile-strip__image" src="${mediaUrlFor(item)}" alt="${safeText(item.alt || item.title || item.name || "Portfolio image")}" loading="lazy" decoding="async" />
                  </button>
                </article>
              `
            )
            .join("")}
        </div>
      </div>
      <div class="gallery-stack">
        <div class="portfolio-grid gallery-grid">
          ${topItems
            .map(
              (item) => `
                <article class="media-tile">
                  <button class="media-tile__button" data-preview data-id="${item.id}" type="button" aria-label="Preview ${safeText(item.title || item.name || "image")}">
                    <img class="media-tile__image" src="${mediaUrlFor(item)}" alt="${safeText(item.alt || item.title || item.name || "Portfolio image")}" loading="lazy" decoding="async" />
                  </button>
                </article>
              `
            )
            .join("")}
        </div>
        ${middleItems.length
          ? `
            <div class="gallery-reel ${showReelArrows ? "gallery-reel--arrows" : ""}">
              ${showReelArrows ? `<button class="gallery-reel__nav gallery-reel__nav--prev" type="button" data-gallery-reel-prev aria-label="Scroll gallery images left">Previous</button>` : ""}
              <div class="gallery-reel__rail" aria-label="Additional gallery images" data-gallery-reel-rail>
                ${middleItems
                  .map(
                    (item) => `
                      <article class="gallery-reel__item">
                        <button class="gallery-reel__button" data-preview data-id="${item.id}" type="button" aria-label="Preview ${safeText(item.title || item.name || "image")}">
                          <img class="gallery-reel__image" src="${mediaUrlFor(item)}" alt="${safeText(item.alt || item.title || item.name || "Portfolio image")}" loading="lazy" decoding="async" />
                        </button>
                      </article>
                    `
                  )
                  .join("")}
              </div>
              ${showReelArrows ? `<button class="gallery-reel__nav gallery-reel__nav--next" type="button" data-gallery-reel-next aria-label="Scroll gallery images right">Next</button>` : ""}
            </div>
          `
          : ""}
        ${bottomItems.length
          ? `
            <div class="portfolio-grid gallery-grid">
              ${bottomItems
                .map(
                  (item) => `
                    <article class="media-tile">
                      <button class="media-tile__button" data-preview data-id="${item.id}" type="button" aria-label="Preview ${safeText(item.title || item.name || "image")}">
                        <img class="media-tile__image" src="${mediaUrlFor(item)}" alt="${safeText(item.alt || item.title || item.name || "Portfolio image")}" loading="lazy" decoding="async" />
                      </button>
                    </article>
                  `
                )
                .join("")}
            </div>
          `
          : ""}
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
        <p class="section__lead">If you want a reel on the homepage, place its URL in the admin panel. You can also store a lightweight video file in the media library.</p>
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
      <h2 class="section__title">${safeText(record.title || "Aerial Videography")}</h2>
      <video controls playsinline>
        <source src="${mediaUrlFor(record)}" type="${safeText(record.type)}" />
      </video>
    </section>
  `;
}

function servicesMarkup() {
  return `
    <section class="section">
      <div class="section__eyebrow">Services</div>
      <div class="services-home__layout">
        <div class="services-home__intro">
          <h2 class="section__title">High-performance media for premium listings.</h2>
          <p class="section__lead">${safeText(state.settings.servicesLead)}</p>
          <div class="section__actions">
            <a class="button button--accent" href="./services.html">View the full services page</a>
            <a class="button" href="./contact.html">Book a session</a>
          </div>
        </div>
        <div class="section-grid grid--cards services-home__cards">
          ${state.services
            .map(
              (service, index) => `
                <article class="card card--interactive ${service.featured ? "card--featured" : ""}">
                  <div class="card__body">
                    <div class="card__header">
                      <div>
                        <div class="card__eyebrow">${safeText(service.featured ? "Featured package" : `Package 0${index + 1}`)}</div>
                        <h3 class="card__title">${safeText(service.title)}</h3>
                      </div>
                      ${service.price ? `<div class="card__price">${safeText(service.price)}</div>` : ""}
                    </div>
                    <p class="card__text">${safeText(service.description)}</p>
                    <div class="card__meta">
                      ${(service.bullets || []).map((bullet) => `<span class="pill">${safeText(bullet)}</span>`).join("")}
                    </div>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function agentProofMarkup() {
  const proofCards = Array.isArray(state.settings.proofCards) && state.settings.proofCards.length
    ? state.settings.proofCards
    : DEFAULT_STATE.settings.proofCards;

  return `
    <section class="section services-page__proof">
      <div class="section__eyebrow">${safeText(state.settings.proofEyebrow || "Why agents book this")}</div>
      <div class="proof-layout">
        <div class="proof-layout__copy">
          <h2 class="section__title">${safeText(state.settings.proofTitle || "Everything is designed to make the listing feel more valuable, not more complicated.")}</h2>
          <p class="section__lead">${safeText(state.settings.proofLead || "The experience stays clean, fast, and premium, so the focus stays on the property and the confidence it creates for buyers.")}</p>
        </div>
        <div class="proof-grid">
          ${proofCards
            .map(
              (card, index) => `
                <article class="proof-card ${index === 1 ? "proof-card--accent" : ""}">
                  <div class="proof-card__eyebrow">${safeText(card.eyebrow || "Proof point")}</div>
                  <h3 class="proof-card__title">${safeText(card.title || "Supportive copy")}</h3>
                  <p class="proof-card__text">${safeText(card.text || "Add a short note in the admin panel.")}</p>
                </article>
              `
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

const testimonials = [
  {
    name: "Eric B.",
    role: "Gulf Coast Client",
    quote: "Timely, cost-effective, and a pleasure to work with. We'd book again.",
  },
  {
    name: "Caleb P.",
    role: "Client",
    quote: "Professional, kind, and excellent on short notice. Highly recommend.",
  },
  {
    name: "Mike H.",
    role: "Repeat Client",
    quote: "Creative, organized, and fast. The quality is unmatched.",
  },
  {
    name: "Martha F.",
    role: "Client",
    quote: "Responsive, fair, and consistently high quality. I'd hire him again.",
  },
  {
    name: "Ryan D.",
    role: "Longtime Client",
    quote: "Passionate, collaborative, and always above and beyond.",
  },
  {
    name: "Nikki H.",
    role: "Client",
    quote: "Professional, polished, and better than I imagined.",
  },
];

function testimonialsMarkup() {
  return `
    <section class="section testimonials-strip">
      <div class="section__eyebrow">Client testimonials</div>
      <div class="testimonials-strip__header">
        <div>
          <h2 class="section__title">The kind of feedback that helps a listing feel safer to hire.</h2>
          <p class="section__lead">Clients want proof that the work is polished, responsive, and dependable. These are the words they use after booking.</p>
        </div>
        <div class="testimonials-strip__badge">
          <strong>5/5</strong>
          <span>client confidence</span>
        </div>
      </div>
      <div class="testimonials-strip__rail" aria-label="Client testimonials" data-testimonials-rail>
        ${testimonials
          .map(
            (item) => `
              <article class="testimonial-card">
                <div class="testimonial-card__stars" aria-hidden="true">*****</div>
                <blockquote class="testimonial-card__quote">"${safeText(item.quote)}"</blockquote>
                <div class="testimonial-card__footer">
                  <strong>${safeText(item.name)}</strong>
                  <span>${safeText(item.role)}</span>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function clientDeliveryTeaserMarkup() {
  return `
    <section class="section">
      <div class="section__eyebrow">Client delivery</div>
      <div class="grid--split section-grid">
        <div>
          <h2 class="section__title">A delivery portal that feels polished instead of technical.</h2>
          <p class="section__lead">Each finished shoot can be shared through a dedicated access page so your realtor can preview the work, download the original files, and move fast without guessing what to click.</p>
          <div class="section__actions">
            <a class="button button--accent" href="./client-access.html">Open client access</a>
            <a class="button" href="./contact.html">Book your appointment</a>
          </div>
        </div>
        <div class="timeline">
          <div class="timeline__item">
            <div class="timeline__step">01</div>
            <div>
              <h3 class="timeline__title">Receive your access link</h3>
              <p class="timeline__text">Each delivery includes a dedicated portal ID and access code so the gallery stays organized and easy to open.</p>
            </div>
          </div>
          <div class="timeline__item">
            <div class="timeline__step">02</div>
            <div>
              <h3 class="timeline__title">Review the media</h3>
              <p class="timeline__text">Open the gallery on desktop or mobile, preview the files, and confirm everything is ready for the listing launch.</p>
            </div>
          </div>
          <div class="timeline__item">
            <div class="timeline__step">03</div>
            <div>
              <h3 class="timeline__title">Download the originals</h3>
              <p class="timeline__text">Grab individual files or use the download-all button for the full delivery set in original resolution.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function contactMarkup() {
  const contactRecord = contactMedia();
  return `
    <section class="section contact-section">
      <div class="contact-layout">
        <div class="contact-panel">
          <div>
            <div class="section__eyebrow">Contact</div>
            <h2 class="section__title">Let's turn the next property into something memorable.</h2>
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
          ${contactRecord ? `<div class="card"><button class="media-tile__button" data-preview data-id="${contactRecord.id}" type="button" aria-label="Preview ${safeText(contactRecord.title || "contact image")}"><img class="card__image" src="${mediaUrlFor(contactRecord)}" alt="${safeText(contactRecord.alt || contactRecord.title || "Contact image")}" loading="lazy" decoding="async" /></button></div>` : ""}
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
              <div class="helper">If a notification endpoint is configured in the admin, this form saves the submission and emails you automatically. Otherwise it opens your email client.</div>
            </form>
          </div>
        </div>
      </div>
    </section>
  `;
}

function servicesPageMarkup() {
  return `
    <section class="section services-page__intro">
      <div class="section__eyebrow">Services</div>
      <h1 class="section__title">Elevate Your Listing, Engage Your Buyers.</h1>
      <p class="section__lead">${safeText(state.settings.servicesLead)}</p>
    </section>

    <section class="section services-page__packages">
      <div class="section-grid grid--cards services-packages">
        ${state.services
          .map(
            (service, index) => `
              <article class="card card--interactive ${service.featured ? "card--featured" : ""}">
                <div class="card__body">
                  <div class="card__header">
                    <div>
                      <div class="card__eyebrow">${safeText(service.featured ? "Featured package" : `0${index + 1}`)}</div>
                      <h2 class="card__title">${safeText(service.title)}</h2>
                    </div>
                    ${service.price ? `<div class="card__price">${safeText(service.price)}</div>` : ""}
                  </div>
                  <p class="card__text">${safeText(service.description)}</p>
                  <div class="card__metaLabel">Includes</div>
                  <div class="card__meta">
                    ${(service.bullets || []).map((bullet) => `<span class="pill">${safeText(bullet)}</span>`).join("")}
                  </div>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>

    ${agentProofMarkup()}

    ${videoMarkup()}
  `;
}

function homePageMarkup() {
  return [heroMarkup(), galleryMarkup(), servicesMarkup(), testimonialsMarkup(), clientDeliveryTeaserMarkup(), contactMarkup()].join("");
}

function portalSessionKey(slug) {
  return `${CLIENT_PORTAL_SESSION_PREFIX}${slug}`;
}

function portalSlugFromLocation() {
  return new URLSearchParams(window.location.search).get("portal")?.trim() || "";
}

function portalCodeFromLocation() {
  return new URLSearchParams(window.location.search).get("code")?.trim() || "";
}

function portalTokenFromLocation() {
  return new URLSearchParams(window.location.search).get("token")?.trim() || "";
}

function findPortalRecord(slug) {
  if (!slug) {
    return null;
  }

  return (state.clientPortals || []).find((portal) => portal.slug === slug) || null;
}

function sortedPortalMedia(items) {
  return [...(items || [])].sort((a, b) => {
    const left = Number.isFinite(Number(a.order)) ? Number(a.order) : 9999;
    const right = Number.isFinite(Number(b.order)) ? Number(b.order) : 9999;
    return left - right || String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""));
  });
}

function buildLocalPortalPayload(portal) {
  const sourceItems = Array.isArray(portal.files) && portal.files.length
    ? portal.files
    : mediaCache.filter((item) => item.portalId === portal.id);
  const items = sortedPortalMedia(sourceItems).map((item, index) => ({
    id: item.id,
    name: item.name || item.title || `asset-${index + 1}`,
    type: item.type || "image/jpeg",
    title: item.title || item.name || `Asset ${index + 1}`,
    caption: item.caption || "",
    alt: item.alt || item.title || item.name || "Client delivery media",
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    src: item.previewUrl || mediaUrlFor(item),
    downloadUrl: item.downloadUrl || mediaUrlFor(item),
  }));

  return {
    propertyTitle: portal.propertyTitle || "",
    clientLabel: portal.clientLabel || "",
    propertyAddress: portal.propertyAddress || "",
    deliveredAt: portal.deliveredAt || "",
    message: portal.message || "",
    media: items,
  };
}

function portalTypeLabel(item) {
  if (String(item.type || "").startsWith("video/")) {
    return "Video original";
  }

  return "Photo original";
}

function portalSummary(items) {
  return {
    total: items.length,
    photos: items.filter((item) => String(item.type || "").startsWith("image/")).length,
    videos: items.filter((item) => String(item.type || "").startsWith("video/")).length,
  };
}

function clientAccessIntroMarkup(slug) {
  const portal = slug ? findPortalRecord(slug) : null;
  const title = slug && portal
    ? "Enter the access code you were sent."
    : slug
      ? "That delivery link could not be found."
      : "Open your delivery portal.";
  const lead = slug && portal
    ? "Enter the access code from your email or text to unlock the gallery and download the original files."
    : slug
      ? "Double-check the portal ID or contact me if you need a fresh delivery link."
      : "If you were sent a portal ID and access code, enter them below. If you received a one-click link, opening it will take you straight to the gallery.";
  const statusMarkup = clientPortalError ? `<div class="helper" style="color: var(--warn);">${safeText(clientPortalError)}</div>` : "";

  return `
    <section class="section">
      <div class="section__eyebrow">Client delivery</div>
      <div class="grid--split section-grid">
        <div>
          <h1 class="section__title">${safeText(title)}</h1>
          <p class="section__lead">${safeText(lead)}</p>
          <form class="form" id="client-portal-access-form" style="margin-top: 22px;">
            ${slug ? `<input type="hidden" name="portal" value="${safeText(slug)}" />` : `
              <div class="field">
                <label for="portal">Portal ID</label>
                <input id="portal" name="portal" placeholder="example-property-delivery" />
              </div>
            `}
            <div class="field">
              <label for="accessCode">Access code</label>
              <input id="accessCode" name="accessCode" type="password" placeholder="Enter the code you were sent" />
            </div>
            <button class="button button--accent" type="submit">Open delivery</button>
            ${statusMarkup}
          </form>
        </div>
        <div class="timeline">
          <div class="timeline__item">
            <div class="timeline__step">01</div>
            <div>
              <h3 class="timeline__title">Open the portal</h3>
              <p class="timeline__text">Use the delivery link, or enter the portal ID and access code that came with your photoshoot delivery.</p>
            </div>
          </div>
          <div class="timeline__item">
            <div class="timeline__step">02</div>
            <div>
              <h3 class="timeline__title">Review the media</h3>
              <p class="timeline__text">Preview the delivered files in a clean gallery that works on desktop and mobile.</p>
            </div>
          </div>
          <div class="timeline__item">
            <div class="timeline__step">03</div>
            <div>
              <h3 class="timeline__title">Download the originals</h3>
              <p class="timeline__text">Use the download buttons to save individual files or download the entire delivery set.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function clientAccessGalleryMarkup() {
  if (!activePortalData) {
    return clientAccessIntroMarkup(portalSlugFromLocation());
  }

  const items = sortedPortalMedia(activePortalMedia);
  const summary = portalSummary(items);

  return `
    <section class="section">
      <div class="section__eyebrow">Client delivery</div>
      <h1 class="section__title">${safeText(activePortalData.propertyTitle || "Your delivery portal")}</h1>
      <p class="section__lead">${safeText(activePortalData.message || "Your finished media is ready below. Preview the files and use the download buttons to save the original versions.")}</p>
      <div class="hero__actions">
        <button class="button button--accent" type="button" data-download-all>Download all originals</button>
        <a class="button" href="./contact.html">Need anything adjusted?</a>
      </div>
      <div class="hero__stats" style="margin-top: 24px;">
        <div class="stat">
          <span class="stat__label">Portal ID</span>
          <div class="stat__value">${safeText(activePortalData.slug || "")}</div>
        </div>
        <div class="stat">
          <span class="stat__label">Files</span>
          <div class="stat__value">${summary.total} total</div>
        </div>
        <div class="stat">
          <span class="stat__label">Included</span>
          <div class="stat__value">${summary.photos} photos${summary.videos ? `, ${summary.videos} videos` : ""}</div>
        </div>
      </div>
      ${activePortalData.propertyAddress ? `<p class="section__lead" style="margin-top: 18px;">Property: ${safeText(activePortalData.propertyAddress)}</p>` : ""}
      ${activePortalData.deliveredAt ? `<p class="helper" style="margin-top: 10px;">Delivered ${safeText(activePortalData.deliveredAt)}. If your browser asks for permission to download multiple files, choose allow.</p>` : `<p class="helper" style="margin-top: 10px;">If your browser asks for permission to download multiple files, choose allow.</p>`}
    </section>

    <section class="section">
      <div class="section__eyebrow">Delivered files</div>
      <div class="section-grid grid--cards">
        ${items
          .map((item) => {
            const isVideo = String(item.type || "").startsWith("video/");
            return `
              <article class="card">
                ${isVideo
                  ? `
                    <div class="card__media">
                      <video class="card__video" controls playsinline preload="metadata">
                        <source src="${mediaUrlFor(item)}" type="${safeText(item.type || "video/mp4")}" />
                      </video>
                    </div>
                  `
                  : `
                    <div class="card__media">
                      <button class="media-tile__button" data-preview data-id="${item.id}" type="button" aria-label="Preview ${safeText(item.title || item.name || "photo")}">
                        <img class="card__image" src="${mediaUrlFor(item)}" alt="${safeText(item.alt || item.title || item.name || "Client delivery media")}" loading="lazy" decoding="async" />
                      </button>
                    </div>
                  `}
                <div class="card__body">
                  <div class="card__eyebrow">${safeText(portalTypeLabel(item))}</div>
                  <h2 class="card__title">${safeText(item.title || item.name || "Delivered file")}</h2>
                  <p class="card__text">${safeText(item.caption || item.name || "Original file ready to download.")}</p>
                  <div class="section__actions">
                    <a class="button button--accent" href="${portalDownloadUrl(item)}" download="${safeText(item.name || item.title || item.id)}">Download original</a>
                  </div>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function clientAccessPageMarkup() {
  return clientAccessGalleryMarkup();
}

function showLightboxAt(index) {
  refreshPreviewItems();
  if (!lightboxItems.length) {
    return;
  }

  lightboxIndex = (index + lightboxItems.length) % lightboxItems.length;
  const recordId = lightboxItems[lightboxIndex]?.dataset.id;
  const record = findRecordById(recordId);
  if (!record) {
    return;
  }

  renderLightboxRecord(record);
  lightboxEl.hidden = false;
  lightboxEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function openLightbox(recordId) {
  refreshPreviewItems();
  const index = lightboxItems.findIndex((button) => button.dataset.id === recordId);
  if (index < 0) {
    return;
  }

  showLightboxAt(index);
}

function stepLightbox(delta) {
  if (!lightboxItems.length) {
    refreshPreviewItems();
  }

  if (!lightboxItems.length) {
    return;
  }

  if (lightboxIndex < 0) {
    lightboxIndex = 0;
  }

  showLightboxAt(lightboxIndex + delta);
}

function closeLightbox() {
  if (!lightboxEl) {
    return;
  }

  lightboxEl.hidden = true;
  lightboxEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  lightboxIndex = -1;
}

function wireHeroParallax() {
  heroEffectController?.abort();
  heroEffectController = new AbortController();

  const hero = document.getElementById("hero");
  if (!hero) {
    return;
  }

  const { signal } = heroEffectController;
  const mobileQuery = window.matchMedia("(max-width: 720px)");
  const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

  const setHeroPoint = (x, y) => {
    hero.style.setProperty("--hero-x", `${x}%`);
    hero.style.setProperty("--hero-y", `${y}%`);
  };

  const setScrollReveal = () => {
    const progress = clamp(window.scrollY / Math.max(hero.offsetHeight * 0.82, 1));
    hero.style.setProperty("--hero-scroll-progress", progress.toFixed(3));
  };

  const syncHeroMode = () => {
    if (mobileQuery.matches) {
      hero.classList.add("hero--scroll-reveal");
      setScrollReveal();
      return;
    }

    hero.classList.remove("hero--scroll-reveal");
    hero.style.removeProperty("--hero-scroll-progress");
    setHeroPoint(50, 50);
  };

  setHeroPoint(50, 50);
  syncHeroMode();

  hero.addEventListener(
    "pointermove",
    (event) => {
      if (mobileQuery.matches) {
        return;
      }

      const bounds = hero.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * 100;
      const y = ((event.clientY - bounds.top) / bounds.height) * 100;
      setHeroPoint(x, y);
    },
    { signal }
  );

  hero.addEventListener(
    "pointerleave",
    () => {
      if (!mobileQuery.matches) {
        setHeroPoint(50, 50);
      }
    },
    { signal }
  );

  window.addEventListener(
    "scroll",
    () => {
      if (mobileQuery.matches) {
        setScrollReveal();
      }
    },
    { signal, passive: true }
  );

  window.addEventListener(
    "resize",
    () => {
      syncHeroMode();
    },
    { signal }
  );
}

function wireLightbox() {
  if (!lightboxEl) {
    return;
  }

  lightboxEl.addEventListener("click", (event) => {
    if (event.target.closest("[data-lightbox-close]")) {
      closeLightbox();
      return;
    }

    if (event.target.closest("[data-lightbox-prev]")) {
      stepLightbox(-1);
      return;
    }

    if (event.target.closest("[data-lightbox-next]")) {
      stepLightbox(1);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lightboxEl.hidden) {
      closeLightbox();
      return;
    }

    if (lightboxEl.hidden) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepLightbox(-1);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      stepLightbox(1);
    }
  });
}

function wirePreviewButtons() {
  refreshPreviewItems();
  document.querySelectorAll("[data-preview]").forEach((button) => {
    button.addEventListener("click", () => openLightbox(button.dataset.id));
  });
}

function wireGalleryReel() {
  const rail = document.querySelector("[data-gallery-reel-rail]");
  const prevButton = document.querySelector("[data-gallery-reel-prev]");
  const nextButton = document.querySelector("[data-gallery-reel-next]");
  if (!rail || (!prevButton && !nextButton)) {
    return;
  }

  const getStep = () => {
    const item = rail.querySelector(".gallery-reel__item");
    if (!item) {
      return rail.clientWidth * 0.85;
    }

    const itemWidth = item.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(rail).gap || "0") || 0;
    return itemWidth + gap;
  };

  const maxScroll = () => Math.max(rail.scrollWidth - rail.clientWidth - 4, 0);

  const move = (direction) => {
    const limit = maxScroll();
    if (limit <= 0) {
      return;
    }

    const step = getStep();
    const current = rail.scrollLeft;

    if (direction < 0) {
      if (current <= 0) {
        rail.scrollTo({ left: limit, behavior: "smooth" });
        return;
      }

      rail.scrollTo({ left: Math.max(current - step, 0), behavior: "smooth" });
      return;
    }

    if (current >= limit) {
      rail.scrollTo({ left: 0, behavior: "smooth" });
      return;
    }

    rail.scrollTo({ left: Math.min(current + step, limit), behavior: "smooth" });
  };

  prevButton?.addEventListener("click", () => move(-1));
  nextButton?.addEventListener("click", () => move(1));
}

function wireTestimonialsCarousel() {
  const rail = document.querySelector("[data-testimonials-rail]");
  if (!rail || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const getStep = () => {
    const card = rail.querySelector(".testimonial-card");
    if (!card) {
      return rail.clientWidth * 0.85;
    }

    const cardWidth = card.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(rail).gap || "0") || 0;
    return cardWidth + gap;
  };

  let timer = null;
  const maxScrollLeft = () => Math.max(rail.scrollWidth - rail.clientWidth - 4, 0);

  const start = () => {
    if (timer) {
      return;
    }

    timer = window.setInterval(() => {
      const step = getStep();
      const maxScroll = maxScrollLeft();

      if (maxScroll <= 0) {
        return;
      }

      if (rail.scrollLeft >= maxScroll) {
        rail.scrollTo({ left: 0, behavior: "smooth" });
        return;
      }

      const next = Math.min(rail.scrollLeft + step, maxScroll);
      rail.scrollTo({ left: next, behavior: "smooth" });
    }, 3800);
  };

  const stop = () => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  rail.addEventListener("mouseenter", stop);
  rail.addEventListener("mouseleave", start);
  rail.addEventListener("focusin", stop);
  rail.addEventListener("focusout", start);
  start();
}

function wireSectionReveal() {
  const targets = Array.from(mainEl.querySelectorAll(".section, .hero__card, .card--interactive, .media-tile, .contact-box"));
  if (!targets.length) {
    return;
  }

  targets.forEach((element, index) => {
    element.classList.add("reveal-target");
    element.style.setProperty("--reveal-delay", `${Math.min(index * 70, 280)}ms`);
  });

  if (!("IntersectionObserver" in window)) {
    targets.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
  );

  targets.forEach((element) => observer.observe(element));
}

function wireContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) {
    return;
  }

  const status = form.querySelector(".helper");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = formData.get("name")?.toString().trim() || "";
    const email = formData.get("email")?.toString().trim() || "";
    const message = formData.get("message")?.toString().trim() || "";
    const endpoint = state.settings.contactNotificationEndpoint?.trim() || "";

    const submission = new FormData(form);
    submission.set("source", `${state.settings.brandName} website`);
    submission.set("page", window.location.href);
    submission.set("submittedAt", new Date().toISOString());

    if (endpoint) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
          body: submission,
        });

        if (!response.ok) {
          throw new Error("Notification endpoint returned an error.");
        }

        form.reset();
        if (status) {
          status.textContent = "Sent. Your inquiry was delivered and a notification can be sent from the configured endpoint.";
        }
        return;
      } catch (error) {
        console.error(error);
        if (status) {
          status.textContent = "The notification endpoint could not be reached, so the email draft is opening instead.";
        }
      }
    }

    const subject = encodeURIComponent(`Project inquiry from ${name || "website visitor"}`);
    const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\nProject details:\n${message}\n`);

    window.location.href = `mailto:${state.settings.email}?subject=${subject}&body=${body}`;
  });
}

async function loadMedia() {
  mediaCache = await listMedia();
  objectUrls = mediaCache
    .filter((item) => item.blob)
    .map((item) => ({ id: item.id, url: URL.createObjectURL(item.blob) }));
  return mediaCache;
}

function clearClientPortalState() {
  activePortalData = null;
  activePortalMedia = [];
}

function rememberPortalCode(slug, accessCode) {
  try {
    sessionStorage.setItem(portalSessionKey(slug), accessCode);
  } catch {
    // ignore
  }
}

function getRememberedPortalCode(slug) {
  try {
    return sessionStorage.getItem(portalSessionKey(slug)) || "";
  } catch {
    return "";
  }
}

function removeCodeFromUrl(slug) {
  const next = slug ? `./client-access.html?portal=${encodeURIComponent(slug)}` : "./client-access.html";
  window.history.replaceState({}, "", next);
}

async function unlockPortal(slug, accessCode, options = {}) {
  const code = String(accessCode || "").trim();
  const token = String(options.token || "").trim();
  const shouldRemember = options.remember !== false;

  if (!code && !token) {
    clientPortalError = "Enter the access code that came with your delivery link.";
    clearClientPortalState();
    renderPage();
    return;
  }

  try {
    const cloudPortal = await unlockCloudPortal({
      slug,
      accessCode: code,
      token,
    });
    activePortalData = cloudPortal;
    activePortalMedia = sortedPortalMedia(cloudPortal.files || []);
    clientPortalError = "";
    if (code && shouldRemember) {
      rememberPortalCode(slug, code);
    }
    renderPage();
    if (options.removeCodeFromUrl) {
      removeCodeFromUrl(slug);
    }
    return;
  } catch (cloudError) {
    const portal = findPortalRecord(slug);
    if (!portal || portal.isActive === false) {
      clientPortalError = cloudError.message || "That delivery portal is not available. Double-check the portal ID or contact me for a fresh link.";
      clearClientPortalState();
      renderPage();
      return;
    }

    try {
      const payload = portal.accessCode && portal.accessCode === code
        ? buildLocalPortalPayload(portal)
        : await decryptPortalPayload(portal, code);

      activePortalData = {
        ...portal,
        ...payload,
        slug: portal.slug,
      };
      activePortalMedia = sortedPortalMedia(payload.media || []);
      clientPortalError = "";
      if (code && shouldRemember) {
        rememberPortalCode(slug, code);
      }
      renderPage();
      if (options.removeCodeFromUrl) {
        removeCodeFromUrl(slug);
      }
    } catch (localError) {
      console.error(cloudError);
      console.error(localError);
      clientPortalError = "That access code did not match this portal. Try again or reach out for a fresh delivery link.";
      clearClientPortalState();
      renderPage();
    }
  }
}

function wireClientAccessPage() {
  const form = document.getElementById("client-portal-access-form");
  const downloadAllButton = document.querySelector("[data-download-all]");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const slug = formData.get("portal")?.toString().trim() || "";
    const accessCode = formData.get("accessCode")?.toString().trim() || "";

    const targetUrl = `./client-access.html?portal=${encodeURIComponent(slug)}`;
    if (!portalSlugFromLocation() && slug) {
      window.history.replaceState({}, "", targetUrl);
    }

    await unlockPortal(slug, accessCode);
  });

  downloadAllButton?.addEventListener("click", async () => {
    const items = sortedPortalMedia(activePortalMedia);
    for (const [index, item] of items.entries()) {
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = portalDownloadUrl(item);
        link.download = item.name || item.title || item.id;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, index * 220);
    }
  });

  const slug = portalSlugFromLocation();
  if (!slug || activePortalData) {
    return;
  }

  const queryToken = portalTokenFromLocation();
  const queryCode = portalCodeFromLocation();
  const rememberedCode = getRememberedPortalCode(slug);
  if (queryToken) {
    unlockPortal(slug, "", { token: queryToken, removeCodeFromUrl: true });
    return;
  }

  if (queryCode) {
    unlockPortal(slug, queryCode, { removeCodeFromUrl: true });
    return;
  }

  loadUnlockedCloudPortal(slug)
    .then((portal) => {
      activePortalData = portal;
      activePortalMedia = sortedPortalMedia(portal.files || []);
      clientPortalError = "";
      renderPage();
    })
    .catch(() => {
      if (rememberedCode) {
        unlockPortal(slug, rememberedCode, { remember: false });
      }
    });
}

function renderPage() {
  renderHeader();
  renderFooter();
  wireHeaderMenu();

  if (page === "home") {
    clearClientPortalState();
    mainEl.innerHTML = homePageMarkup();
    wireSectionReveal();
    wireHeroParallax();
    wireTestimonialsCarousel();
    wireGalleryReel();
    wirePreviewButtons();
    wireLightbox();
    return;
  }

  if (page === "services") {
    clearClientPortalState();
    mainEl.innerHTML = servicesPageMarkup();
    wireSectionReveal();
    wireTestimonialsCarousel();
    wirePreviewButtons();
    wireLightbox();
    return;
  }

  if (page === "contact") {
    clearClientPortalState();
    mainEl.innerHTML = contactMarkup();
    wireSectionReveal();
    wireContactForm();
    wirePreviewButtons();
    wireLightbox();
    return;
  }

  if (page === "client-access") {
    mainEl.innerHTML = clientAccessPageMarkup();
    wireSectionReveal();
    wireClientAccessPage();
    if (activePortalData) {
      wirePreviewButtons();
      wireLightbox();
    }
  }
}

async function bootstrap() {
  const published = await loadPublishedSiteData();
  const localMedia = await loadMedia();
  const localState = loadState();
  const hasLocalDraft = hasSavedState() || localMedia.length > 0;

  if (hasLocalDraft) {
    const baseState = mergePublishedState(published || DEFAULT_STATE);
    state = {
      ...baseState,
      ...localState,
      settings: {
        ...baseState.settings,
        ...(localState.settings || {}),
      },
      services: Array.isArray(localState.services) ? localState.services : baseState.services,
      clientPortals: mergeClientPortals(localState.clientPortals || [], published?.clientPortals || []),
    };

    mediaCache = mergeMediaRecords(localMedia, Array.isArray(published?.media) ? published.media : []);
  } else if (published) {
    state = mergePublishedState(published);
    mediaCache = Array.isArray(published.media) ? published.media : [];
  } else {
    state = localState;
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
