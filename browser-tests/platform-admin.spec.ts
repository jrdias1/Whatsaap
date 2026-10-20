import { test, expect, type Page } from './fixtures.js'
import { PrismaClient, UserRole } from '../api/node_modules/@prisma/client/index.js'
import * as bcrypt from '../api/node_modules/bcrypt/bcrypt.js'
import { randomBytes, createHmac } from 'node:crypto'
import { encryptSecret } from '../api/src/security/secret-crypto.js'
import { decodeBase32 } from '../api/src/auth/totp.js'

const db = new PrismaClient()
const suffix = randomBytes(5).toString('hex')
const platformSlug = 'essencial-platform'
const adminEmail = `platform-admin-${suffix}@example.test`
const adminPassword = 'Platform-browser-password-2026!'
const mfaSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const clinicAdminEmail = `first-admin-${suffix}@example.test`
const clinicPassword = 'Clinic-first-admin-password-2026!'
let platformTenantId = ''
let createdPlatformTenant = false
let planId = ''
const planCode = `PLATFORM-BROWSER-${suffix}`.toUpperCase()

test.beforeAll(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = 'd'.repeat(64)
  let tenant = await db.tenant.findUnique({ where: { slug: platformSlug }, select: { id: true } })
  if (!tenant) {
    tenant = await db.tenant.create({ data: { name: `Essencial plataforma ${suffix}`, slug: platformSlug, status: 'ACTIVE' } })
    createdPlatformTenant = true
    await db.unit.create({ data: { tenantId: tenant.id, name: 'Administração da Plataforma', slug: `admin-platform-${suffix}` } })
  }
  platformTenantId = tenant.id
  const user = await db.user.create({ data: { email: adminEmail, displayName: 'Superadmin local', passwordHash: await bcrypt.hash(adminPassword, 4) } })
  const membership = await db.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: UserRole.PLATFORM_SUPERADMIN, status: 'ACTIVE' } })
  await db.platformAdminIdentity.create({ data: { userId: user.id, totpSecretEncrypted: encryptSecret(mfaSecret) } })
  const plan = await db.plan.create({ data: { code: planCode, name: `Browser ${suffix}`, priceCents: 9700, patientLimit: 50, messageLimitPerCycle: 100, userLimit: 5, unitLimit: 2, connectionLimit: 1, activeAutomationLimit: 3, campaignLimitPerCycle: 3 } })
  planId = plan.id
})

test.afterAll(async () => {
  try {
    await db.tenant.deleteMany({ where: { slug: { startsWith: `clinic-${suffix}` } } })
    if (createdPlatformTenant && platformTenantId) await db.tenant.deleteMany({ where: { id: platformTenantId } })
    await db.user.deleteMany({ where: { email: { in: [adminEmail, clinicAdminEmail] } } })
    if (planId) await db.plan.deleteMany({ where: { id: planId } })
  } finally { await db.$disconnect() }
})

async function signInPlatform(page: Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(adminEmail)
  await page.getByLabel(/Clínica|Clinica/).fill(platformSlug)
  await page.getByLabel('Senha').fill(adminPassword)
  await page.locator('input[name="otp"]').fill(totpAt(mfaSecret, Date.now()))
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Painel', exact: true })).toBeVisible()
}

test('Superadmin provisiona clínica com senha inicial e o administrador conclui o primeiro acesso', async ({ page }) => {
  await signInPlatform(page)
  await page.screenshot({ path: 'docs/evidencias/fase11-superadmin-desktop.png', fullPage: true })
  for (const section of ['Planos', 'Assinaturas', 'WhatsApp e integrações', 'Uso e limites', 'Registros e auditoria', 'Pendências']) {
    await page.getByRole('button', { name: section, exact: true }).click()
    await expect(page.locator('h1')).toHaveText(section)
    await expect(page.getByLabel('Unidade')).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Clínicas', exact: true }).click()
  await page.getByRole('button', { name: /Provisionar clínica/ }).click()
  await page.getByLabel('Nome da clínica').fill(`Clínica de teste ${suffix}`)
  await page.getByLabel('Identificador único').fill(`clinic-${suffix}`)
  await page.getByLabel('Primeira unidade').fill('Unidade Inicial')
  await page.getByLabel('Administrador inicial').fill('Primeiro Administrador')
  await page.getByLabel('E-mail administrativo').fill(clinicAdminEmail)
  await page.getByLabel('Senha inicial').fill(clinicPassword)
  await page.getByLabel('Confirmar senha').fill(clinicPassword)
  await page.getByLabel('Plano inicial').selectOption(planCode)
  await page.getByLabel('Período inicial (dias)').fill('14')
  await page.getByRole('button', { name: 'Provisionar clínica' }).click()
  await expect(page.locator('.platform-callout')).toContainText(clinicAdminEmail)
  await expect(page.locator('.platform-callout')).toContainText(clinicPassword)
  await page.getByRole('button', { name: 'Sair' }).click()

  await page.goto('/')
  await page.getByLabel('E-mail').fill(clinicAdminEmail)
  await page.getByLabel(/Clínica|Clinica/).fill(`clinic-${suffix}`)
  await page.getByLabel('Senha').fill(clinicPassword)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Defina sua nova senha' })).toBeVisible()
  await page.locator('#temporary-password').fill(clinicPassword)
  await page.locator('#new-password').fill('Clinic-first-final-password-2026!')
  await page.locator('#confirm-password').fill('Clinic-first-final-password-2026!')
  await page.getByRole('button', { name: 'Salvar nova senha e continuar' }).click()
  await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toBeVisible()
  await page.screenshot({ path: 'docs/evidencias/fase11-primeiro-acesso-clinica-desktop.png', fullPage: true })
  await expect(page.getByLabel('Unidade')).toContainText('Unidade Inicial')
  await expect(page.getByRole('button', { name: 'Plataforma', exact: true })).toHaveCount(0)
})

function totpAt(secret: string, now: number) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest(), index = digest[digest.length - 1]! & 15
  const binary = ((digest[index]! & 127) << 24) | (digest[index + 1]! << 16) | (digest[index + 2]! << 8) | digest[index + 3]!
  return String(binary % 1_000_000).padStart(6, '0')
}
