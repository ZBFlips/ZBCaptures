import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const maxPagesFileSizeBytes = 25 * 1024 * 1024;
const siteOrigin = "https://zbcaptures.com";
const socialShareImage = `${siteOrigin}/assets/brand/social-share.png`;
const brandName = "ZB Captures";
const googleBusinessProfileUrl = "https://share.google/aDc3usKYdvNCryRrN";

const requiredFiles = [
  "index.html",
  "portfolio.html",
  "services.html",
  "quote.html",
  "contact.html",
  "locations.html",
  "trust.html",
  "results.html",
  "feedback.html",
  "faq.html",
  "admin.html",
  "client-access.html",
];

const requiredDirectories = ["assets/css", "assets/js", "assets/brand", "content", "admin"];
const optionalFiles = ["robots.txt", "sitemap.xml", "favicon.ico", "_headers", "_redirects"];

const routesManifest = {
  version: 1,
  include: ["/api/*"],
  exclude: [],
};

const preferredLocationSlugs = [
  "pensacola-fl",
  "navarre-fl",
  "gulf-breeze-fl",
  "pace-fl",
  "destin-fl",
  "fort-walton-beach-fl",
];

const businessHoursLabel = "Open daily from 8:00 AM to 6:00 PM";

const testimonials = [
  {
    name: "Eric B.",
    role: "Thumbtack review",
    quote: "Zac was great to work with, providing timely and cost-effective service with a smile. His photos came out great and we'll definitely use him again.",
  },
  {
    name: "Caleb P.",
    role: "Thumbtack review",
    quote: "Zac was very good. I highly recommend him. He was very kind and thoughtful of what we wanted. He was very respectful. He took all of our ideas into consideration. I would absolutely use Zac again 100%. If you want a pro photographer on a short notice, Zac is your guy.",
  },
  {
    name: "Samantha L.",
    role: "Thumbtack review",
    quote: "I've enjoyed working with Zac on many occasions. I like his style, his willingness to get things done, and meet deadlines. There are few in this work that can be organized and creative at the same time. Highly recommend to book!",
  },
  {
    name: "Mike H.",
    role: "Thumbtack review",
    quote: "What I've noticed most about working with Zac over the years is the amount of genuine passion that goes into each project he takes on. ZB goes well above and beyond, making sure the client is happy with the work and they are included in the creative process each step of the way. His turnaround times are speedy and his quality of work is unmatched.",
  },
];

const trustPillars = [
  {
    eyebrow: "Easy booking",
    title: "Clear next steps from inquiry to shoot day.",
    text: "You can send the address, choose the right coverage, and get the shoot scheduled without a lot of back-and-forth.",
  },
  {
    eyebrow: "Industry-ready deliverables",
    title: "Built for MLS, Zillow, Homes.com, and Redfin.",
    text: "The media packages are shaped around the formats and expectations agents already work with every day.",
  },
  {
    eyebrow: "Quick delivery",
    title: "A client portal that feels refined and simple.",
    text: "Finished shoots can be delivered through a clean download portal so agents get the files quickly without chasing links across email threads.",
  },
];

const trustSteps = [
  {
    step: "01",
    title: "Send the address and timing",
    text: "Share the property address, the target timeline, and the coverage you want.",
  },
  {
    step: "02",
    title: "Approve the plan",
    text: "Lock in the package, confirm the shoot, and keep the listing schedule moving.",
  },
  {
    step: "03",
    title: "Get the finished files",
    text: "Receive clean, listing-ready media through a simple portal handoff.",
  },
];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function escapeJsonForScript(value = "") {
  return String(value).replace(/</g, "\\u003c");
}

