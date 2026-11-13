const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_BYTES = 10;

/** @returns {string} 26 characters: a millisecond timestamp, then 80 random bits, in Crockford base32. */
export function newId() {
  let time = Date.now();
  let timePart = "";
  for (let i = 0; i < TIME_CHARS; i++) {
    timePart = ALPHABET[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  let bits = 0n;
  for (const byte of crypto.getRandomValues(new Uint8Array(RANDOM_BYTES))) bits = (bits << 8n) | BigInt(byte);
  let randomPart = "";
  for (let i = 0; i < 16; i++) {
    randomPart = ALPHABET[Number(bits & 31n)] + randomPart;
    bits >>= 5n;
  }
  return timePart + randomPart;
}
