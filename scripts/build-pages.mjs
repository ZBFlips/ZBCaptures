import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const maxPagesFileSizeBytes = 25 * 1024 * 1024;
const siteOrigin = "https://zbcaptures.com";
const socialShareImage = `${siteOrigin}/assets/brand/social-share.png`;
const brandName = "ZB Captures";

const requiredFiles = [
  "index.html",
  "portfolio.html",
  "services.html",
  "contact.html",
  "faq.html",
  "admin.html",
  "client-access.html",
];

const requiredDirectories = ["assets/css", "assets/js", "assets/brand", "content"];
const optionalFiles = ["robots.txt", "sitemap.xml", "favicon.ico", "_headers", "_redirects"];

const routesManifest = {
  version: 1,
  include: ["/api/*"],
  exclude: [],
};

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
      sameAs: ["https://www.instagram.com/zb.re.media/"],
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

function publicPageShell({
  title,
  description,
  page,
  canonicalPath = "",
  assetPrefix = "./",
  bodyAttributes = "",
  structuredData = null,
  mainContent = "",
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    ${headMarkup({ title, description, canonicalPath, assetPrefix, structuredData })}
  </head>
  <body data-page="${escapeHtml(page)}"${bodyAttributes ? ` ${bodyAttributes}` : ""}>
    <div class="page-shell">
      <header id="site-header"></header>
      <main id="site-main">${mainContent}</main>
      <footer id="site-footer"></footer>
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

async function writeLocationPages(locationPages) {
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
        mainContent: locationSeoFallbackMarkup(locationPage, locationPages),
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
    `${siteOrigin}/contact.html`,
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
  const robots = `User-agent: *
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

  await writeLocationPages(locationPages);
  await writeSitemap(locationPages);
  await writeRobots();

  await writeFile(path.join(distDir, "_routes.json"), `${JSON.stringify(routesManifest, null, 2)}\n`);

  console.log(`Built Cloudflare Pages output in ${distDir}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
