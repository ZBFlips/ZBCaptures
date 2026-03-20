const STORAGE_KEY = "portfolio-site-state-v1";
const DB_NAME = "portfolio-site-media-v1";
const DB_STORE = "media";
const WORKSPACE_STORE = "workspace";
const WORKSPACE_KEY = "local-workspace-directory";
const DB_VERSION = 2;
const LEGACY_SERVICES_LEAD =
  "Everything here is set up to feel fast on the front end, but still give you room to manage content yourself.";

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
    featuredFrameTitle: "Selected work",
    featuredFrameLead: "A single image can carry the whole listing.",
    featuredFrameMediaId: "",
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
      "I deliver polished, listing-ready media with a guaranteed 24-hour turnaround, giving each property a cleaner first impression and a faster path to market.",
    proofEyebrow: "Why agents book this",
    proofTitle: "Everything is designed to make the listing feel more valuable, not more complicated.",
    proofLead: "The experience stays clean, fast, and premium, so the focus stays on the property and the confidence it creates for buyers.",
    proofCards: [
      {
        eyebrow: "Faster launch",
        title: "Listings can move from shoot to market quickly.",
        text: "The turnaround and package structure make it easy for agents to keep momentum when a property is ready to go live.",
      },
      {
        eyebrow: "Stronger first impression",
        title: "Premium presentation makes the work feel worth hiring.",
        text: "The visual hierarchy, pricing clarity, and gallery treatment all reinforce a higher-value service.",
      },
      {
        eyebrow: "Simple handoff",
        title: "Media is easy to review, choose, and share.",
        text: "The site is set up so the process feels organized instead of technical, which builds trust immediately.",
      },
    ],
    contactLead:
      "Send a note with the property address, target timeline, and the kind of coverage you need.",
    videoEmbedUrl: "",
    serviceArea: "Metro area / surrounding listings",
    email: "hello@example.com",
    phone: "(555) 123-4567",
    instagram: "@yourhandle",
    responseTime: "Usually replies within 2 hours during business days.",
    contactNotificationEndpoint: "",
    footerNote: "Custom-built and ready for your own domain.",
  },
  services: [
    {
      id: "service-listing",
      title: "Listing Photography",
      price: "$150",
      featured: false,
      description: "Clean, color-true images that make MLS pages look sharp and immediate.",
      bullets: ["Interiors + exteriors", "Blue sky / exposure correction", "Fast delivery"],
    },
    {
      id: "service-luxury",
      title: "Luxury Marketing",
      price: "$250",
      featured: true,
      description: "Cinematic presentation for higher-end homes, builders, and standout properties.",
      bullets: ["Editorial hero imagery", "Twilight options", "Curated online gallery"],
    },
    {
      id: "service-media",
      title: "Media Package",
      price: "$450",
      featured: false,
      description: "A flexible package for clients that want photography, reels, and website-ready assets.",
      bullets: ["Video embeds", "Social cutdowns", "Brand-friendly formatting"],
    },
  ],
  clientPortals: [],
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

    const state = mergeDeep(DEFAULT_STATE, JSON.parse(raw));
    if (!state.settings.servicesLead || state.settings.servicesLead === LEGACY_SERVICES_LEAD) {
      state.settings.servicesLead = DEFAULT_STATE.settings.servicesLead;
    }

    return state;
  } catch {
    return clone(DEFAULT_STATE);
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function hasSavedState() {
  return localStorage.getItem(STORAGE_KEY) !== null;
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
    if (!db.objectStoreNames.contains(WORKSPACE_STORE)) {
      db.createObjectStore(WORKSPACE_STORE, { keyPath: "id" });
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
  const sourceExtension = record.src?.match(/\.(\w+)(?:\?|#|$)/)?.[1]?.toLowerCase();
  const inferredType = (() => {
    switch (sourceExtension) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "gif":
        return "image/gif";
      case "mp4":
        return "video/mp4";
      case "mov":
        return "video/quicktime";
      case "webm":
        return "video/webm";
      default:
        return "application/octet-stream";
    }
  })();

  const entry = {
    id: record.id || (crypto.randomUUID ? crypto.randomUUID() : `media-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    blob: record.blob || null,
    name: record.name || "upload",
    type: record.type || inferredType,
    createdAt: record.createdAt || Date.now(),
    title: record.title || "",
    caption: record.caption || "",
    alt: record.alt || "",
    placement: record.placement || "gallery",
    order: Number.isFinite(record.order) ? record.order : 0,
    featured: Boolean(record.featured),
    portalId: record.portalId || "",
    src: record.src || "",
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

export async function saveWorkspaceDirectoryHandle(handle) {
  if (!handle) {
    return;
  }

  await withStore("readwrite", (store) => {
    store.put({ id: WORKSPACE_KEY, handle });
  });
}

export async function loadWorkspaceDirectoryHandle() {
  return withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const request = store.get(WORKSPACE_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result?.handle || null);
    });
  });
}

export async function clearWorkspaceDirectoryHandle() {
  await withStore("readwrite", (store) => store.delete(WORKSPACE_KEY));
}
