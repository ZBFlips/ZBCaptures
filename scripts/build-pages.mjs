import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");

const requiredFiles = [
  "index.html",
  "services.html",
  "contact.html",
  "admin.html",
  "client-access.html",
];

const requiredDirectories = ["assets", "content"];
const optionalFiles = ["robots.txt", "sitemap.xml", "favicon.ico", "_headers", "_redirects"];

const routesManifest = {
  version: 1,
  include: ["/api/*"],
  exclude: [],
};

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
  const targetParent = path.dirname(target);

  await mkdir(targetParent, { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function copyOptionalEntry(relativePath) {
  try {
    await stat(path.join(projectRoot, relativePath));
  } catch {
    return;
  }

  await copyEntry(relativePath);
}

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  for (const file of requiredFiles) {
    await ensureEntryExists(file);
    await copyEntry(file);
  }

  for (const directory of requiredDirectories) {
    await ensureEntryExists(directory);
    await copyEntry(directory);
  }

  for (const file of optionalFiles) {
    await copyOptionalEntry(file);
  }

  await writeFile(path.join(distDir, "_routes.json"), `${JSON.stringify(routesManifest, null, 2)}\n`);

  console.log(`Built Cloudflare Pages output in ${distDir}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
