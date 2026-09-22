const text = (value) => typeof value === "string" ? value.trim() : "";
const PLACES = new Map(["어우리", "마음", "공감", "집단", "모래놀이", "meet"].map((place) => [place.toLowerCase(), place]));
const GENERIC_PLACES = new Set(["센터", "상담센터", "청소년상담복지센터", "춘천시청소년상담복지센터"]);
const SEPARATORS = "\\s·ㆍ,/:;|_\\-–—()（）\\[\\]";
const remotePattern = new RegExp(`(?:^|[${SEPARATORS}])비대면(?=$|[${SEPARATORS}])`);

function cleanLabel(value) {
  return text(value)
    .replace(/^(?:\[|\(|（)?(?:구글(?:\s*캘린더)?|Google(?:\s*Calendar)?)(?:\]|\)|）)?(?=\s|[·ㆍ:|\-–—]|$)[\s·ㆍ:|\-–—]*/i, "")
    .replace(/[([（]\s*(?:정기성|개인상담|비대면)\s*[)\]）]/g, " ")
    .replace(new RegExp(`(^|[${SEPARATORS}])(?:개인상담|비대면)(?=$|[${SEPARATORS}])`, "g"), "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s·ㆍ,/:;|\-–—]+|[\s·ㆍ,/:;|\-–—]+$/g, "")
    .trim();
}

function parsedPlace(prefix) {
  const tokens = cleanLabel(prefix).split(new RegExp(`[${SEPARATORS}]+`));
  return tokens.map((token) => PLACES.get(token.toLowerCase())).find(Boolean) || "";
}

/** Display-only parsing. A name in a title never creates or associates a client. */
export function counselingPresentation(reservation, client) {
  const rawTitle = text(reservation?.externalTitle) || text(reservation?.title);
  const delimiter = rawTitle.indexOf("_");
  const prefix = delimiter < 0 ? rawTitle : rawTitle.slice(0, delimiter);
  const parsedName = delimiter < 0 ? "" : cleanLabel(rawTitle.slice(delimiter + 1));
  const name = text(client?.name) || parsedName;
  const room = parsedPlace(prefix);
  const explicitPlace = text(reservation?.place);
  const place = room && (!explicitPlace || GENERIC_PLACES.has(explicitPlace.replace(/\s+/g, "")))
    ? room : explicitPlace || room;
  return {
    title: name || cleanLabel(rawTitle) || "상담 일정",
    name,
    place,
    remote: remotePattern.test(rawTitle) || ["온라인", "전화", "비대면"].includes(text(reservation?.method)),
  };
}
