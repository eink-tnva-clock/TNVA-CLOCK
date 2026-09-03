/* JS mirror of tools/tnva-sign/activation_signing.py's ALPHABET -- must
 * stay byte-for-byte identical (used to decode the code from
 * sign_activation.py, see activation.js's redeemCliActivationCode()). Not
 * a Crockford/RFC4648 variant, this project's own table (32 symbols,
 * excludes 0/O/1/I to avoid misreads when read aloud or handwritten). */
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const INDEX = (() => {
  const map = new Map();
  for (let i = 0; i < ALPHABET.length; i++) map.set(ALPHABET[i], i);
  return map;
})();

/* Decodes a base32 string (this project's alphabet, 5 bits/symbol, no
 * padding character) back to bytes. Mirrors activation_codes.py's
 * encode_base32() exactly in reverse -- only ever called on strings whose
 * bit length (symbols * 5) is a whole multiple of 8, matching what the
 * encoder ever produces (tnva_activation_cli.py pads its 64-byte
 * signature to 65 bytes first specifically so this holds). */
export function decodeBase32(text) {
  const cleaned = String(text || '').toUpperCase().replace(/[\s-]/g, '');
  if (!cleaned) throw new Error('Mã trống');
  const totalBits = cleaned.length * 5;
  if (totalBits % 8 !== 0) {
    throw new Error('Độ dài mã không hợp lệ (không phải bội số byte nguyên)');
  }
  let bits = 0n;
  for (const ch of cleaned) {
    const value = INDEX.get(ch);
    if (value === undefined) throw new Error(`Ký tự không hợp lệ trong mã: "${ch}"`);
    bits = (bits << 5n) | BigInt(value);
  }
  const byteLength = totalBits / 8;
  const out = new Uint8Array(byteLength);
  for (let i = byteLength - 1; i >= 0; i--) {
    out[i] = Number(bits & 0xffn);
    bits >>= 8n;
  }
  return out;
}
