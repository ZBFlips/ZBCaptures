import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "../contact-backend/node_modules/sharp/lib/index.js";

const projectRoot = process.cwd();
const siteDataPath = path.join(projectRoot, "content", "site-data.json");
const optimizablePlacements = new Set(["hero", "reveal", "gallery", "featured", "contact", "services"]);
const variants = [
  { name: "thumb", maxWidth: 640, quality: 70 },
  { name: "medium", maxWidth: 1280, quality: 82 },
  { name: "full", maxWidth: 2200, quality: 90 },
];
const force = process.argv.includes("--force");

function normalizeAssetPath(value) {
  return String(value || "").replace(/^\.\//, "").replace(/\\/g, "/");
}

function variantRelativePath(itemId, variantName) {
  return `assets/uploads/${itemId}-${variantName}.webp`;
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

async function fileExists(absolutePath) {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const siteData = JSON.parse(await readFile(siteDataPath, "utf8"));
  let optimizedCount = 0;

  for (const item of siteData.media || []) {
    if (!String(item?.type || "").startsWith("image/")) {
      continue;
    }

    if (!optimizablePlacements.has(String(item?.placement || "gallery"))) {
      continue;
    }

    const normalizedInput = normalizeAssetPath(item.src);
    if (!normalizedInput.startsWith("assets/")) {
      continue;
    }

    const fullVariantPath = variantRelativePath(item.id, "full");
    if (!force && normalizeAssetPath(item?.variants?.full?.src) === fullVariantPath) {
      continue;
    }

    const absoluteInput = path.join(projectRoot, normalizedInput);
    if (!(await fileExists(absoluteInput))) {
      console.warn(`Skipping ${item.id}: source file not found at ${normalizedInput}`);
      continue;
    }

    const image = sharp(absoluteInput).rotate();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      console.warn(`Skipping ${item.id}: could not read image dimensions.`);
      continue;
    }

    const nextVariants = {};
    for (const variant of variants) {
      const target = scaledDimensions(metadata.width, metadata.height, variant.maxWidth);
      const relativeOutput = variantRelativePath(item.id, variant.name);
      const absoluteOutput = path.join(projectRoot, relativeOutput);

      await mkdir(path.dirname(absoluteOutput), { recursive: true });
      await image
        .clone()
        .resize({ width: target.width, withoutEnlargement: true })
        .webp({ quality: variant.quality })
        .toFile(absoluteOutput);

      nextVariants[variant.name] = {
        src: `./${relativeOutput}`,
        type: "image/webp",
        width: target.width,
        height: target.height,
      };
    }

    item.src = nextVariants.full.src;
    item.type = "image/webp";
    item.variants = nextVariants;
    optimizedCount += 1;
  }

  await writeFile(siteDataPath, `${JSON.stringify(siteData, null, 2)}\n`);
  console.log(`Optimized ${optimizedCount} public image(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