function absoluteSiteUrl(relativePath = "") {
  const value = String(relativePath || "").replace(/^\.\//, "");
  return new URL(value, `${siteOrigin}/`).toString();
}

function jsonLdScript(payload) {
  return `<script type="application/ld+json">${escapeJsonForScript(JSON.stringify(payload))}</script>`;
}

function headMarkup({ title, description, canonicalPath = "", robots = "index, follow, max-image-preview:large", structuredData = null, assetPrefix = "./" }) {
  const canonicalUrl = absoluteSiteUrl(canonicalPath);

  return `
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${escapeHtml(robots)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(socialShareImage)}" />
    <meta property="og:site_name" content="${escapeHtml(brandName)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(socialShareImage)}" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="${assetPrefix}assets/brand/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${assetPrefix}assets/css/styles.css" />
    ${structuredData ? jsonLdScript(structuredData) : ""}
  `.trim();
}

function sharedBusinessGraph() {
  return [
    {
      "@type": "WebSite",
      "@id": `${siteOrigin}/#website`,
      name: brandName,
      url: `${siteOrigin}/`,
    },
    {
      "@type": ["LocalBusiness", "ProfessionalService"],
      "@id": `${siteOrigin}/#business`,
      name: brandName,
      url: `${siteOrigin}/`,
      image: socialShareImage,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Pensacola",
        addressRegion: "FL",
        addressCountry: "US",
      },
      telephone: "(850) 736-1946",
      email: "zacbrannen@gmail.com",
      areaServed: [
        "Pensacola, FL",
        "Milton, FL",
        "Pace, FL",
        "Gulf Breeze, FL",
        "Navarre, FL",
        "Destin, FL",
        "Fort Walton Beach, FL",
        "Crestview, FL",
      ],
      sameAs: ["https://www.instagram.com/zb.re.media/", googleBusinessProfileUrl],
    },
  ];
}

function locationStructuredData({ title, description, locationPage }) {
  const canonicalUrl = absoluteSiteUrl(`locations/${locationPage.slug}/`);
  const marketName = locationPage.market || locationPage.name;

  return {
    "@context": "https://schema.org",
    "@graph": [
      ...sharedBusinessGraph(),
      {
        "@type": "WebPage",
        "@id": `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: title,
        description,
        isPartOf: { "@id": `${siteOrigin}/#website` },
      },
      {
        "@type": "Service",
        "@id": `${canonicalUrl}#service`,
        serviceType: "Real estate photography",
        name: `Real estate photography in ${marketName}`,
        provider: { "@id": `${siteOrigin}/#business` },
        areaServed: [marketName],
        url: canonicalUrl,
        description,
      },
    ],
  };
}

function locationSeoFallbackMarkup(locationPage, allLocationPages) {
  const nearbyPages = Array.isArray(locationPage.nearbySlugs)
    ? allLocationPages.filter((item) => locationPage.nearbySlugs.includes(item.slug))
    : [];
  const faqItems = Array.isArray(locationPage.faq) ? locationPage.faq.slice(0, 3) : [];
  const coverageSummary = locationPage.coverageSummary || locationPage.cardLead || locationPage.lead || "";

  return `
    <section class="section">
      <p>${escapeHtml(locationPage.eyebrow || `${locationPage.market || locationPage.name} Real Estate Photography`)}</p>
      <h1>${escapeHtml(locationPage.headline || `${locationPage.market || locationPage.name} real estate photography`)}</h1>
      <p>${escapeHtml(locationPage.lead || coverageSummary)}</p>
      ${coverageSummary && coverageSummary !== locationPage.lead ? `<p>${escapeHtml(coverageSummary)}</p>` : ""}
      <p>
        <a href="../../services.html">View services</a> |
        <a href="../../portfolio.html">View portfolio</a> |
        <a href="../../contact.html">Book a session</a>
      </p>
    </section>
    ${
      faqItems.length
        ? `<section class="section">
      <h2>Common questions about ${escapeHtml(locationPage.name)}</h2>
      ${faqItems
        .map(
          (item) => `
        <article>
          <h3>${escapeHtml(item.question)}</h3>
          <p>${escapeHtml(item.answer)}</p>
        </article>
      `
        )
        .join("")}
    </section>`
        : ""
    }
    ${
      nearbyPages.length
        ? `<section class="section">
      <h2>Nearby markets</h2>
      <ul>
        ${nearbyPages
          .map(
            (item) =>
              `<li><a href="../../locations/${item.slug}/">${escapeHtml(item.market || item.name)}</a></li>`
          )
          .join("")}
      </ul>
    </section>`
        : ""
    }
  `.trim();
}

