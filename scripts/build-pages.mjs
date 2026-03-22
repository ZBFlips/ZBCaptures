import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const maxPagesFileSizeBytes = 25 * 1024 * 1024;
const siteOrigin = "https://zbcaptures.pages.dev";

const requiredFiles = [
  "index.html",
  "services.html",
  "contact.html",
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

async function loadLocationPages() {
  try {
    const raw = await readFile(path.join(projectRoot, "content", "locations.json"), "utf8");
    const payload = JSON.parse(raw);
    return Array.isArray(payload?.pages) ? payload.pages.filter((item) => item?.slug) : [];
  } catch {
    return [];
  }
}

function publicPageShell({ title, description, page, assetPrefix = "./", bodyAttributes = "" }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(description)}" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="${assetPrefix}assets/brand/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${assetPrefix}assets/css/styles.css" />
  </head>
  <body data-page="${escapeHtml(page)}"${bodyAttributes ? ` ${bodyAttributes}` : ""}>
    <div class="page-shell">
      <header id="site-header"></header>
      <main id="site-main"></main>
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
        assetPrefix: "../../",
        bodyAttributes: `data-base-path="../../" data-location-slug="${escapeHtml(locationPage.slug)}"`,
      })
    );
  }
}

async function writeSitemap(locationPages) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `${siteOrigin}/`,
    `${siteOrigin}/services.html`,
    `${siteOrigin}/contact.html`,
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

  await writeFile(path.join(distDir, "_routes.json"), `${JSON.stringify(routesManifest, null, 2)}\n`);

  console.log(`Built Cloudflare Pages output in ${distDir}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
