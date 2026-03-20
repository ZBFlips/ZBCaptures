const STORAGE_KEY = "portfolio-site-state-v1";
const DB_NAME = "portfolio-site-media-v1";
const DB_STORE = "media";
const DB_VERSION = 1;

const clone = (value) => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

export const DEFAULT_STATE = {
  settings: {
    brandName: "Cinematic Portfolio",
    brandTag: "Real estate photography with an editorial edge",
    location: "Serving luxury, commercial, and residential listings",
    heroKicker: "Fast. Polished. Distinctive.",
    heroHeadline: "Architecture that feels alive.",
    heroLead:
      "A custom-built portfolio that puts the work first, moves quickly, and makes every listing feel elevated before the client even scrolls.",
    heroCtas: {
      primaryLabel: "Explore services",
      primaryHref: "./services.html",
      secondaryLabel: "Start a project",
      secondaryHref: "./contact.html",
    },
    heroStats: [
      { label: "Turnaround", value: "Same-day or next-day delivery" },
      { label: "Coverage", value: "Interior, exterior, twilight, drone-ready" },
      { label: "Experience", value: "Designed to feel premium from the first second" },
    ],
    servicesLead:
      "Everything here is set up to feel fast on the front end, but still give you room to manage content yourself.",
    contactLead:
      "Send a note with the property address, target timeline, and the kind of coverage you need.",
    videoEmbedUrl: "",
    serviceArea: "Metro area / surrounding listings",
    email: "hello@example.com",
    phone: "(555) 123-4567",
    instagram: "@yourhandle",
    responseTime: "Usually replies within 2 hours during business days.",
    footerNote: "Custom-built and ready for your own domain.",
  },
  services: [
    {
      id: "service-listing",
      title: "Listing Photography",
      description: "Clean, color-true images that make MLS pages look sharp and immediate.",
      bullets: ["Interiors + exteriors", "Blue sky / exposure correction", "Fast delivery"],
    },
    {
      id: "service-luxury",
      title: "Luxury Marketing",
      description: "Cinematic presentation for higher-end homes, builders, and standout properties.",
      bullets: ["Editorial hero imagery", "Twilight options", "Curated online gallery"],
    },
    {
      id: "service-media",
      title: "Media Package",
      description: "A flexible package for clients that want photography, reels, and website-ready assets.",
      bullets: ["Video embeds", "Social cutdowns", "Brand-friendly formatting"],
    },
  ],
};

function mergeDeep(base, incoming) {
  if (!incoming || typeof incoming !== "object") {
    return clone(base);
  }

  const output = Array.isArray(base) ? [...base] : { ...base };

  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) {
      output[key] = value;
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object") {
      output[key] = mergeDeep(base[key], value);
      continue;
    }

    output[key] = value;
  }

  return output;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return clone(DEFAULT_STATE);
    }

    return mergeDeep(DEFAULT_STATE, JSON.parse(raw));
  } catch {
    return clone(DEFAULT_STATE);
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState() {
  localStorage.removeItem(STORAGE_KEY);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore(mode, handler) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const store = tx.objectStore(DB_STORE);
    const result = handler(store);

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listMedia() {
  return withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const items = (request.result || []).sort((a, b) => {
          const left = Number.isFinite(a.order) ? a.order : 9999;
          const right = Number.isFinite(b.order) ? b.order : 9999;
          return left - right || (b.createdAt || 0) - (a.createdAt || 0);
        });
        resolve(items);
      };
    });
  });
}

export async function getMedia(id) {
  return withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  });
}

export async function putMedia(record) {
  const entry = {
    id: record.id || (crypto.randomUUID ? crypto.randomUUID() : `media-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    blob: record.blob,
    name: record.name || "upload",
    type: record.type || "image/jpeg",
    createdAt: record.createdAt || Date.now(),
    title: record.title || "",
    caption: record.caption || "",
    alt: record.alt || "",
    placement: record.placement || "gallery",
    order: Number.isFinite(record.order) ? record.order : 0,
    featured: Boolean(record.featured),
  };

  await withStore("readwrite", (store) => store.put(entry));
  return entry;
}

export async function updateMedia(id, patch) {
  const current = await getMedia(id);
  if (!current) {
    return null;
  }

  const updated = {
    ...current,
    ...patch,
    order: Number.isFinite(Number(patch.order)) ? Number(patch.order) : current.order,
    featured: patch.featured ?? current.featured,
  };

  await withStore("readwrite", (store) => store.put(updated));
  return updated;
}

export async function deleteMedia(id) {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function clearMedia() {
  await withStore("readwrite", (store) => store.clear());
}
