const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const REPLACEMENT = "�";

/** @param {number} codePoint */
const decodeCodePoint = codePoint =>
  codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ? REPLACEMENT
    : String.fromCodePoint(codePoint);

/** @param {string} entity @param {string} body */
function decodeEntity(entity, body) {
  if (body[0] !== "#") return NAMED_ENTITIES[/** @type {keyof typeof NAMED_ENTITIES} */ (body.toLowerCase())] ?? entity;
  const hex = body[1] === "x" || body[1] === "X";
  return decodeCodePoint(Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10));
}

/**
 * Readable text from an HTML body: tags removed, block boundaries kept as line breaks, entities decoded, whitespace collapsed.
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  return html
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|h[1-6]|blockquote|table)\s*>/gi, "\n\n")
    .replace(/<\/(?:div|li|tr)\s*>/gi, "\n")
    .replace(/<\/?[a-z!][^>]*>/gi, "")
    .replace(/&(#x[0-9a-f]{1,8}|#[0-9]{1,10}|[a-z]{2,8});/gi, decodeEntity)
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map(line => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
