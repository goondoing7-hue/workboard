const { handler } = require("../../server/googleCalendarSession.cjs");

exports.handler = async (event) => {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  const query = event.rawQuery || new URLSearchParams(event.queryStringParameters || {}).toString();
  const req = {
    method: event.httpMethod,
    url: `/api/google-calendar-auth${query ? `?${query}` : ""}`,
    headers,
    body: event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : event.body,
  };
  const result = { statusCode: 500, headers: {}, body: "" };
  const res = {
    setHeader(key, value) { result.headers[key] = value; },
    writeHead(status, nextHeaders) { result.statusCode = status; Object.assign(result.headers, nextHeaders); return res; },
    end(body) { result.body = body || ""; },
  };
  await handler(req, res);
  return result;
};