async function loadLocationPages() {
  try {
    const raw = await readFile(path.join(projectRoot, "content", "locations.json"), "utf8");
    const payload = JSON.parse(raw);
    return Array.isArray(payload?.pages) ? payload.pages.filter((item) => item?.slug) : [];
  } catch {
    return [];
  }
}

async function loadSiteData() {
  const raw = await readFile(path.join(projectRoot, "content", "site-data.json"), "utf8");
  return JSON.parse(raw);
}

function normalizeAssetPath(value = "") {
  const stringValue = String(value || "").trim();
  if (!stringValue) {
    return "";
  }

  if (/^(?:https?:|mailto:|tel:)/i.test(stringValue)) {
    return stringValue;
  }

  return stringValue.replace(/^\.\//, "");
}

function relativeHref(basePath = "./", target = "") {
  const normalized = normalizeAssetPath(target);
  if (!normalized) {
    return basePath;
  }

  if (/^(?:https?:|mailto:|tel:)/i.test(normalized)) {
    return normalized;
  }

  return `${basePath}${normalized}`;
}

function currentPathMatches(currentPath = "", targetPath = "") {
  const current = String(currentPath || "").replace(/^\/+|\/+$/g, "") || "index.html";
  const target = String(targetPath || "").replace(/^\/+|\/+$/g, "");

  if (current === target) {
    return true;
  }

  if (target === "index.html" && current === "index.html") {
    return true;
  }

  if (target === "locations.html" && current.startsWith("locations/")) {
    return true;
  }

  return false;
}

function headerLogoMedia(siteData) {
  return (siteData?.media || [])
    .filter((item) => item?.placement === "logo")
    .sort((left, right) => (left.order || 0) - (right.order || 0))[0] || null;
}

function headerNavItems() {
  return [
    { type: "link", href: "index.html", label: "Home" },
    { type: "link", href: "portfolio.html", label: "Portfolio" },
    { type: "link", href: "services.html", label: "Services" },
    {
      type: "menu",
      label: "Explore",
      items: [
        { href: "quote.html", label: "Quote Calculator" },
        { href: "locations.html", label: "Locations" },
        { href: "faq.html", label: "FAQ" },
      ],
    },
    {
      type: "menu",
      label: "Company",
      items: [
        { href: "trust.html", label: "Trust & Process" },
        { href: "feedback.html", label: "Client Feedback" },
      ],
    },
  ];
}

function footerNavItems() {
  return [
    { href: "index.html", label: "Home" },
    { href: "portfolio.html", label: "Portfolio" },
    { href: "services.html", label: "Services" },
    { href: "quote.html", label: "Quote Calculator" },
    { href: "locations.html", label: "Locations" },
    { href: "trust.html", label: "Trust & Process" },
    { href: "feedback.html", label: "Client Feedback" },
    { href: "faq.html", label: "FAQ" },
    { href: "contact.html", label: "Contact" },
    { href: "client-access.html", label: "Client Access" },
  ];
}

function featuredLocationPages(locationPages, limit = 6, excludeSlug = "") {
  const bySlug = new Map((locationPages || []).filter(Boolean).map((item) => [item.slug, item]));
  const selected = [];
  const seen = new Set();

  for (const slug of preferredLocationSlugs) {
    if (!slug || slug === excludeSlug) {
      continue;
    }

    const record = bySlug.get(slug);
    if (record) {
      selected.push(record);
      seen.add(slug);
    }
  }

  for (const record of locationPages || []) {
    if (!record?.slug || record.slug === excludeSlug || seen.has(record.slug)) {
      continue;
    }

    selected.push(record);
    seen.add(record.slug);
  }

  return selected.slice(0, limit);
}

function renderHeaderNavItem(item, currentPath, basePath) {
  if (item.type === "menu" && Array.isArray(item.items)) {
    const hasCurrentChild = item.items.some((child) => currentPathMatches(currentPath, child.href));
    return `
      <details class="nav-dropdown">
        <summary class="nav-dropdown__trigger ${hasCurrentChild ? "is-current" : ""}">
          <span class="nav-dropdown__label">${escapeHtml(item.label)}</span>
          <span class="nav-dropdown__caret" aria-hidden="true"></span>
        </summary>
        <div class="nav-dropdown__menu" aria-label="${escapeHtml(item.label)} submenu">
          ${item.items
            .map((child) => {
              const isCurrent = currentPathMatches(currentPath, child.href);
              return `<a href="${relativeHref(basePath, child.href)}"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(child.label)}</a>`;
            })
            .join("")}
        </div>
      </details>
    `;
  }

  const isCurrent = currentPathMatches(currentPath, item.href);
  return `<a href="${relativeHref(basePath, item.href)}"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`;
}

