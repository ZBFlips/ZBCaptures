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
const SEO_SERVICE_AREAS = [
  "Pensacola, FL",
  "Gulf Breeze, FL",
  "Pace, FL",
  "Milton, FL",
  "Navarre, FL",
  "Perdido Key, FL",
  "Ferry Pass, FL",
  "Bellview, FL",
  "Brent, FL",
  "Ensley, FL",
  "West Pensacola, FL",
  "Crestview, FL",
  "Niceville, FL",
  "Destin, FL",
  "Fort Walton Beach, FL",
  "Miramar Beach, FL",
  "Freeport, FL",
  "Panama City Beach, FL",
  "Orange Beach, AL",
  "Foley, AL",
  "Fairhope, AL",
  "Daphne, AL",
  "Mobile, AL",
  "Enterprise, FL",
];
const SEO_PLATFORMS = ["MLS", "Zillow", "Homes.com", "Redfin", "Airbnb", "VRBO"];
const SEO_DELIVERABLES = ["MLS-ready photos", "Zillow-ready images", "HDR photography", "drone photos", "social video"];
const BUSINESS_HOURS = {
  opens: "08:00",
  closes: "18:00",
  days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  label: "Open daily from 8:00 AM to 6:00 PM",
};
const GOOGLE_BUSINESS_PROFILE_URL = "https://share.google/aDc3usKYdvNCryRrN";
const PENSACOLA_CENTER = { lat: 30.4213, lon: -87.2169, label: "Pensacola, FL" };
const SERVICE_RADIUS_MILES = 120;
const SERVICE_RADIUS_METERS = SERVICE_RADIUS_MILES * 1609.344;
const LEAFLET_CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

let state = loadState();
let mediaCache = [];
let objectUrls = [];
let activePortalData = null;
let activePortalMedia = [];
let clientPortalError = "";
let lightboxItems = [];
let lightboxIndex = -1;
let leafletAssetsPromise = null;
let serviceAreaMap = null;
let serviceAreaCircle = null;
let serviceAreaMarker = null;
let serviceAreaSearchCache = new Map();
let nominatimLastRequestAt = 0;

if (mainEl) {
  mainEl.innerHTML = loadingShellMarkup(page);
}

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
  const tagText = String(state.settings.brandTag || "").trim();
  const logoMarkup = logo
    ? `<img class="brand__logo" src="${mediaUrlFor(logo)}" alt="${safeText(logo.alt || logo.title || state.settings.brandName)}" />`
    : `<span class="brand__name">${safeText(state.settings.brandName)}</span>`;
  const tagMarkup = !logo && tagText ? `<span class="brand__tag">${safeText(tagText)}</span>` : "";

  headerEl.innerHTML = `
    <div class="site-header">
      <div class="site-header__inner">
        <a class="brand ${logo ? "brand--logo-only" : ""}" href="./index.html" aria-label="Go to home page">
          ${logoMarkup}
          ${tagMarkup}
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
  const marketsMarkup = SEO_SERVICE_AREAS.map((market) => `<span class="footer__chip">${safeText(market)}</span>`).join("");
  const platformsMarkup = SEO_PLATFORMS.map((platform) => `<span class="footer__chip footer__chip--platform">${safeText(platform)}</span>`).join("");
  const linksMarkup = navItems()
    .map((item) => `<a href="${item.href}">${safeText(item.label)}</a>`)
    .join("");

  footerEl.innerHTML = `
    <div class="footer">
      <div class="footer__inner">
        <div class="footer__brand">
          <strong>${safeText(state.settings.brandName)}</strong>
          <p class="footer__headline">Pensacola real estate photography for ${safeText(SEO_PLATFORMS.join(", "))}-ready listings.</p>
          <p class="footer__copy">${safeText(state.settings.footerNote)}</p>
          <p class="footer__copy">${safeText(SEO_DELIVERABLES.join(", "))}, with same-day availability when possible for Gulf Coast agents who need media that works fast across industry-standard platforms.</p>
          <p class="footer__copy">${safeText(BUSINESS_HOURS.label)}</p>
          <a class="footer__contact" href="mailto:${safeText(state.settings.email)}">Primary contact: ${safeText(state.settings.email)}</a>
        </div>
        <div class="footer__stack">
          <div class="footer__heading">Service area</div>
          <p class="footer__copy">${safeText(state.settings.serviceArea)}</p>
          <div class="footer__chips">${marketsMarkup}</div>
        </div>
        <div class="footer__stack">
          <div class="footer__heading">Platform compatibility</div>
          <p class="footer__copy">Built for agents, brokers, and hosts who need media that fits the expectations of MLS listings, Zillow, Homes.com, Redfin, Airbnb, and VRBO.</p>
          <div class="footer__chips">${platformsMarkup}</div>
          <div class="footer__links">
            ${linksMarkup}
          </div>
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
        <h2 class="section__title">What to expect after the shoot.</h2>
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
          ${serviceSignalsMarkup()}
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

