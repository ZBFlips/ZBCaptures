const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(JSON_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export function errorResponse(status, message, extra = {}) {
  return json(
    {
      error: message,
      ...extra,
    },
    { status }
  );
}

export function empty(status = 204, headers = {}) {
  return new Response(null, {
    status,
    headers,
  });
}

export async function readJson(request) {
  const text = await request.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The request body was not valid JSON.");
  }
}

export function noStore(headers = {}) {
  return {
    "cache-control": "no-store",
    ...headers,
  };
}
