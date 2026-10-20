import { createHmac, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = '';
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function verifyTotp(secret: string, token: unknown, now = Date.now()): bigint | null {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) return null;
  let key: Buffer;
  try { key = decodeBase32(secret); } catch { return null; }
  const current = BigInt(Math.floor(now / 30_000));
  const received = Buffer.from(token, 'ascii');
  for (const offset of [-1n, 0n, 1n]) {
    const step = current + offset;
    if (step < 0n) continue;
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(step);
    const digest = createHmac('sha1', key).update(counter).digest();
    const index = digest[digest.length - 1]! & 0x0f;
    const binary = ((digest[index]! & 0x7f) << 24) | (digest[index + 1]! << 16) | (digest[index + 2]! << 8) | digest[index + 3]!;
    const expected = Buffer.from(String(binary % 1_000_000).padStart(6, '0'), 'ascii');
    if (timingSafeEqual(received, expected)) return step;
  }
  return null;
}