const trustPillars = [
  {
    eyebrow: "Speed agents care about",
    title: "Same-day availability when possible.",
    text: "When a property is ready to launch, the workflow is built to move quickly so you can keep the listing schedule on track.",
  },
  {
    eyebrow: "Industry-ready deliverables",
    title: "Built for MLS, Zillow, Homes.com, and Redfin.",
    text: "The media packages are shaped around the formats and expectations agents already work with every day.",
  },
  {
    eyebrow: "Easy handoff",
    title: "A client portal that feels polished and simple.",
    text: "Finished shoots can be delivered through a clean download portal so agents are not chasing files across email threads.",
  },
];

const faqItems = [
  {
    question: "How fast is delivery?",
    answer: "Same-day availability is offered when the schedule allows, and most standard photo deliveries are turned around within 24 hours.",
  },
  {
    question: "Are the photos MLS-ready?",
    answer: "Yes. The workflow is built around MLS-ready photos and listing-platform compatibility, including Zillow-ready images and clean delivery for agent marketing use.",
  },
  {
    question: "What areas do you serve?",
    answer: "ZB Captures is based in Pensacola, Florida and generally serves addresses within roughly 120 miles of Pensacola, including Gulf Breeze, Pace, Milton, Navarre, Perdido Key, Foley, Orange Beach, Fairhope, and surrounding Gulf Coast markets.",
  },
  {
    question: "Do you offer drone photos and video?",
    answer: "Yes. Depending on the package, coverage can include HDR photography, drone photos, social video, and larger listing marketing deliverables.",
  },
  {
    question: "How do clients receive the finished files?",
    answer: "Each finished shoot can be delivered through a private client portal where the gallery can be reviewed and the original files can be downloaded without confusion.",
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
                <input id="name" name="name" autocomplete="name" placeholder="Your name" required />
              </div>
              <div class="field">
                <label for="email">Email</label>
                <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
              </div>
              <div class="field">
                <label for="message">Project details</label>
                <textarea id="message" name="message" placeholder="Property address, desired turnaround, number of photos, video needs, anything else." required></textarea>
              </div>
              <div class="field field--honeypot" aria-hidden="true">
                <label for="company">Company</label>
                <input id="company" name="company" tabindex="-1" autocomplete="off" />
              </div>
              <button class="button button--accent" type="submit" data-contact-submit>Send inquiry</button>
              <div class="helper" data-contact-status>The built-in contact form sends directly from this site. If that service is unavailable, your email app will open as a fallback.</div>
            </form>
          </div>
        </div>
      </div>
    </section>
  `;
}

function trustSectionMarkup() {
  return `
    <section class="section trust-section">
      <div class="section__eyebrow">Why Agents Trust ZB Captures</div>
      <div class="trust-layout">
        <div class="trust-layout__copy">
          <h2 class="section__title">Built around the pace and standards of real estate marketing.</h2>
          <p class="section__lead">This is not generic photography packaging. The workflow is tuned for agents who care about speed, listing-platform compatibility, consistent visual quality, and a handoff process that feels easy for clients.</p>
          <div class="section__actions">
            <a class="button button--accent" href="./contact.html">Book a session</a>
            <a class="button" href="${safeText(GOOGLE_BUSINESS_PROFILE_URL)}" target="_blank" rel="noreferrer">View Google Business Profile</a>
          </div>
        </div>
        <div class="trust-grid">
          ${trustPillars
            .map(
              (pillar, index) => `
                <article class="trust-card ${index === 1 ? "trust-card--accent" : ""}">
                  <div class="trust-card__eyebrow">${safeText(pillar.eyebrow)}</div>
                  <h3 class="trust-card__title">${safeText(pillar.title)}</h3>
                  <p class="trust-card__text">${safeText(pillar.text)}</p>
                </article>
              `
            )
            .join("")}
          <article class="trust-card trust-card--meta">
            <div class="trust-meta">
              <span class="trust-meta__label">Based in</span>
              <strong class="trust-meta__value">Pensacola, Florida</strong>
            </div>
            <div class="trust-meta">
              <span class="trust-meta__label">Hours</span>
              <strong class="trust-meta__value">${safeText(BUSINESS_HOURS.label)}</strong>
            </div>
            <div class="trust-meta">
              <span class="trust-meta__label">Coverage</span>
              <strong class="trust-meta__value">Gulf Coast service area within roughly 120 miles</strong>
            </div>
          </article>
        </div>
      </div>
    </section>
  `;
}

function faqMarkup() {
  return `
    <section class="section faq-section">
      <div class="section__eyebrow">FAQ &amp; SERVICE AREA</div>
      <div class="faq-layout">
        <div class="faq-layout__content">
          <div class="faq-layout__copy">
            <h2 class="section__title">Questions agents usually ask before booking.</h2>
            <p class="section__lead">The goal is to make the process feel straightforward from the first click. These are the details most agents want clarified before they lock in a shoot.</p>
          </div>
          <div class="faq-list">
            ${faqItems
              .map(
                (item) => `
                  <details class="faq-item">
                    <summary class="faq-item__question">${safeText(item.question)}</summary>
                    <p class="faq-item__answer">${safeText(item.answer)}</p>
                  </details>
                `
              )
              .join("")}
          </div>
        </div>
        <aside class="service-area-tool">
          <div class="service-area-tool__copy">
            <h3 class="service-area-tool__title">Check whether a property falls inside the 120-mile radius.</h3>
            <p class="service-area-tool__text">Enter an address and the map will show whether it sits inside the service radius centered on Pensacola, Florida.</p>
          </div>
          <form class="service-area-form" id="service-area-form">
            <input class="service-area-form__input" name="address" placeholder="Enter a property address" autocomplete="street-address" />
            <button class="button button--accent" type="submit">Check address</button>
          </form>
          <div class="helper" id="service-area-status">Search an address to see whether it falls inside the ${SERVICE_RADIUS_MILES}-mile service radius.</div>
          <div class="service-area-map" id="service-area-map" aria-label="Interactive service area map"></div>
          <div class="service-area-tool__legend">
            <span class="service-area-tool__legendItem"><span class="service-area-tool__dot service-area-tool__dot--center"></span>Pensacola center point</span>
            <span class="service-area-tool__legendItem"><span class="service-area-tool__dot service-area-tool__dot--radius"></span>${SERVICE_RADIUS_MILES}-mile service radius</span>
          </div>
        </aside>
      </div>
    </section>
  `;
}

function haversineMiles(start, end) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.7613;
  const latDiff = toRadians(end.lat - start.lat);
  const lonDiff = toRadians(end.lon - start.lon);
  const lat1 = toRadians(start.lat);
  const lat2 = toRadians(end.lat);

  const a =
    Math.sin(latDiff / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDiff / 2) ** 2;

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(a));
}

function updateServiceAreaStatus(message, tone = "neutral") {
  const status = document.getElementById("service-area-status");
  if (!status) {
    return;
  }

  status.textContent = message;
  status.classList.remove("helper--warn", "helper--success");
  if (tone === "warn") {
    status.classList.add("helper--warn");
  }
  if (tone === "success") {
    status.classList.add("helper--success");
  }
}

async function ensureLeafletAssets() {
  if (window.L) {
    return window.L;
  }

  if (leafletAssetsPromise) {
    return leafletAssetsPromise;
  }

  leafletAssetsPromise = new Promise((resolve, reject) => {
    if (!document.head.querySelector(`link[href="${LEAFLET_CSS_URL}"]`)) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS_URL;
      document.head.appendChild(css);
    }

    const existingScript = document.head.querySelector(`script[src="${LEAFLET_JS_URL}"]`);
    if (existingScript && window.L) {
      resolve(window.L);
      return;
    }

    const script = existingScript || document.createElement("script");
    script.src = LEAFLET_JS_URL;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("The service-area map could not load right now."));
    if (!existingScript) {
      document.head.appendChild(script);
    }
  });

  return leafletAssetsPromise;
}

async function lookupAddress(address) {
  const query = String(address || "").trim();
  if (!query) {
    throw new Error("Enter an address to check the service radius.");
  }

  const cacheKey = query.toLowerCase();
  if (serviceAreaSearchCache.has(cacheKey)) {
    return serviceAreaSearchCache.get(cacheKey);
  }

  const elapsed = Date.now() - nominatimLastRequestAt;
  if (elapsed < 1100) {
    await new Promise((resolve) => window.setTimeout(resolve, 1100 - elapsed));
  }

  nominatimLastRequestAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", query);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("The address lookup service is unavailable right now.");
  }

  const results = await response.json();
  if (!Array.isArray(results) || !results.length) {
    throw new Error("That address could not be located. Try a fuller property address.");
  }

  const match = {
    lat: Number(results[0].lat),
    lon: Number(results[0].lon),
    label: results[0].display_name || query,
  };
  serviceAreaSearchCache.set(cacheKey, match);
  return match;
}

async function wireServiceAreaMap() {
  const mapEl = document.getElementById("service-area-map");
  const form = document.getElementById("service-area-form");
  if (!mapEl || !form) {
    return;
  }

  try {
    const L = await ensureLeafletAssets();
    if (!mapEl || serviceAreaMap) {
      return;
    }

    serviceAreaMap = L.map(mapEl, {
      scrollWheelZoom: false,
    }).setView([PENSACOLA_CENTER.lat, PENSACOLA_CENTER.lon], 8);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(serviceAreaMap);

    L.marker([PENSACOLA_CENTER.lat, PENSACOLA_CENTER.lon])
      .addTo(serviceAreaMap)
      .bindPopup("Pensacola, FL");

    serviceAreaCircle = L.circle([PENSACOLA_CENTER.lat, PENSACOLA_CENTER.lon], {
      radius: SERVICE_RADIUS_METERS,
      color: "#f0b87f",
      weight: 2,
      fillColor: "#6d86b3",
      fillOpacity: 0.18,
    }).addTo(serviceAreaMap);

    serviceAreaMap.fitBounds(serviceAreaCircle.getBounds(), {
      padding: [18, 18],
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const address = formData.get("address")?.toString().trim() || "";
      if (!address) {
        updateServiceAreaStatus("Enter an address to check the service radius.", "warn");
        return;
      }

      updateServiceAreaStatus("Checking that address against the Pensacola service radius...");

      try {
        const match = await lookupAddress(address);
        const distance = haversineMiles(PENSACOLA_CENTER, match);
        const inside = distance <= SERVICE_RADIUS_MILES;

        serviceAreaMarker?.remove();
        serviceAreaMarker = L.marker([match.lat, match.lon]).addTo(serviceAreaMap);
        serviceAreaMarker.bindPopup(match.label).openPopup();

        serviceAreaMap.fitBounds(
          L.latLngBounds(
            [
              [PENSACOLA_CENTER.lat, PENSACOLA_CENTER.lon],
              [match.lat, match.lon],
            ]
          ),
          { padding: [34, 34] }
        );

        updateServiceAreaStatus(
          inside
            ? `${match.label} is inside the ${SERVICE_RADIUS_MILES}-mile service radius at about ${distance.toFixed(1)} miles from Pensacola.`
            : `${match.label} is outside the ${SERVICE_RADIUS_MILES}-mile service radius at about ${distance.toFixed(1)} miles from Pensacola.`,
          inside ? "success" : "warn"
        );
      } catch (error) {
        updateServiceAreaStatus(error.message || "Unable to check that address right now.", "warn");
      }
    });
  } catch (error) {
    console.error(error);
    updateServiceAreaStatus("The interactive map could not load right now, but the service radius is still centered on Pensacola with a 120-mile range.", "warn");
  }
}

function servicesPageMarkup() {
  return `
    <section class="section services-page__intro">
      <div class="section__eyebrow">Services</div>
      <h1 class="section__title">Elevate Your Listing, Engage Your Buyers.</h1>
      <p class="section__lead">${safeText(state.settings.servicesLead)}</p>
      ${serviceSignalsMarkup()}
      <div class="section__actions">
        <a class="button button--accent" href="./contact.html">Book a session</a>
        <a class="button" href="./client-access.html">See the delivery experience</a>
      </div>
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
                  <div class="card__footer">
                    <span class="card__footerLabel">Best fit</span>
                    <div class="card__footerText">${safeText(serviceSummary(service, index))}</div>
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

    ${faqMarkup()}
  `;
}

function homePageMarkup() {
  return [heroMarkup(), galleryMarkup(), servicesMarkup(), testimonialsMarkup(), trustSectionMarkup(), clientDeliveryTeaserMarkup(), faqMarkup(), contactMarkup()].join("");
}

function serviceSignalsMarkup() {
  const signals = [
    { label: "Turnaround", value: "24-hour delivery windows" },
    { label: "Coverage", value: "Photo, video, and drone-ready" },
    { label: "Delivery", value: "Simple client portal handoff" },
  ];

  return `
    <div class="signal-grid" aria-label="Service highlights">
      ${signals
        .map(
          (signal) => `
            <div class="signal-card">
              <span class="signal-card__label">${safeText(signal.label)}</span>
              <strong class="signal-card__value">${safeText(signal.value)}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function serviceSummary(service, index) {
  const bullets = Array.isArray(service?.bullets) ? service.bullets.filter(Boolean) : [];
  if (bullets.length >= 2) {
    return `${bullets[0]} + ${bullets[1]}`;
  }

  if (bullets.length === 1) {
    return bullets[0];
  }

  if (service?.featured) {
    return "Full-property launches that need the most complete presentation.";
  }

  return index === 0
    ? "Fast, polished coverage for standard listing launches."
    : "Elevated media that helps the property feel more premium online.";
}

function loadingShellMarkup(currentPage) {
  const generic = `
    <section class="section section--loading" aria-hidden="true">
      <div class="skeleton skeleton--eyebrow"></div>
      <div class="skeleton skeleton--title skeleton--wide"></div>
      <div class="skeleton skeleton--line skeleton--wide"></div>
      <div class="skeleton skeleton--line skeleton--medium"></div>
      <div class="skeleton-grid">
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
      </div>
    </section>
  `;

  if (currentPage === "home") {
    return `
      <section class="section hero section--loading" aria-hidden="true">
        <div class="hero__inner">
          <div class="skeleton skeleton--eyebrow"></div>
          <div class="skeleton skeleton--hero-title skeleton--wide"></div>
          <div class="skeleton skeleton--hero-title skeleton--medium"></div>
          <div class="skeleton skeleton--line skeleton--wide"></div>
          <div class="skeleton skeleton--line skeleton--medium"></div>
          <div class="skeleton-actions">
            <div class="skeleton skeleton--button"></div>
            <div class="skeleton skeleton--button skeleton--button-alt"></div>
          </div>
        </div>
      </section>
      ${generic}
    `;
  }

  return generic;
}

function absolutePageUrl(relativePath = ".") {
  return new URL(relativePath, window.location.href).toString();
}

function seoImageUrl() {
  return absolutePageUrl("./assets/brand/social-share.png");
}

function pageSeoConfig() {
  switch (page) {
    case "services":
      return {
        title: "Real Estate Photography Services in Pensacola, FL | ZB Captures",
        description:
          "Real estate photography services in Pensacola, Florida with MLS-ready photos, Zillow-ready images, HDR photography, drone photos, and social video for Zillow, Homes.com, Redfin, Airbnb, and VRBO listings.",
        path: "./services.html",
      };
    case "contact":
      return {
        title: "Contact ZB Captures | Pensacola Real Estate Photographer",
        description:
          "Contact ZB Captures for Pensacola real estate photography, MLS-ready photos, drone photos, and listing media with same-day availability when possible across the Gulf Coast.",
        path: "./contact.html",
      };
    case "client-access":
      return {
        title: "Client Delivery Portal | ZB Captures",
        description: "Client delivery portal for reviewing and downloading real estate photography and video files.",
        path: "./client-access.html",
      };
    case "admin":
      return {
        title: "Admin Dashboard | ZB Captures",
        description: "Admin dashboard for managing ZB Captures content, media uploads, and client delivery portals.",
        path: "./admin.html",
      };
    default:
      return {
        title: "ZB Captures | Real Estate Photography",
        description:
          "ZB Captures provides Pensacola real estate photography with MLS-ready photos, Zillow-ready images, HDR photography, drone photos, and social video for Zillow, Homes.com, Redfin, Airbnb, and VRBO listings across the Gulf Coast.",
        path: "./index.html",
      };
  }
}

function upsertMetaTag(key, value, mode = "name") {
  let tag = document.head.querySelector(`meta[${mode}="${key}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(mode, key);
    document.head.appendChild(tag);
  }

  tag.setAttribute("content", value);
}

function upsertLinkTag(rel, href) {
  let tag = document.head.querySelector(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement("link");
    tag.setAttribute("rel", rel);
    document.head.appendChild(tag);
  }

  tag.setAttribute("href", href);
}

function applyStructuredData(seo) {
  document.querySelectorAll('script[data-seo-structured="true"]').forEach((node) => node.remove());

  if (page === "admin" || page === "client-access") {
    return;
  }

  const canonicalUrl = absolutePageUrl(seo.path);
  const businessId = `${window.location.origin}/#business`;
  const business = {
    "@type": ["LocalBusiness", "ProfessionalService"],
    "@id": businessId,
    name: state.settings.brandName,
    url: window.location.origin,
    image: seoImageUrl(),
    description: seo.description,
    areaServed: SEO_SERVICE_AREAS,
    email: state.settings.email,
    telephone: state.settings.phone,
    priceRange: "$$",
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: BUSINESS_HOURS.days,
        opens: BUSINESS_HOURS.opens,
        closes: BUSINESS_HOURS.closes,
      },
    ],
    address: {
      "@type": "PostalAddress",
      addressLocality: "Pensacola",
      addressRegion: "FL",
      addressCountry: "US",
    },
    sameAs: ["https://www.instagram.com/zb.re.media/", GOOGLE_BUSINESS_PROFILE_URL],
    knowsAbout: [...SEO_DELIVERABLES, ...SEO_PLATFORMS],
  };

  const graph = [
    {
      "@type": "WebSite",
      "@id": `${window.location.origin}/#website`,
      name: state.settings.brandName,
      url: window.location.origin,
    },
    business,
  ];

  if (page === "services") {
    graph.push({
      "@type": "Service",
      serviceType: "Real estate photography",
      name: "Real estate photography, drone photography, and social video",
      provider: { "@id": businessId },
      areaServed: SEO_SERVICE_AREAS,
      url: canonicalUrl,
      description: seo.description,
    });
  }

  if (page === "home" || page === "services") {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    });
  }

  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.dataset.seoStructured = "true";
  script.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": graph,
  });
  document.head.appendChild(script);
}

