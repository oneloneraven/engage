/** @param {string} s */
export function normaliseMessage(s) {
  return s.replace(/\r\n/g, "\n").trim();
}

/** @param {string} s */
export function codePointLength(s) {
  let count = 0;
  for (const _ of s) count++;
  return count;
}

/** @param {string} s */
export function longestBacktickRun(s) {
  let longest = 0;
  for (const run of s.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}
