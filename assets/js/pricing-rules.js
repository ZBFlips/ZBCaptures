// Pricing rules shared by the quote calculator (site.js), the admin panel
// (admin.js) and the static build (scripts/build-pages.mjs).
//
// The numbers below are only the starting values. Once the "Quote calculator"
// section of the admin has been saved, the saved values (settings.pricing in
// content/site-data.json) are used instead.

export const TRAVEL_ORIGIN_LABEL = "Pensacola";

export const DEFAULT_PRICING = {
  // Package prices cover homes up to this size.
  sizeIncludedMax: 2500,
  // Surcharges above the included size. Anything past the last tier is quoted.
  sizeTiers: [
    { max: 4000, amount: 50 },
    { max: 5500, amount: 100 },
  ],
  // Travel is free within this many miles.
  travelFreeMiles: 30,
  // Travel fees beyond the free zone. Anything past the last tier is quoted.
  travelTiers: [
    { max: 50, amount: 35 },
    { max: 75, amount: 65 },
  ],
  addOns: [
    { label: "3D tour", price: 150 },
    { label: "Drone video", price: 175 },
    { label: "Twilight session", price: 150 },
  ],
};

// Other wording that means the same thing as a well-known add-on, so a package
// that lists "Zillow 3D Home Tour" is understood to include the "3D tour" add-on.
const ADD_ON_ALIASES = [
  { when: /\b3\s*-?\s*d\b|\bmatterport\b|\bvirtual tour\b/i, includedWhen: /\b3\s*-?\s*d\b.*\btour|\bmatterport\b|\bvirtual tour\b/i },
  { when: /\b(drone|aerial)\b.*\bvideo/i, includedWhen: /\b(drone|aerial)\s+video/i },
  { when: /\btwilight\b/i, includedWhen: /\btwilight\b/i },
];

function toNumber(value) {
  const amount = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Keeps only tiers that make sense: a limit above the starting point, sorted, no duplicates.
function cleanTiers(tiers, floor) {
  const seen = new Set();
  return (Array.isArray(tiers) ? tiers : [])
    .map((tier) => ({ max: Math.round(toNumber(tier?.max)), amount: Math.round(toNumber(tier?.amount)) }))
    .filter((tier) => tier.max > floor)
    .sort((a, b) => a.max - b.max)
    .filter((tier) => (seen.has(tier.max) ? false : seen.add(tier.max)));
}

// Fills in defaults and drops anything unusable. Safe to call with undefined.
export function normalizePricingConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  const sizeIncludedMax = Math.round(toNumber(source.sizeIncludedMax)) || DEFAULT_PRICING.sizeIncludedMax;
  const travelFreeMiles =
    source.travelFreeMiles === undefined || source.travelFreeMiles === null || source.travelFreeMiles === ""
      ? DEFAULT_PRICING.travelFreeMiles
      : Math.round(toNumber(source.travelFreeMiles));
  const seenLabels = new Set();

  return {
    sizeIncludedMax,
    sizeTiers: cleanTiers(Array.isArray(source.sizeTiers) ? source.sizeTiers : DEFAULT_PRICING.sizeTiers, sizeIncludedMax),
    travelFreeMiles,
    travelTiers: cleanTiers(Array.isArray(source.travelTiers) ? source.travelTiers : DEFAULT_PRICING.travelTiers, travelFreeMiles),
    addOns: (Array.isArray(source.addOns) ? source.addOns : DEFAULT_PRICING.addOns)
      .map((item) => ({ label: String(item?.label ?? "").trim().replace(/\s+/g, " "), price: Math.round(toNumber(item?.price)) }))
      .filter((item) => {
        const key = item.label.toLowerCase();
        if (!key || seenLabels.has(key)) {
          return false;
        }

        seenLabels.add(key);
        return true;
      }),
  };
}

function includedPatternFor(label) {
  const alias = ADD_ON_ALIASES.find((entry) => entry.when.test(label));
  const words = label.split(/\s+/).filter(Boolean).map(escapeRegExp);
  const byName = new RegExp(`(^|[^a-z0-9])${words.join("\\s+")}(?![a-z0-9])`, "i");
  return alias ? new RegExp(`${alias.includedWhen.source}|${byName.source}`, "i") : byName;
}

