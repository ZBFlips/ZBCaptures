import { EmailMessage } from "cloudflare:email";

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function normalizeField(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeField(item)).filter(Boolean);
  }

  const single = normalizeField(value);
  return single ? [single] : [];
}

function extractEmailAddress(value) {
  const text = normalizeField(value);
  if (!text) {
    return "";
  }

  const angleMatch = text.match(/<([^<>]+)>/);
  if (angleMatch?.[1]) {
    return angleMatch[1].trim();
  }

  const directMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return directMatch?.[0]?.trim() || "";
}

function contactConfig(env = {}) {
  const fromHeader = normalizeField(env.NOTIFICATION_FROM);
  const toHeader = normalizeField(env.NOTIFICATION_TO);
  const fromAddress = extractEmailAddress(fromHeader);
  const toAddress = extractEmailAddress(toHeader);
  const missing = [];

  if (!env.CONTACT_SUBMISSIONS) {
    missing.push("CONTACT_SUBMISSIONS");
  }
  if (!env.EMAIL) {
    missing.push("EMAIL");
  }
  if (!fromHeader || !fromAddress) {
    missing.push("NOTIFICATION_FROM");
  }
  if (!toHeader || !toAddress) {
    missing.push("NOTIFICATION_TO");
  }

  return {
    configured: missing.length === 0,
    missing,
    fromHeader,
    toHeader,
    fromAddress,
    toAddress,
  };
}

function buildKey(timestamp, id) {
  const safeStamp = timestamp.replace(/[:.]/g, "-");
  return `submissions/${timestamp.slice(0, 10)}/${safeStamp}-${id}.json`;
}

function buildEmail(submission, savedAs, from, to) {
  const subject = submission.propertyAddress
    ? `New contact form submission for ${submission.propertyAddress}`
    : `New contact form submission from ${submission.name || "website visitor"}`;
  const body = [
    "New contact form submission",
    "",
    `Name: ${submission.name || "-"}`,
    `Email: ${submission.email || "-"}`,
    `Phone: ${submission.phone || "-"}`,
    `Brokerage or team: ${submission.brokerage || "-"}`,
    `Property address: ${submission.propertyAddress || "-"}`,
    `Property type: ${submission.propertyType || "-"}`,
    `Square footage: ${submission.squareFeet || "-"}`,
    `Preferred shoot date: ${submission.shootDate || "-"}`,
    `Package: ${submission.packageInterest || "-"}`,
    `Turnaround: ${submission.turnaround || "-"}`,
    `Add-ons: ${submission.addOns?.length ? submission.addOns.join(", ") : "-"}`,
    `Estimate label: ${submission.estimateLabel || "-"}`,
    `Estimate total: ${submission.estimateTotal || "-"}`,
    `Estimate summary: ${submission.estimateSummary || "-"}`,
    `Service area status: ${submission.serviceAreaStatus || "-"}`,
    `Service area distance: ${submission.serviceAreaDistance || "-"}`,
    "",
    "Message:",
    submission.message || "-",
    "",
    `Source: ${submission.source || "-"}`,
    `Page: ${submission.page || "-"}`,
    `Submitted: ${submission.submittedAt}`,
    `Saved as: ${savedAs}`,
    `User agent: ${submission.userAgent || "-"}`,
    `Referrer: ${submission.referrer || "-"}`,
  ].join("\r\n");

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    submission.email ? `Reply-To: ${submission.name || "Website Visitor"} <${submission.email}>` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    `X-Submission-Id: ${savedAs}`,
    "",
    body,
  ]
    .filter(Boolean)
    .join("\r\n");
}

async function parseSubmission(request) {
  const contentType = request.headers.get("content-type") || "";
  let raw = {};

  if (contentType.includes("application/json")) {
    raw = await request.json();
  } else {
    const formData = await request.formData();
    raw = Object.fromEntries(formData.entries());
  }

  const now = new Date().toISOString();

  return {
    name: normalizeField(raw.name),
    email: normalizeField(raw.email),
    phone: normalizeField(raw.phone),
    brokerage: normalizeField(raw.brokerage),
    propertyAddress: normalizeField(raw.propertyAddress),
    propertyType: normalizeField(raw.propertyType),
    squareFeet: normalizeField(raw.squareFeet),
    shootDate: normalizeField(raw.shootDate),
    packageInterest: normalizeField(raw.packageInterest),
    turnaround: normalizeField(raw.turnaround),
    addOns: normalizeList(raw.addOns),
    estimateLabel: normalizeField(raw.estimateLabel),
    estimateTotal: normalizeField(raw.estimateTotal),
    estimateSummary: normalizeField(raw.estimateSummary),
    serviceAreaStatus: normalizeField(raw.serviceAreaStatus),
    serviceAreaDistance: normalizeField(raw.serviceAreaDistance),
    message: normalizeField(raw.message),
    company: normalizeField(raw.company),
    source: normalizeField(raw.source) || "ZB Captures website",
    page: normalizeField(raw.page),
    submittedAt: normalizeField(raw.submittedAt) || now,
    userAgent: request.headers.get("user-agent") || "",
    referrer: request.headers.get("referer") || "",
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("origin") || "*";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("origin") || "*";
  const config = contactConfig(context.env);

  return json(
    {
      ok: config.configured,
      configured: config.configured,
      message: config.configured
        ? "The contact backend is configured and ready."
        : "The contact backend is missing required Cloudflare bindings or notification email settings.",
      missing: config.missing,
    },
    config.configured ? 200 : 503,
    corsHeaders(origin)
  );
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("origin") || "*";
  const config = contactConfig(context.env);

  if (!config.configured) {
    return json(
      {
        ok: false,
        error: "The contact backend is not configured yet.",
        missing: config.missing,
      },
      503,
      corsHeaders(origin)
    );
  }

  try {
    const submission = await parseSubmission(context.request);

    if (submission.company) {
      return json({ ok: true, message: "Submission received." }, 200, corsHeaders(origin));
    }

    if (!submission.name || !submission.email || !submission.phone || !submission.propertyAddress || !submission.message) {
      return json(
        {
          ok: false,
          error: "Name, email, phone, property address, and project details are required.",
        },
        400,
        corsHeaders(origin)
      );
    }

    const id = crypto.randomUUID();
    const savedAs = buildKey(submission.submittedAt, id);
    const record = {
      id,
      ...submission,
    };

    await context.env.CONTACT_SUBMISSIONS.put(savedAs, JSON.stringify(record, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });

    const rawEmail = buildEmail(submission, savedAs, config.fromHeader, config.toHeader);
    const emailMessage = new EmailMessage(config.fromAddress, config.toAddress, rawEmail);

    await context.env.EMAIL.send(emailMessage);

    return json(
      {
        ok: true,
        message: "Thanks. Your inquiry was sent successfully.",
        savedAs,
      },
      200,
      corsHeaders(origin)
    );
  } catch (error) {
    console.error("Contact submission failed", error);
    return json(
      {
        ok: false,
        error: "The contact form could not be sent right now.",
      },
      500,
      corsHeaders(origin)
    );
  }
}
