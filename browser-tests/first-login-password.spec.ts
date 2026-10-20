import { test, expect, type Page } from './fixtures.js'
import { PrismaClient, UserRole } from '../api/node_modules/@prisma/client/index.js'
import * as bcrypt from '../api/node_modules/bcrypt/bcrypt.js'
import { createHmac, randomBytes } from 'node:crypto'
import { encryptSecret } from '../api/src/security/secret-crypto.js'
import { decodeBase32 } from '../api/src/auth/totp.js'

const db = new PrismaClient()
const suffix = randomBytes(5).toString('hex')
const clinicName = `Senha inicial ${suffix}`
const clinicSlug = `first-login-${suffix}`
const clinicAdminEmail = `clinic-admin-${suffix}@example.test`
const clinicAdminPassword = 'Clinic-admin-browser-2026!'
const tempPassword = 'Temporary-browser-2026!'
const finalPassword = 'Final-browser-password-2026!'
const managerEmail = `manager-${suffix}@example.test`
const managerTempPassword = 'Manager-temporary-2026!'
const managerFinalPassword = 'Manager-final-password-2026!'
const platformEmail = `platform-admin-${suffix}@example.test`
const platformPassword = 'Platform-browser-password-2026!'
const clinicNewAdminEmail = `clinic-new-admin-${suffix}@example.test`
const clinicNewAdminPassword = 'Clinic-first-password-2026!'
const mfaSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
let clinicId = ''
let unitId = ''
let planId = ''
let platformTenantId = ''
let createdPlatformTenant = false

test.beforeAll(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = 'd'.repeat(64)
  const plan = await db.plan.create({ data: { code: `FIRST-${suffix}`.toUpperCase(), name: 'Plano fictício', priceCents: 0, patientLimit: 25, messageLimitPerCycle: 100, userLimit: 10, unitLimit: 3, connectionLimit: 2, activeAutomationLimit: 3, campaignLimitPerCycle: 5 } })
  planId = plan.id
  const tenant = await db.tenant.create({ data: { name: clinicName, slug: clinicSlug, status: 'TRIAL' } })
  clinicId = tenant.id
  const unit = await db.unit.create({ data: { tenantId: clinicId, name: 'Unidade autorizada', slug: `unit-${suffix}` } })
  unitId = unit.id
  await db.subscription.create({ data: { tenantId: clinicId, planId, status: 'TRIAL', cycleStartsAt: new Date(Date.now() - 60_000), cycleEndsAt: new Date(Date.now() + 30 * 86400000) } })
  const admin = await db.user.create({ data: { email: clinicAdminEmail, displayName: 'Administradora de teste', passwordHash: await bcrypt.hash(clinicAdminPassword, 4) } })
  const membership = await db.membership.create({ data: { tenantId: clinicId, userId: admin.id, role: UserRole.TENANT_ADMIN, status: 'ACTIVE' } })
  await db.unitMembership.create({ data: { tenantId: clinicId, membershipId: membership.id, unitId } })

  let platformTenant = await db.tenant.findUnique({ where: { slug: 'essencial-platform' }, select: { id: true } })
  if (!platformTenant) {
    platformTenant = await db.tenant.create({ data: { name: `Plataforma de teste ${suffix}`, slug: 'essencial-platform', status: 'ACTIVE' } })
    createdPlatformTenant = true
  }
  platformTenantId = platformTenant.id
})

test.afterAll(async () => {
  try {
    if (clinicId) await db.tenant.deleteMany({ where: { id: clinicId } })
    await db.user.deleteMany({ where: { email: { in: [clinicAdminEmail, managerEmail, platformEmail, clinicNewAdminEmail] } } })
    if (createdPlatformTenant && platformTenantId) await db.tenant.deleteMany({ where: { id: platformTenantId } })
    if (planId) await db.plan.deleteMany({ where: { id: planId } })
  } finally { await db.$disconnect() }
})