function applySeoMetadata() {
  const seo = pageSeoConfig();
  const canonicalUrl = absolutePageUrl(seo.path);
  const imageUrl = seoImageUrl();

  document.title = seo.title;
  upsertMetaTag("description", seo.description);
  upsertLinkTag("canonical", canonicalUrl);

  upsertMetaTag("og:title", seo.title, "property");
  upsertMetaTag("og:description", seo.description, "property");
  upsertMetaTag("og:type", page === "home" ? "website" : "article", "property");
  upsertMetaTag("og:url", canonicalUrl, "property");
  upsertMetaTag("og:image", imageUrl, "property");
  upsertMetaTag("og:site_name", state.settings.brandName, "property");

  upsertMetaTag("twitter:card", "summary_large_image");
  upsertMetaTag("twitter:title", seo.title);
  upsertMetaTag("twitter:description", seo.description);
  upsertMetaTag("twitter:image", imageUrl);

  applyStructuredData(seo);
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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function sanitizeZipName(value, fallback = "file") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || fallback;
}

function makeZipFileName(baseName, items) {
  const names = new Set();

  return items.map((item, index) => {
    const originalName = sanitizeZipName(item.name || item.title || `file-${index + 1}`);
    const dotIndex = originalName.lastIndexOf(".");
    const stem = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName;
    const extension = dotIndex > 0 ? originalName.slice(dotIndex) : "";
    let candidate = originalName;
    let suffix = 2;

    while (names.has(candidate.toLowerCase())) {
      candidate = `${stem}-${suffix}${extension}`;
      suffix += 1;
    }

    names.add(candidate.toLowerCase());
    return {
      ...item,
      zipName: `${baseName}/${candidate}`,
    };
  });
}

