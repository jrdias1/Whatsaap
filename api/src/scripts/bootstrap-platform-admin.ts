import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../security/secret-crypto.js';

const prisma = new PrismaClient();
const slug = process.env.PLATFORM_TENANT_SLUG?.trim().toLowerCase() || 'essencial-platform';
const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.PLATFORM_ADMIN_NAME?.trim();
const password = process.env.PLATFORM_ADMIN_PASSWORD;
const totpSecret = base32(randomBytes(20));

try {
  if (!email || !name || !password || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Configure PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME e senha com no mínimo 8 caracteres e até 72 bytes no ambiente local seguro.');
  if (!process.env.INTEGRATION_ENCRYPTION_KEY) throw new Error('INTEGRATION_ENCRYPTION_KEY é obrigatória para proteger o segredo MFA.');
  const existing = await prisma.user.findUnique({ where: { email }, include: { platformAdminIdentity: true } });
  if (existing) {
    if (existing.platformAdminIdentity) { console.info(`Identidade de plataforma já autorizada para ${email}; nenhum dado foi alterado.`); process.exitCode = 0; }
    else throw new Error('O e-mail já pertence a uma conta existente. O bootstrap não altera nem promove contas existentes.');
  } else {
    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: 'Essencial Comunicação — Plataforma', slug, status: 'ACTIVE' } });
      const unit = await tx.unit.create({ data: { tenantId: tenant.id, name: 'Administração da Plataforma', slug: 'plataforma' } });
      const user = await tx.user.create({ data: { email, displayName: name, passwordHash: await bcrypt.hash(password, 12) } });
      const membership = await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: UserRole.PLATFORM_SUPERADMIN, status: 'ACTIVE' } });
      await tx.unitMembership.create({ data: { tenantId: tenant.id, membershipId: membership.id, unitId: unit.id } });
      await tx.platformAdminIdentity.create({ data: { userId: user.id, totpSecretEncrypted: encryptSecret(totpSecret) } });
      await tx.auditEvent.create({ data: { tenantId: tenant.id, actorUserId: user.id, action: 'PLATFORM_ADMIN_BOOTSTRAPPED', entityType: 'PlatformAdminIdentity', entityId: user.id, metadata: { loginTenantSlug: slug } } });
    });
    const provisioningUri = `otpauth://totp/${encodeURIComponent(`Essencial Comunicação:${email}`)}?secret=${totpSecret}&issuer=${encodeURIComponent('Essencial Comunicação')}&algorithm=SHA1&digits=6&period=30`;
    console.info(`Identidade Superadmin criada: ${email}. Use o slug ${slug} na tela de login.`);
    console.info(`Configure seu aplicativo autenticador agora. O segredo MFA é exibido uma vez: ${totpSecret}`);
    console.info(`URI de configuração: ${provisioningUri}`);
  }
} finally { await prisma.$disconnect(); }

function base32(bytes: Buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '', result = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  for (let index = 0; index < bits.length; index += 5) result += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)]!;
  return result;
}