function headerMarkup({ basePath = "./", currentPath = "index.html", siteData }) {
  const settings = siteData?.settings || {};
  const logo = headerLogoMedia(siteData);
  const logoMarkup = logo
    ? `<img class="brand__logo" src="${relativeHref(basePath, logo.src || logo.originalSrc)}" alt="${escapeHtml(logo.alt || logo.title || settings.brandName || brandName)}" />`
    : `<span class="brand__name">${escapeHtml(settings.brandName || brandName)}</span>`;

  return `
    <div class="site-header">
      <div class="site-header__inner">
        <a class="brand ${logo ? "brand--logo-only" : ""}" href="${relativeHref(basePath, "index.html")}" aria-label="Go to home page">
          ${logoMarkup}
        </a>
        <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav" aria-label="Open navigation menu">
          <span class="nav-toggle__line"></span>
          <span class="nav-toggle__line"></span>
          <span class="nav-toggle__line"></span>
        </button>
        <nav class="nav" id="site-nav" data-site-nav aria-label="Primary navigation">
          ${headerNavItems().map((item) => renderHeaderNavItem(item, currentPath, basePath)).join("")}
          <a class="nav__cta" href="${relativeHref(basePath, "contact.html")}">Contact</a>
        </nav>
      </div>
    </div>
  `.trim();
}

function footerMarkup({ basePath = "./", siteData, locationPages, excludeSlug = "" }) {
  const settings = siteData?.settings || {};
  const featuredMarkets = featuredLocationPages(locationPages, 6, excludeSlug);

  return `
    <div class="footer">
      <div class="footer__inner">
        <div class="footer__brand">
          <strong>${escapeHtml(settings.brandName || brandName)}</strong>
          <p class="footer__headline">${escapeHtml(settings.footerHeadline || "Pensacola real estate photography and video for listings that need strong visuals, easy booking, and quick delivery.")}</p>
          <p class="footer__copy">${escapeHtml(settings.serviceArea || "Pensacola, FL")}</p>
          <a class="footer__contact" href="mailto:${escapeHtml(settings.email || "zacbrannen@gmail.com")}">Primary contact: ${escapeHtml(settings.email || "zacbrannen@gmail.com")}</a>
        </div>
        <div class="footer__stack">
          <div class="footer__heading">Details</div>
          <div class="footer__meta">
            <div class="footer__metaItem">
              <span class="footer__metaLabel">Phone</span>
              <span>${escapeHtml(settings.phone || "(850) 736-1946")}</span>
            </div>
            <div class="footer__metaItem">
              <span class="footer__metaLabel">Instagram</span>
              <a href="https://www.instagram.com/zb.re.media/" target="_blank" rel="noreferrer">${escapeHtml(settings.instagram || "@zb.re.media")}</a>
            </div>
            <div class="footer__metaItem">
              <span class="footer__metaLabel">Google</span>
              <a href="${googleBusinessProfileUrl}" target="_blank" rel="noreferrer">Business Profile</a>
            </div>
            <div class="footer__metaItem">
              <span class="footer__metaLabel">Response time</span>
              <span>${escapeHtml(settings.responseTime || "Usually replies quickly during business hours.")}</span>
            </div>
            <div class="footer__metaItem">
              <span class="footer__metaLabel">Hours</span>
              <span>${businessHoursLabel}</span>
            </div>
          </div>
        </div>
        <div class="footer__stack">
          <div class="footer__heading">Quick links</div>
          <div class="footer__links footer__links--stacked">
            ${footerNavItems().map((item) => `<a href="${relativeHref(basePath, item.href)}">${escapeHtml(item.label)}</a>`).join("")}
          </div>
          <div class="footer__heading">Featured markets</div>
          <div class="footer__links footer__links--markets">
            ${featuredMarkets.map((item) => `<a href="${relativeHref(basePath, `locations/${item.slug}/`)}">${escapeHtml(item.market || item.name)}</a>`).join("")}
          </div>
        </div>
      </div>
    </div>
  `.trim();
}

