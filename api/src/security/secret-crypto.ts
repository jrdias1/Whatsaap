import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw || !/^[a-f\d]{64}$/i.test(raw)) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY deve conter 32 bytes em hexadecimal.');
  }
  return Buffer.from(raw, 'hex');
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

export function decryptSecret(value: string): string {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Segredo criptografado inválido.');
  const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Segredo criptografado inválido.');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