function createStoredZip(entries) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const date = entry.date instanceof Date && !Number.isNaN(entry.date.getTime()) ? entry.date : new Date();
    const dosTime =
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      Math.floor((date.getSeconds() || 0) / 2);
    const dosDate =
      (((date.getFullYear() - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      (date.getDate() & 0x1f);

    const localHeader = new ArrayBuffer(30);
    const localView = new DataView(localHeader);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);

    chunks.push(new Uint8Array(localHeader), nameBytes, data);

    const centralHeader = new ArrayBuffer(46);
    const centralView = new DataView(centralHeader);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);

    centralDirectory.push(new Uint8Array(centralHeader), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = centralDirectory.reduce((total, chunk) => total + chunk.length, 0);
  const endHeader = new ArrayBuffer(22);
  const endView = new DataView(endHeader);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...chunks, ...centralDirectory, new Uint8Array(endHeader)], { type: "application/zip" });
}

function portalZipBaseName() {
  const slug = sanitizeZipName(activePortalData?.slug || "client-delivery")
    .toLowerCase()
    .replace(/\s+/g, "-");
  return slug || "client-delivery";
}

async function downloadPortalAsZip(items, button) {
  const zipItems = makeZipFileName(portalZipBaseName(), items);
  const entries = [];
  const originalLabel = button?.textContent || "Download full gallery (.zip)";

  if (button) {
    button.disabled = true;
  }

  try {
    for (const [index, item] of zipItems.entries()) {
      if (button) {
        button.textContent = `Preparing ZIP ${index + 1} / ${zipItems.length}`;
      }

      const response = await fetch(portalDownloadUrl(item), {
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Could not download ${item.name || item.title || "a file"} for the ZIP bundle.`);
      }

      const data = new Uint8Array(await response.arrayBuffer());
      entries.push({
        name: item.zipName,
        data,
        date: item.createdAt ? new Date(item.createdAt) : new Date(),
      });
    }

    const zipBlob = createStoredZip(entries);
    const link = document.createElement("a");
    const url = URL.createObjectURL(zipBlob);
    link.href = url;
    link.download = `${portalZipBaseName()}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
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
  const statusText = clientPortalError || "Enter the details you were sent and the gallery will open right away.";
  const statusClass = clientPortalError ? "helper helper--warn" : "helper";

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
            <button class="button button--accent" type="submit" data-client-access-submit>Open delivery</button>
            <div class="${statusClass}" data-client-access-status>${safeText(statusText)}</div>
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
              <p class="timeline__text">Download the full gallery as one ZIP, or tap any file tile to save that original by itself.</p>
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
      <p class="section__lead">${safeText(activePortalData.message || "Your finished media is ready below. Download the full gallery as a ZIP, or tap any file tile to save that original by itself.")}</p>
      <div class="hero__actions">
        <button class="button button--accent" type="button" data-download-all>Download full gallery (.zip)</button>
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
      ${activePortalData.deliveredAt ? `<p class="helper" style="margin-top: 10px;">Delivered ${safeText(activePortalData.deliveredAt)}. The ZIP includes the original delivered files.</p>` : `<p class="helper" style="margin-top: 10px;">The ZIP includes the original delivered files.</p>`}
    </section>

    <section class="section">
      <div class="section__eyebrow">Delivered files</div>
      <div class="section-grid grid--cards client-delivery-grid">
        ${items
          .map((item) => {
            const isVideo = String(item.type || "").startsWith("video/");
            return `
              <article class="card">
                ${isVideo
                  ? `
                    <div class="card__media">
                      <a class="client-delivery-card__download" href="${portalDownloadUrl(item)}" download="${safeText(item.name || item.title || item.id)}">Download</a>
                      <video class="card__video" controls playsinline preload="metadata">
                        <source src="${mediaUrlFor(item)}" type="${safeText(item.type || "video/mp4")}" />
                      </video>
                    </div>
                  `
                  : `
                    <div class="card__media">
                      <a class="client-delivery-card__download" href="${portalDownloadUrl(item)}" download="${safeText(item.name || item.title || item.id)}">Download</a>
                      <button class="media-tile__button" data-preview data-id="${item.id}" type="button" aria-label="Preview ${safeText(item.title || item.name || "photo")}">
                        <img class="card__image" src="${mediaUrlFor(item)}" alt="${safeText(item.alt || item.title || item.name || "Client delivery media")}" loading="lazy" decoding="async" />
                      </button>
                    </div>
                  `}
                <div class="card__body">
                  <div class="card__eyebrow">${safeText(portalTypeLabel(item))}</div>
                  <h2 class="card__title">${safeText(item.title || item.name || "Delivered file")}</h2>
                  <p class="card__text">${safeText(item.caption || item.name || "Tap the media tile or the download badge to save this original file.")}</p>
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

  const status = form.querySelector("[data-contact-status]");
  const submitButton = form.querySelector("[data-contact-submit]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = formData.get("name")?.toString().trim() || "";
    const email = formData.get("email")?.toString().trim() || "";
    const message = formData.get("message")?.toString().trim() || "";
    const company = formData.get("company")?.toString().trim() || "";
    const endpoint = state.settings.contactNotificationEndpoint?.trim() || defaultContactEndpoint();
    const originalLabel = submitButton?.textContent || "Send inquiry";

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending...";
    }

    if (status) {
      status.textContent = "Sending your inquiry...";
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          message,
          company,
          source: `${state.settings.brandName} website`,
          page: window.location.href,
          submittedAt: new Date().toISOString(),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "The contact form service returned an error.");
      }

      form.reset();
      if (status) {
        status.textContent = payload?.message || "Thanks. Your inquiry was sent successfully.";
      }
      return;
    } catch (error) {
      console.error(error);
      if (status) {
        status.textContent = "The form backend could not be reached, so your email app will open as a fallback.";
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
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

function defaultContactEndpoint() {
  return new URL("./api/contact", window.location.href).toString();
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
  const status = document.querySelector("[data-client-access-status]");
  const submitButton = document.querySelector("[data-client-access-submit]");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const slug = formData.get("portal")?.toString().trim() || "";
    const accessCode = formData.get("accessCode")?.toString().trim() || "";
    const originalLabel = submitButton?.textContent || "Open delivery";

    const targetUrl = `./client-access.html?portal=${encodeURIComponent(slug)}`;
    if (!portalSlugFromLocation() && slug) {
      window.history.replaceState({}, "", targetUrl);
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Opening...";
    }

    if (status) {
      status.textContent = "Checking your access and loading the delivered files...";
      status.classList.remove("helper--warn");
    }

    try {
      await unlockPortal(slug, accessCode);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    }
  });

  downloadAllButton?.addEventListener("click", async () => {
    const items = sortedPortalMedia(activePortalMedia);
    try {
      await downloadPortalAsZip(items, downloadAllButton);
    } catch (error) {
      console.error(error);
      clientPortalError = error.message || "Unable to build the ZIP download right now.";
      renderPage();
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
  applySeoMetadata();
  wireHeaderMenu();

  if (page === "home") {
    clearClientPortalState();
    mainEl.innerHTML = homePageMarkup();
    wireSectionReveal();
    wireHeroParallax();
    wireTestimonialsCarousel();
    wireGalleryReel();
    wireServiceAreaMap();
    wirePreviewButtons();
    wireLightbox();
    return;
  }

  if (page === "services") {
    clearClientPortalState();
    mainEl.innerHTML = servicesPageMarkup();
    wireSectionReveal();
    wireTestimonialsCarousel();
    wireServiceAreaMap();
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
