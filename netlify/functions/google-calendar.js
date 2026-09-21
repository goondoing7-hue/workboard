const { publicCalendarResponse } = require("../../server/googleCalendar.cjs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Allow: "GET" }, body: JSON.stringify({ error: "GET 요청만 지원합니다." }) };
  const query = event.rawQuery != null ? new URLSearchParams(event.rawQuery) : event.queryStringParameters || {};
  const result = await publicCalendarResponse(query);
  return { statusCode: result.status, headers: result.headers, body: JSON.stringify(result.body) };
};
