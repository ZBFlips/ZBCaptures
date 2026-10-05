// Pricing rules shared by the quote calculator (site.js) and the static build
// (scripts/build-pages.mjs). Change a number here and both the calculator math
// and the "Pricing details" text on the services page follow it.

export const TRAVEL_ORIGIN_LABEL = "Pensacola";

// Package prices cover homes up to this size.
export const SIZE_INCLUDED_MAX_SQFT = 2500;

// Surcharges above the included size. Anything past the last tier is quoted.
export const SIZE_TIERS = [
  { min: 2501, max: 4000, amount: 50 },
  { min: 4001, max: 5500, amount: 100 },
];

export const SIZE_QUOTE_ABOVE_SQFT = SIZE_TIERS[SIZE_TIERS.length - 1].max;

// Travel is measured from Pensacola. Anything past the last tier is quoted.
export const TRAVEL_TIERS = [
  { value: "within-30", max: 30, amount: 0, label: "Within 30 miles" },
  { value: "30-50", max: 50, amount: 35, label: "30 to 50 miles" },
  { value: "50-75", max: 75, amount: 65, label: "50 to 75 miles" },
];

export const TRAVEL_QUOTE_TIER = { value: "over-75", max: Infinity, amount: null, label: "Over 75 miles" };

export const TRAVEL_FREE_MILES = TRAVEL_TIERS[0].max;
export const TRAVEL_QUOTE_ABOVE_MILES = TRAVEL_TIERS[TRAVEL_TIERS.length - 1].max;

// "inline" is how the add-on reads in the middle of a sentence.
// "includedWhen" is matched against a package's title and bullets: if it
// matches, that package already includes the add-on, so it can't be added again.
export const ADD_ONS = [
  { value: "3D tour", label: "3D tour", inline: "a 3D tour", price: 150, includedWhen: /\b3\s*-?\s*d\b.*\btour|\bmatterport\b/i },
  { value: "Drone video", label: "Drone video", inline: "drone video", price: 175, includedWhen: /\b(drone|aerial)\s+video/i },
  { value: "Twilight session", label: "Twilight session", inline: "a twilight session", price: 150, includedWhen: /\btwilight\b/i },
];

function dollars(amount) {
  return `$${Number(amount).toLocaleString("en-US")}`;
}

function count(value) {
  return Number(value).toLocaleString("en-US");
}

function sentenceList(parts) {
  if (parts.length <= 1) {
    return parts.join("");
  }

  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// Add-on values a package already includes, judged from its title and bullets.
export function addOnsIncludedIn(service) {
  if (!service) {
    return [];
  }

  const lines = [service.title, ...(Array.isArray(service.bullets) ? service.bullets : [])].map((line) => String(line || ""));
  return ADD_ONS.filter((item) => item.includedWhen && lines.some((line) => item.includedWhen.test(line))).map(
    (item) => item.value
  );
}

export function addOnInlineLabel(value) {
  const match = ADD_ONS.find((item) => item.value === value);
  return match ? match.inline : String(value || "");
}

export function addOnPrice(value) {
  const match = ADD_ONS.find((item) => item.value === value);
  return match ? match.price : 0;
}

// Returns { amount, label, customQuote } for a square footage (0 means "not given").
export function sizeAdjustmentFor(squareFeet) {
  const size = Number(squareFeet) || 0;
  if (!size || size <= SIZE_INCLUDED_MAX_SQFT) {
    return { amount: 0, label: "", customQuote: false };
  }

  const tier = SIZE_TIERS.find((item) => size <= item.max);
  if (!tier) {
    return { amount: 0, label: `Over ${count(SIZE_QUOTE_ABOVE_SQFT)} sq ft`, customQuote: true };
  }

  return {
    amount: tier.amount,
    label: `${count(tier.min)} to ${count(tier.max)} sq ft`,
    customQuote: false,
  };
}

export function travelTierForValue(value) {
  const key = String(value || "").trim();
  if (!key) {
    return null;
  }

  return [...TRAVEL_TIERS, TRAVEL_QUOTE_TIER].find((item) => item.value === key) || null;
}

export function travelTierForMiles(miles) {
  const distance = Number(miles);
  if (!Number.isFinite(distance) || distance < 0) {
    return null;
  }

  return TRAVEL_TIERS.find((item) => distance <= item.max) || TRAVEL_QUOTE_TIER;
}

export function travelOptionLabel(tier) {
  if (tier.amount === null) {
    return `${tier.label} (custom quote)`;
  }

  return tier.amount ? `${tier.label} (+${dollars(tier.amount)})` : `${tier.label} (no travel fee)`;
}

export function travelNoteForMiles(miles) {
  const tier = travelTierForMiles(miles);
  if (!tier) {
    return "";
  }

  if (tier.amount === null) {
    return `Travel beyond ${TRAVEL_QUOTE_ABOVE_MILES} miles is quoted individually.`;
  }

  return tier.amount
    ? `A ${dollars(tier.amount)} travel fee applies (${tier.label.toLowerCase()}).`
    : `No travel fee (within ${TRAVEL_FREE_MILES} miles).`;
}

// The plain-language rules shown on the services page.
export function pricingRuleItems() {
  const sizeParts = SIZE_TIERS.map((tier) => `${dollars(tier.amount)} for ${count(tier.min)} to ${count(tier.max)} sq ft`);
  const travelParts = TRAVEL_TIERS.filter((tier) => tier.amount).map(
    (tier) => `${dollars(tier.amount)} for ${tier.label.toLowerCase()}`
  );

  return [
    {
      label: "Home size",
      text: `Package prices cover homes up to ${count(SIZE_INCLUDED_MAX_SQFT)} sq ft. Add ${sentenceList(sizeParts)}. Homes over ${count(SIZE_QUOTE_ABOVE_SQFT)} sq ft are quoted individually.`,
    },
    {
      label: "Travel",
      text: `Travel is free within ${TRAVEL_FREE_MILES} miles of ${TRAVEL_ORIGIN_LABEL}. Add ${sentenceList(travelParts)}. Beyond ${TRAVEL_QUOTE_ABOVE_MILES} miles is quoted individually.`,
    },
    {
      label: "Photo counts",
      text: "Photo counts are listed as \"up to\", not as a minimum. A small condo gets the images it needs to be covered well, not a padded set.",
    },
    {
      label: "Add-ons",
      text: `${sentenceList(ADD_ONS.map((item) => `${item.label} ${dollars(item.price)}`))}. An add-on can't be added to a package that already includes it.`,
    },
  ];
}
