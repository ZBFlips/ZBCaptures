import { EmailMessage } from "cloudflare:email";

interface Env {
  CONTACT_SUBMISSIONS: R2Bucket;
  EMAIL: SendEmail;
  NOTIFICATION_FROM: string;
  NOTIFICATION_TO: string;
}

type Submission = {
  name: string;
  email: string;
  message: string;
  source: string;
  page: string;
  submittedAt: string;
  userAgent: string;
  referrer: string;
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function normalizeField(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function buildKey(timestamp: string, id: string) {
  const safeStamp = timestamp.replace(/[:.]/g, "-");
  return `submissions/${timestamp.slice(0, 10)}/${safeStamp}-${id}.json`;
}

function buildEmail(submission: Submission, savedAs: string, from: string, to: string) {
  const subject = `New contact form submission from ${submission.name || "website visitor"}`;
  const body = [
    `New contact form submission`,
    ``,
    `Name: ${submission.name || "-"}`,
    `Email: ${submission.email || "-"}`,
    `Message:`,
    submission.message || "-",
    ``,
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
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `X-Submission-Id: ${savedAs}`,
    ``,
    body,
  ]
    .filter(Boolean)
    .join("\r\n");
}

async function parseSubmission(request: Request): Promise<Submission> {
  const contentType = request.headers.get("content-type") || "";
  let raw: Record<string, unknown> = {};

  if (contentType.includes("application/json")) {
    raw = (await request.json()) as Record<string, unknown>;
  } else {
    const formData = await request.formData();
    raw = Object.fromEntries(formData.entries()) as Record<string, unknown>;
  }

  const now = new Date().toISOString();

  return {
    name: normalizeField(raw.name),
    email: normalizeField(raw.email),
    message: normalizeField(raw.message),
    source: normalizeField(raw.source) || "ZB Captures website",
    page: normalizeField(raw.page),
    submittedAt: normalizeField(raw.submittedAt) || now,
    userAgent: request.headers.get("user-agent") || "",
    referrer: request.headers.get("referer") || "",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return Response.json(
        { ok: false, error: "Method not allowed" },
        { status: 405, headers: corsHeaders() }
      );
    }

    const submission = await parseSubmission(request);

    if (!submission.name || !submission.email || !submission.message) {
      return Response.json(
        { ok: false, error: "Name, email, and message are required." },
        { status: 400, headers: corsHeaders() }
      );
    }

    const id = crypto.randomUUID();
    const savedAs = buildKey(submission.submittedAt, id);
    const record = {
      id,
      ...submission,
    };

    await env.CONTACT_SUBMISSIONS.put(savedAs, JSON.stringify(record, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });

    const rawEmail = buildEmail(submission, savedAs, env.NOTIFICATION_FROM, env.NOTIFICATION_TO);

    try {
      await env.EMAIL.send(new EmailMessage(env.NOTIFICATION_FROM, env.NOTIFICATION_TO, rawEmail));
    } catch (error) {
      console.error("Failed to send notification email:", error);
      return Response.json(
        {
          ok: false,
          error: "Saved the submission, but the notification email could not be sent.",
          savedAs,
        },
        { status: 502, headers: corsHeaders() }
      );
    }

    return Response.json(
      {
        ok: true,
        message: "Submission saved and notification emailed.",
        savedAs,
      },
      { status: 200, headers: corsHeaders() }
    );
  },
};
