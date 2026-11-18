const ELLIPSIS = /…|\.\.\./;

/**
 * True when every non-empty segment between ellipses appears in the original, in order and without overlap.
 * @param {string} original
 * @param {string} excerpt
 * @returns {boolean}
 */
export function isFaithfulExcerpt(original, excerpt) {
  const segments = excerpt
    .split(ELLIPSIS)
    .map(segment => segment.trim())
    .filter(segment => segment !== "");
  if (segments.length === 0) return false;
  let cursor = 0;
  for (const segment of segments) {
    const at = original.indexOf(segment, cursor);
    if (at === -1) return false;
    cursor = at + segment.length;
  }
  return true;
}