// Builds the working rule set from a saved configuration (or the defaults).
export function createPricingRules(config) {
  const settings = normalizePricingConfig(config);

  let previousMax = settings.sizeIncludedMax;
  const sizeTiers = settings.sizeTiers.map((tier) => {
    const entry = { min: previousMax + 1, max: tier.max, amount: tier.amount };
    previousMax = tier.max;
    return entry;
  });
  const sizeQuoteAbove = sizeTiers.length ? sizeTiers[sizeTiers.length - 1].max : settings.sizeIncludedMax;

  let previousMiles = settings.travelFreeMiles;
  const paidTravelTiers = settings.travelTiers.map((tier) => {
    const entry = {
      value: `${previousMiles}-${tier.max}`,
      max: tier.max,
      amount: tier.amount,
      label: `${previousMiles} to ${tier.max} miles`,
    };
    previousMiles = tier.max;
    return entry;
  });
  const freeTravelTier = {
    value: `within-${settings.travelFreeMiles}`,
    max: settings.travelFreeMiles,
    amount: 0,
    label: `Within ${settings.travelFreeMiles} miles`,
  };
  // With no free zone the list simply starts at the first paid tier.
  const travelTiers = settings.travelFreeMiles > 0 || !paidTravelTiers.length ? [freeTravelTier, ...paidTravelTiers] : paidTravelTiers;
  const travelQuoteAbove = travelTiers[travelTiers.length - 1].max;
  const travelQuoteTier = {
    value: `over-${travelQuoteAbove}`,
    max: Infinity,
    amount: null,
    label: `Over ${travelQuoteAbove} miles`,
  };

  const addOns = settings.addOns.map((item) => ({
    value: item.label,
    label: item.label,
    price: item.price,
    includedWhen: includedPatternFor(item.label),
  }));

  function addOnPrice(value) {
    const match = addOns.find((item) => item.value === value);
    return match ? match.price : 0;
  }

  // Add-on values a package already includes, judged from its title and bullets.
  function addOnsIncludedIn(service) {
    if (!service) {
      return [];
    }

    const lines = [service.title, ...(Array.isArray(service.bullets) ? service.bullets : [])].map((line) => String(line || ""));
    return addOns.filter((item) => lines.some((line) => item.includedWhen.test(line))).map((item) => item.value);
  }

  // Returns { amount, label, customQuote } for a square footage (0 means "not given").
  function sizeAdjustmentFor(squareFeet) {
    const size = Number(squareFeet) || 0;
    if (!size || size <= settings.sizeIncludedMax) {
      return { amount: 0, label: "", customQuote: false };
    }

    const tier = sizeTiers.find((item) => size <= item.max);
    if (!tier) {
      return { amount: 0, label: `Over ${count(sizeQuoteAbove)} sq ft`, customQuote: true };
    }

    return {
      amount: tier.amount,
      label: `${count(tier.min)} to ${count(tier.max)} sq ft`,
      customQuote: false,
    };
  }

  function travelTierForValue(value) {
    const key = String(value || "").trim();
    if (!key) {
      return null;
    }

    return [...travelTiers, travelQuoteTier].find((item) => item.value === key) || null;
  }

  function travelTierForMiles(miles) {
    const distance = Number(miles);
    if (!Number.isFinite(distance) || distance < 0) {
      return null;
    }

    return travelTiers.find((item) => distance <= item.max) || travelQuoteTier;
  }

  function travelOptionLabel(tier) {
    if (tier.amount === null) {
      return `${tier.label} (custom quote)`;
    }

    return tier.amount ? `${tier.label} (+${dollars(tier.amount)})` : `${tier.label} (no travel fee)`;
  }

  function travelNoteForMiles(miles) {
    const tier = travelTierForMiles(miles);
    if (!tier) {
      return "";
    }

    if (tier.amount === null) {
      return `Travel beyond ${travelQuoteAbove} miles is quoted individually.`;
    }

    return tier.amount
      ? `A ${dollars(tier.amount)} travel fee applies (${tier.label.toLowerCase()}).`
      : `No travel fee (${tier.label.toLowerCase()}).`;
  }

  // The plain-language rules shown on the services page.
  function pricingRuleItems() {
    const sizeParts = sizeTiers
      .filter((tier) => tier.amount)
      .map((tier) => `${dollars(tier.amount)} for ${count(tier.min)} to ${count(tier.max)} sq ft`);
    const travelParts = travelTiers
      .filter((tier) => tier.amount)
      .map((tier) => `${dollars(tier.amount)} for ${tier.label.toLowerCase()}`);

    const items = [
      {
        label: "Home size",
        text: [
          `Package prices cover homes up to ${count(settings.sizeIncludedMax)} sq ft.`,
          sizeParts.length ? `Add ${sentenceList(sizeParts)}.` : "",
          `Homes over ${count(sizeQuoteAbove)} sq ft are quoted individually.`,
        ]
          .filter(Boolean)
          .join(" "),
      },
      {
        label: "Travel",
        text: [
          settings.travelFreeMiles
            ? `Travel is free within ${settings.travelFreeMiles} miles of ${TRAVEL_ORIGIN_LABEL}.`
            : travelQuoteAbove
              ? `Travel is measured from ${TRAVEL_ORIGIN_LABEL}.`
              : "",
          travelParts.length ? `Add ${sentenceList(travelParts)}.` : "",
          travelQuoteAbove ? `Beyond ${travelQuoteAbove} miles is quoted individually.` : "Travel is quoted individually.",
        ]
          .filter(Boolean)
          .join(" "),
      },
      {
        label: "Photo counts",
        text: "Photo counts are listed as \"up to\", not as a minimum. A small condo gets the images it needs to be covered well, not a padded set.",
      },
    ];

    if (addOns.length) {
      items.push({
        label: "Add-ons",
        text: `${sentenceList(addOns.map((item) => `${item.label} ${dollars(item.price)}`))}. An add-on can't be added to a package that already includes it.`,
      });
    }

    return items;
  }

  return {
    settings,
    travelOriginLabel: TRAVEL_ORIGIN_LABEL,
    sizeIncludedMax: settings.sizeIncludedMax,
    sizeTiers,
    sizeQuoteAbove,
    travelFreeMiles: settings.travelFreeMiles,
    travelTiers,
    travelQuoteTier,
    travelQuoteAbove,
    addOns,
    addOnPrice,
    addOnsIncludedIn,
    sizeAdjustmentFor,
    travelTierForValue,
    travelTierForMiles,
    travelOptionLabel,
    travelNoteForMiles,
    pricingRuleItems,
  };
}