test('admin cria operador e gerente; primeiro acesso é obrigatório em desktop e mobile', async ({ page }) => {
  await signIn(page, clinicAdminEmail, clinicSlug, clinicAdminPassword)
  await page.getByRole('button', { name: 'Equipe', exact: true }).click()
  await createClinicMember(page, 'Operador de teste', `operator-${suffix}@example.test`, 'Operador', tempPassword)
  await expect(page.locator('.phase10-secret')).toContainText('primeiro acesso')
  await page.getByRole('button', { name: 'Sair', exact: true }).click()

  await signIn(page, `operator-${suffix}@example.test`, clinicSlug, tempPassword)
  await expect(page.getByRole('heading', { name: 'Defina sua nova senha' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continuar com a senha inicial' })).toHaveCount(0)
  await page.goto('/?view=Agenda')
  await expect(page.getByRole('heading', { name: 'Defina sua nova senha' })).toBeVisible()
  const blockedStatus = await page.evaluate(async (apiUrl) => {
    const token = sessionStorage.getItem('clinic_access')
    const response = await fetch(`${apiUrl}/api/appointments`, { headers: { Authorization: `Bearer ${token}` } })
    return response.status
  }, process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3002')
  expect(blockedStatus).toBe(403)
  expect(await page.evaluate(() => Object.keys(sessionStorage))).not.toContain('password')
  await page.locator('#temporary-password').fill(tempPassword)
  await page.locator('#new-password').fill(finalPassword)
  await page.locator('#confirm-password').fill('Not-the-same-password-2026!')
  await page.getByRole('button', { name: 'Salvar nova senha e continuar' }).click()
  await expect(page.getByRole('alert')).toContainText(/coincid/)
  await page.locator('#confirm-password').fill(finalPassword)
  await page.getByRole('button', { name: 'Salvar nova senha e continuar' }).click()
  await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toBeVisible()
  const optionValues = await page.getByLabel('Unidade').locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
  expect(optionValues).toEqual([unitId])
  await page.getByRole('button', { name: 'Sair', exact: true }).click()

  await signIn(page, clinicAdminEmail, clinicSlug, clinicAdminPassword)
  await page.getByRole('button', { name: 'Equipe', exact: true }).click()
  await createClinicMember(page, 'Gerente de teste', managerEmail, 'Gerente de unidade', managerTempPassword)
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, managerEmail, clinicSlug, managerTempPassword)
  await expect(page.getByRole('heading', { name: 'Defina sua nova senha' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.locator('#temporary-password').fill(managerTempPassword)
  await page.locator('#new-password').fill(managerFinalPassword)
  await page.locator('#confirm-password').fill(managerFinalPassword)
  await page.getByRole('button', { name: 'Salvar nova senha e continuar' }).click()
  await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toBeVisible()
})

test('Superadmin com MFA cria administrador clínico e o sistema exige a senha definitiva', async ({ page }) => {
  const platformUser = await db.user.create({ data: { email: platformEmail, displayName: 'Superadmin de teste', passwordHash: await bcrypt.hash(platformPassword, 4) } })
  await db.membership.create({ data: { tenantId: platformTenantId, userId: platformUser.id, role: UserRole.PLATFORM_SUPERADMIN, status: 'ACTIVE' } })
  await db.platformAdminIdentity.create({ data: { userId: platformUser.id, totpSecretEncrypted: encryptSecret(mfaSecret) } })
  await page.goto('/')
  await page.getByLabel('E-mail').fill(platformEmail)
  await page.locator('input[name="tenantSlug"]').fill('essencial-platform')
  await page.getByLabel('Senha').fill(platformPassword)
  await page.locator('input[name="otp"]').fill(totpAt(mfaSecret))
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible()
  await page.locator('.platform-nav button').nth(1).click()
  await page.locator('.platform-tenant-list article').filter({ hasText: clinicSlug }).getByRole('button', { name: 'Administrar', exact: true }).click()
  await page.getByRole('button', { name: 'Equipe', exact: true }).click()
  const createAdminCard = page.locator('.platform-detail-content > .platform-card').first()
  const createAdminForm = createAdminCard.locator('form').first()
  await createAdminCard.locator('input[autocomplete="name"]').fill('Administrador criado pelo Superadmin')
  await createAdminCard.locator('input[type="email"]').fill(clinicNewAdminEmail)
  await createAdminCard.locator('select').selectOption('TENANT_ADMIN')
  await createAdminForm.locator('input[type="password"]').nth(0).fill(clinicNewAdminPassword)
  await createAdminForm.locator('input[type="password"]').nth(1).fill(clinicNewAdminPassword)
  await createAdminForm.locator('input[type="checkbox"]').check()
  await createAdminForm.locator('button').click()
  await expect(page.getByText(/definir uma nova senha antes de continuar/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await signIn(page, clinicNewAdminEmail, clinicSlug, clinicNewAdminPassword)
  await expect(page.getByRole('heading', { name: 'Defina sua nova senha' })).toBeVisible()
  const blockedStatus = await page.evaluate(async (apiUrl) => {
    const token = sessionStorage.getItem('clinic_access')
    const response = await fetch(`${apiUrl}/api/units`, { headers: { Authorization: `Bearer ${token}` } })
    return response.status
  }, process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3002')
  expect(blockedStatus).toBe(403)
  await page.locator('#temporary-password').fill(clinicNewAdminPassword)
  await page.locator('#new-password').fill('Clinic-admin-final-password-2026!')
  await page.locator('#confirm-password').fill('Clinic-admin-final-password-2026!')
  await page.getByRole('button', { name: 'Salvar nova senha e continuar' }).click()
  await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Plataforma', exact: true })).toHaveCount(0)
})

async function createClinicMember(page: Page, name: string, email: string, role: string, password: string) {
  await page.getByLabel('Nome', { exact: true }).fill(name)
  await page.getByLabel('Login (e-mail)').fill(email)
  await page.locator('.phase10-form > label').filter({ hasText: 'Papel' }).locator('select').selectOption(role === 'Operador' ? 'OPERATOR' : 'UNIT_MANAGER')
  const createForm = page.locator('form.phase10-form').first()
  await createForm.locator('input[type="password"]').nth(0).fill(password)
  await createForm.locator('input[type="password"]').nth(1).fill(password)
  await page.locator('.phase10-check').filter({ hasText: 'Unidade autorizada' }).getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Criar acesso', exact: true }).click()
  await expect(page.locator('.phase10-secret')).toContainText(email)
}

async function signIn(page: Page, email: string, slug: string, password: string) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email)
  await page.locator('input[name="tenantSlug"]').fill(slug)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

function totpAt(secret: string, now = Date.now()) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest(); const index = digest[digest.length - 1]! & 15
  const binary = ((digest[index]! & 127) << 24) | (digest[index + 1]! << 16) | (digest[index + 2]! << 8) | digest[index + 3]!
  return String(binary % 1_000_000).padStart(6, '0')
}

