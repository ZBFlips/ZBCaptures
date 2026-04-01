import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const faqHtml = await readFile(new URL("../faq.html", import.meta.url), "utf8");
const siteJs = await readFile(new URL("../assets/js/site.js", import.meta.url), "utf8");

const staticFaqPageMatches = faqHtml.match(/"@type":\s*"FAQPage"/g) || [];
assert.equal(
  staticFaqPageMatches.length,
  1,
  `Expected faq.html to contain exactly one static FAQPage schema block, found ${staticFaqPageMatches.length}.`
);

assert.match(
  siteJs,
  /if \(page === "location" && faqSchemaItems\.length\)/,
  "Expected runtime structured data to add FAQPage schema only for location pages."
);

assert.doesNotMatch(
  siteJs,
  /if \(\(page === "faq" \|\| page === "location"\) && faqSchemaItems\.length\)/,
  "Runtime structured data still adds FAQPage schema to faq.html, which causes duplicate FAQPage fields."
);

console.log("FAQ schema regression check passed.");