function serviceSummary(service = {}, index = 0) {
  const bestFit = String(service.bestFit || "").trim();
  if (bestFit) {
    return bestFit;
  }

  const bullets = Array.isArray(service.bullets) ? service.bullets.filter(Boolean) : [];
  if (bullets.length >= 2) {
    return `${bullets[0]} + ${bullets[1]}`;
  }

  return bullets[0] || `Package 0${index + 1}`;
}

function serviceCardsSectionMarkup(siteData) {
  const settings = siteData?.settings || {};
  const services = Array.isArray(siteData?.services) ? siteData.services : [];
  if (!services.length) {
    return "";
  }

  return `
    <section class="section services-page__packages">
      <div class="section__eyebrow">${escapeHtml(settings.homeServicesEyebrow || "Services")}</div>
      <h2 class="section__title">${escapeHtml(settings.homeServicesTitle || "High-performance media for every listing.")}</h2>
      <p class="section__lead">${escapeHtml(settings.homeServicesLead || settings.servicesLead || "")}</p>
      <div class="section-grid grid--cards services-packages">
        ${services
          .map(
            (service, index) => `
              <article class="card card--interactive pricing-card pricing-card--package ${service.featured ? "card--featured" : ""}">
                <div class="card__body">
                  <div class="card__header">
                    <div>
                      <div class="card__eyebrow">${escapeHtml(service.featured ? "Featured package" : `0${index + 1}`)}</div>
                      <h3 class="card__title">${escapeHtml(service.title || "")}</h3>
                    </div>
                    ${service.price ? `<div class="card__price">${escapeHtml(service.price)}</div>` : ""}
                  </div>
                  <p class="card__text">${escapeHtml(service.description || "")}</p>
                  <div class="card__metaLabel">Includes</div>
                  <div class="card__meta">
                    ${(service.bullets || []).map((bullet) => `<span class="pill">${escapeHtml(bullet)}</span>`).join("")}
                  </div>
                  <div class="card__footer">
                    <span class="card__footerLabel">Best fit</span>
                    <div class="card__footerText">${escapeHtml(serviceSummary(service, index))}</div>
                  </div>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function locationMarketsSectionMarkup(locationPages, basePath = "./", options = {}) {
  const items = (locationPages || []).filter(Boolean);
  if (!items.length) {
    return "";
  }

  return `
    <section class="section location-markets">
      <div class="section__eyebrow">${escapeHtml(options.eyebrow || "Featured markets")}</div>
      <h2 class="section__title">${escapeHtml(options.title || "Browse nearby Gulf Coast service areas.")}</h2>
      <p class="section__lead">${escapeHtml(options.lead || "These location pages make it easier to rank for city-specific searches and give agents a page that matches the listing town.")}</p>
      <div class="section-grid location-market-grid">
        ${items
          .map(
            (item) => `
              <a class="card card--interactive location-market-card" href="${relativeHref(basePath, `locations/${item.slug}/`)}">
                <div class="card__body">
                  <div class="card__eyebrow">${escapeHtml(item.market || item.name || "Market page")}</div>
                  <h3 class="card__title">${escapeHtml(item.name || "")}</h3>
                  <p class="card__text">${escapeHtml(item.cardLead || item.lead || item.coverageLead || "")}</p>
                  <div class="card__footer">
                    <span class="card__footerLabel">Best fit</span>
                    <div class="card__footerText">${escapeHtml(item.coverageSummary || item.cardTitle || item.headline || "")}</div>
                  </div>
                </div>
              </a>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function testimonialsSectionMarkup() {
  return `
    <section class="section testimonials-strip">
      <div class="section__eyebrow">Client feedback</div>
      <h2 class="section__title">Real feedback from past clients.</h2>
      <p class="section__lead">These reviews give the public pages stronger proof and keep more trust content crawlable before the app hydrates.</p>
      <div class="section-grid grid--cards">
        ${testimonials
          .map(
            (item) => `
              <article class="testimonial-card">
                <div class="testimonial-card__stars" aria-hidden="true">*****</div>
                <blockquote class="testimonial-card__quote">"${escapeHtml(item.quote)}"</blockquote>
                <div class="testimonial-card__footer">
                  <strong>${escapeHtml(item.name)}</strong>
                  <span>${escapeHtml(item.role)}</span>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function trustSectionMarkup() {
  return `
    <section class="section">
      <div class="section__eyebrow">Trust & process</div>
      <h2 class="section__title">How booking and delivery stay simple.</h2>
      <p class="section__lead">This gives the core trust page crawlable proof around booking, delivery, and handoff without depending on JavaScript rendering.</p>
      <div class="trust-grid">
        ${trustPillars
          .map(
            (pillar, index) => `
              <article class="trust-card ${index === 1 ? "trust-card--accent" : ""}">
                <div class="trust-card__eyebrow">${escapeHtml(pillar.eyebrow)}</div>
                <h3 class="trust-card__title">${escapeHtml(pillar.title)}</h3>
                <p class="trust-card__text">${escapeHtml(pillar.text)}</p>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
    <section class="section">
      <div class="section__eyebrow">How it works</div>
      <h2 class="section__title">Three simple steps from inquiry to delivery.</h2>
      <div class="timeline">
        ${trustSteps
          .map(
            (step) => `
              <div class="timeline__item">
                <div class="timeline__step">${escapeHtml(step.step)}</div>
                <div>
                  <h3 class="timeline__title">${escapeHtml(step.title)}</h3>
                  <p class="timeline__text">${escapeHtml(step.text)}</p>
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function extractMainInner(html = "") {
  const match = html.match(/<main id="site-main">([\s\S]*?)<\/main>/i);
  return match ? match[1].trim() : "";
}

function replaceMainInner(html = "", mainInner = "") {
  return html.replace(/(<main id="site-main">)([\s\S]*?)(<\/main>)/i, (_, open, __, close) => `${open}\n${mainInner}\n      ${close}`);
}

function injectStaticChrome(html = "", { header, footer }) {
  return html
    .replace(/<header id="site-header">\s*<\/header>/i, `<header id="site-header">${header}</header>`)
    .replace(/<footer id="site-footer">\s*<\/footer>/i, `<footer id="site-footer">${footer}</footer>`);
}

function pageEnhancementMarkup(relativePath, siteData, locationPages) {
  switch (relativePath) {
    case "index.html":
      return `${serviceCardsSectionMarkup(siteData)}\n${locationMarketsSectionMarkup(featuredLocationPages(locationPages, 6), "./", {
        eyebrow: "Featured markets",
        title: "Town-specific pages supporting local real estate photography searches.",
      })}`;
    case "services.html":
      return `${serviceCardsSectionMarkup(siteData)}\n${locationMarketsSectionMarkup(featuredLocationPages(locationPages, 6), "./", {
        eyebrow: "Popular markets",
        title: "Supportive city pages for the towns agents search most often.",
      })}`;
    case "locations.html":
      return locationMarketsSectionMarkup(locationPages, "./", {
        eyebrow: "All markets",
        title: "Browse every city page currently supporting local search coverage.",
      });
    case "trust.html":
      return `${trustSectionMarkup()}\n${locationMarketsSectionMarkup(featuredLocationPages(locationPages, 6), "./", {
        eyebrow: "Market proof",
        title: "Local pages that make the service area easy to verify.",
      })}`;
    case "feedback.html":
      return testimonialsSectionMarkup();
    default:
      return "";
  }
}

function publicPageShell({
  title,
  description,
  page,
  canonicalPath = "",
  assetPrefix = "./",
  bodyAttributes = "",
  structuredData = null,
  header = "",
  mainContent = "",
  footer = "",
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    ${headMarkup({ title, description, canonicalPath, assetPrefix, structuredData })}
  </head>
  <body data-page="${escapeHtml(page)}"${bodyAttributes ? ` ${bodyAttributes}` : ""}>
    <div class="page-shell">
      <header id="site-header">${header}</header>
      <main id="site-main">${mainContent}</main>
      <footer id="site-footer">${footer}</footer>
    </div>

    <div class="lightbox" id="lightbox" aria-hidden="true" hidden>
      <button class="lightbox__backdrop" data-lightbox-close aria-label="Close image preview"></button>
      <figure class="lightbox__dialog" role="dialog" aria-modal="true" aria-label="Image preview">
        <button class="lightbox__close" data-lightbox-close aria-label="Close preview">Close</button>
        <div class="lightbox__toolbar">
          <button class="lightbox__nav" type="button" data-lightbox-prev aria-label="Previous image">Previous</button>
          <span class="lightbox__count" id="lightbox-count"></span>
          <button class="lightbox__nav" type="button" data-lightbox-next aria-label="Next image">Next</button>
        </div>
        <img class="lightbox__image" id="lightbox-image" alt="" />
        <figcaption class="lightbox__caption" id="lightbox-caption"></figcaption>
      </figure>
    </div>

    <script type="module" src="${assetPrefix}assets/js/site.js"></script>
  </body>
</html>
`;
}

async function writeGeneratedPage(relativePath, html) {
  const target = path.join(distDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${html.trim()}\n`);
}

async function writeStaticCorePages(siteData, locationPages) {
  const publicPages = requiredFiles.filter((file) => !["admin.html", "client-access.html"].includes(file));

  for (const relativePath of publicPages) {
    const sourceHtml = await readFile(path.join(projectRoot, relativePath), "utf8");
    const enhancementMarkup = pageEnhancementMarkup(relativePath, siteData, locationPages);
    const nextMain = enhancementMarkup
      ? `${extractMainInner(sourceHtml)}\n        <!-- build:static-seo -->\n${enhancementMarkup}\n        <!-- /build:static-seo -->`
      : extractMainInner(sourceHtml);
    const withChrome = injectStaticChrome(sourceHtml, {
      header: headerMarkup({ basePath: "./", currentPath: relativePath, siteData }),
      footer: footerMarkup({ basePath: "./", siteData, locationPages }),
    });

    await writeGeneratedPage(relativePath, replaceMainInner(withChrome, nextMain));
  }
}

async function writeLocationPages(locationPages, siteData) {
  for (const locationPage of locationPages) {
    const title = locationPage.seoTitle || `${locationPage.market || locationPage.name} Real Estate Photography | ZB Captures`;
    const description =
      locationPage.seoDescription ||
      `Real estate photography, drone coverage, and fast listing media for ${locationPage.market || locationPage.name}.`;

    await writeGeneratedPage(
      path.join("locations", locationPage.slug, "index.html"),
      publicPageShell({
        title,
        description,
        page: "location",
        canonicalPath: `locations/${locationPage.slug}/`,
        assetPrefix: "../../",
        bodyAttributes: `data-base-path="../../" data-location-slug="${escapeHtml(locationPage.slug)}"`,
        structuredData: locationStructuredData({ title, description, locationPage }),
        header: headerMarkup({ basePath: "../../", currentPath: `locations/${locationPage.slug}/`, siteData }),
        mainContent: locationSeoFallbackMarkup(locationPage, locationPages),
        footer: footerMarkup({ basePath: "../../", siteData, locationPages, excludeSlug: locationPage.slug }),
      })
    );
  }
}

async function writeSitemap(locationPages) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `${siteOrigin}/`,
      `${siteOrigin}/portfolio.html`,
      `${siteOrigin}/services.html`,
      `${siteOrigin}/quote.html`,
      `${siteOrigin}/contact.html`,
      `${siteOrigin}/locations.html`,
      `${siteOrigin}/trust.html`,
      `${siteOrigin}/feedback.html`,
      `${siteOrigin}/faq.html`,
      ...locationPages.map((item) => `${siteOrigin}/locations/${item.slug}/`),
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${escapeHtml(url)}</loc>
    <lastmod>${today}</lastmod>
  </url>`
  )
  .join("\n")}
</urlset>
`;

  await writeFile(path.join(distDir, "sitemap.xml"), sitemap);
}

async function writeRobots() {
  const robots = `User-agent: OAI-SearchBot
Allow: /

User-agent: GPTBot
Allow: /

User-agent: *
Allow: /

Sitemap: ${siteOrigin}/sitemap.xml
`;

  await writeFile(path.join(distDir, "robots.txt"), robots);
}

async function ensureEntryExists(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);

  try {
    await stat(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing required build input: ${relativePath}\n${message}`);
  }

  return absolutePath;
}

async function copyEntry(relativePath) {
  const source = path.join(projectRoot, relativePath);
  const target = path.join(distDir, relativePath);
  const sourceStat = await stat(source);

  if (sourceStat.isDirectory()) {
    await mkdir(target, { recursive: true });
    const children = await readdir(source);

    for (const child of children) {
      await copyEntry(path.join(relativePath, child));
    }

    return;
  }

  if (sourceStat.size > maxPagesFileSizeBytes) {
    console.warn(
      `Skipping ${relativePath} (${(sourceStat.size / (1024 * 1024)).toFixed(
        2
      )} MiB) because Cloudflare Pages only supports files up to 25 MiB.`
    );
    return;
  }

  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function copyOptionalEntry(relativePath) {
  try {
    await stat(path.join(projectRoot, relativePath));
  } catch {
    return;
  }

  await copyEntry(relativePath);
}

async function referencedAssetFiles() {
  const siteDataPath = await ensureEntryExists("content/site-data.json");
  const raw = await readFile(siteDataPath, "utf8");
  const siteData = JSON.parse(raw);
  const files = new Set();

  const maybeAdd = (value) => {
    if (typeof value !== "string") {
      return;
    }

    const normalized = value.replace(/^\.\//, "");
    if (!normalized.startsWith("assets/")) {
      return;
    }

    files.add(normalized);
  };

  for (const item of siteData.media || []) {
    maybeAdd(item?.src);
    maybeAdd(item?.originalSrc);

    for (const variant of Object.values(item?.variants || {})) {
      maybeAdd(variant?.src);
    }
  }

  return Array.from(files);
}

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  const siteData = await loadSiteData();
  const locationPages = await loadLocationPages();

  for (const file of requiredFiles) {
    await ensureEntryExists(file);
    await copyEntry(file);
  }

  for (const directory of requiredDirectories) {
    await ensureEntryExists(directory);
    await copyEntry(directory);
  }

  for (const assetFile of await referencedAssetFiles()) {
    await copyOptionalEntry(assetFile);
  }

  for (const file of optionalFiles) {
    await copyOptionalEntry(file);
  }

  await writeStaticCorePages(siteData, locationPages);
  await writeLocationPages(locationPages, siteData);
  await writeSitemap(locationPages);
  await writeRobots();

  await writeFile(path.join(distDir, "_routes.json"), `${JSON.stringify(routesManifest, null, 2)}\n`);

  console.log(`Built Cloudflare Pages output in ${distDir}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
