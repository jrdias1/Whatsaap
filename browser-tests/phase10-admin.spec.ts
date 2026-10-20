import { test, expect, type Page, isolateTestClient } from './fixtures.js'
import { PrismaClient, UserRole } from '../api/node_modules/@prisma/client/index.js'
import * as bcrypt from '../api/node_modules/bcrypt/bcrypt.js'
import { randomBytes } from 'node:crypto'

const db = new PrismaClient()
const suffix = randomBytes(5).toString('hex')
const tenantSlug = `phase10-clinic-${suffix}`
const otherTenantSlug = `phase10-other-${suffix}`
const adminEmail = `admin-${suffix}@example.test`
const operatorEmail = `operator-${suffix}@example.test`
const otherAdminEmail = `other-admin-${suffix}@example.test`
const adminPassword = 'Phase10-browser-admin-password-2026!'
const operatorPassword = 'Phase10-browser-operator-password-2026!'
const recoveredPassword = 'Phase10-browser-recovered-password-2026!'
let patientId = ''

test('administra equipe, revoga sessoes, recupera acesso, configura tema e acompanha privacidade', async ({ page, browser }) => {
  const tenant = await db.tenant.create({ data: { name: `Fase 10 ${suffix}`, slug: tenantSlug, status: 'TRIAL' } })
  const plan = await db.plan.create({ data: { code: `P10-${suffix}`, name: 'Plano browser Fase 10', priceCents: 0, patientLimit: 25, messageLimitPerCycle: 50, userLimit: 5, unitLimit: 3, connectionLimit: 2, activeAutomationLimit: 3, campaignLimitPerCycle: 3 } })
  await db.subscription.create({ data: { tenantId: tenant.id, planId: plan.id, status: 'TRIAL', cycleStartsAt: new Date(Date.now() - 60_000), cycleEndsAt: new Date(Date.now() + 30 * 86_400_000) } })
  const unitA = await db.unit.create({ data: { tenantId: tenant.id, name: 'Unidade Norte', slug: 'norte' } })
  const unitB = await db.unit.create({ data: { tenantId: tenant.id, name: 'Unidade Sul', slug: 'sul' } })
  const admin = await db.user.create({ data: { email: adminEmail, displayName: 'Admin Fase Dez', passwordHash: await bcrypt.hash(adminPassword, 4) } })
  const adminMembership = await db.membership.create({ data: { tenantId: tenant.id, userId: admin.id, role: UserRole.TENANT_ADMIN, status: 'ACTIVE' } })
  await db.unitMembership.createMany({ data: [unitA.id, unitB.id].map((unitId) => ({ tenantId: tenant.id, membershipId: adminMembership.id, unitId })) })
  patientId = (await db.patient.create({ data: { tenantId: tenant.id, unitId: unitA.id, fullName: 'Paciente Ficticio Fase Dez' } })).id

  const otherTenant = await db.tenant.create({ data: { name: `Outra Fase 10 ${suffix}`, slug: otherTenantSlug, status: 'TRIAL' } })
  const otherUnit = await db.unit.create({ data: { tenantId: otherTenant.id, name: 'Unidade Outra', slug: 'outra' } })
  const otherAdmin = await db.user.create({ data: { email: otherAdminEmail, displayName: 'Outro Admin', passwordHash: await bcrypt.hash(adminPassword, 4) } })
  const otherMembership = await db.membership.create({ data: { tenantId: otherTenant.id, userId: otherAdmin.id, role: UserRole.TENANT_ADMIN, status: 'ACTIVE' } })
  await db.unitMembership.create({ data: { tenantId: otherTenant.id, membershipId: otherMembership.id, unitId: otherUnit.id } })

  try {
    await signIn(page, adminEmail, tenantSlug, adminPassword)
    await expect(page.getByRole('button', { name: 'Plataforma', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Equipe', exact: true }).click()
    await page.getByLabel('Nome', { exact: true }).fill('Operador de Teste')
    await page.getByLabel('Login (e-mail)', { exact: true }).fill(operatorEmail)
    const accessForm = page.locator('form.phase10-form').first()
    await accessForm.locator('input[type="password"]').nth(0).fill(operatorPassword)
    await accessForm.locator('input[type="password"]').nth(1).fill(operatorPassword)
    await page.locator('.phase10-check').filter({ hasText: 'Unidade Norte' }).getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Criar acesso', exact: true }).click()
    await expect(page.locator('.phase10-secret')).toContainText(operatorEmail)

    const operatorContext = await browser.newContext()
    await isolateTestClient(operatorContext, 'phase10-admin.spec.ts')
    const operatorPage = await operatorContext.newPage()
    await signIn(operatorPage, operatorEmail, tenantSlug, operatorPassword)
    await expect(operatorPage.getByRole('heading', { name: 'Defina sua nova senha' })).toBeVisible()
    await operatorPage.locator('#temporary-password').fill(operatorPassword)
    await operatorPage.locator('#new-password').fill('Operator-initial-final-2026!')
    await operatorPage.locator('#confirm-password').fill('Operator-initial-final-2026!')
    await operatorPage.getByRole('button', { name: 'Salvar nova senha e continuar' }).click()
    await expect(operatorPage.getByRole('button', { name: 'Agenda', exact: true })).toBeVisible()
    await expect(operatorPage.getByRole('button', { name: 'Equipe', exact: true })).toHaveCount(0)
    await expect(operatorPage.getByRole('button', { name: 'Privacidade', exact: true })).toHaveCount(0)
    await expect(operatorPage.getByRole('button', { name: 'Plataforma', exact: true })).toHaveCount(0)

    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Equipe', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Equipe', exact: true }).click()
    await page.screenshot({ path: 'docs/evidencias/fase10-equipe-desktop.png', fullPage: true })
    await page.screenshot({ path: 'docs/evidencias/fase11-equipe-desktop.png', fullPage: true })
    await page.locator('.phase10-filters select').nth(1).selectOption(unitA.id)
    const operatorRow = page.getByRole('row').filter({ hasText: operatorEmail })
    await expect(operatorRow).toBeVisible()
    await operatorRow.getByRole('button', { name: 'Unidades' }).click()
    const unitEditor = page.locator('.phase10-unit-editor').filter({ hasText: 'Unidade Sul' })
    await unitEditor.getByLabel('Unidade Sul').check()
    await unitEditor.getByRole('button', { name: 'Salvar unidades' }).click()
    await expect(page.getByRole('row').filter({ hasText: operatorEmail })).toContainText('Unidade Sul')
    await page.getByRole('row').filter({ hasText: operatorEmail }).getByRole('button', { name: 'Histórico' }).click()
    await expect(page.locator('.phase10-history')).toContainText('USER_MEMBERSHIP_UPDATED')

    await page.getByRole('row').filter({ hasText: operatorEmail }).getByRole('button', { name: 'Revogar sessões' }).click()
    const beforeRecovery = await operatorPage.evaluate(async (apiUrl) => {
      const token = sessionStorage.getItem('clinic_access')
      const response = await fetch(`${apiUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      return response.status
    }, process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3002')
    expect(beforeRecovery).toBe(401)

    const passwordReset = operatorRow.locator('.phase10-password-reset')
    await passwordReset.locator('summary').click()
    await passwordReset.locator('input[name="password"]').fill(recoveredPassword)
    await passwordReset.locator('input[name="confirmPassword"]').fill(recoveredPassword)
    page.once('dialog', async (dialog) => { await dialog.accept() })
    await passwordReset.getByRole('button', { name: 'Salvar nova senha' }).click()
    await expect(page.locator('.phase10-secret')).toContainText(recoveredPassword)

    await page.goto('/')
    await signIn(operatorPage, operatorEmail, tenantSlug, recoveredPassword)
    await expect(operatorPage.getByRole('heading', { name: 'Defina sua nova senha' })).toBeVisible()
    await operatorPage.locator('#temporary-password').fill(recoveredPassword)
    await operatorPage.locator('#new-password').fill('Operator-recovered-final-2026!')
    await operatorPage.locator('#confirm-password').fill('Operator-recovered-final-2026!')
    await operatorPage.getByRole('button', { name: 'Salvar nova senha e continuar' }).click()
    await expect(operatorPage.getByRole('button', { name: 'Privacidade', exact: true })).toHaveCount(0)

    await page.goto('/')
    await page.getByRole('button', { name: 'Configurações', exact: true }).click()
    await expect(page.locator('.phase10-steps')).toContainText('Pendente')
    await page.screenshot({ path: 'docs/evidencias/fase11-configuracoes-desktop.png', fullPage: true })
    await page.getByLabel('Nome de exibição').fill('Clínica Teste Verde')
    await page.getByLabel('E-mail de contato').fill(adminEmail)
    await page.getByLabel('Cor de destaque (hexadecimal)').fill('#064E3B')
    await page.getByRole('button', { name: 'Salvar dados da clínica' }).click()
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tenant-accent').trim())).toBe('#064E3B')
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
    await expect(page.locator('.phase10-steps')).toContainText('Concluída com dados salvos')

    await page.getByRole('button', { name: 'Privacidade', exact: true }).click()
    await page.locator('.phase10-form select').nth(0).selectOption(patientId)
    await page.locator('.phase10-form select').nth(1).selectOption('ERASURE')
    await page.getByLabel('Descrição do pedido').fill('Solicito análise do pedido de exclusão dos dados.')
    await page.getByRole('button', { name: 'Registrar e auditar' }).click()
    await expect(page.locator('.phase10-privacy-item')).toContainText('Paciente Ficticio Fase Dez')
    expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).active).toBe(true)

    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await signIn(mobilePage, adminEmail, tenantSlug, adminPassword)
    await mobilePage.getByRole('button', { name: 'Equipe', exact: true }).click()
    expect(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await mobilePage.screenshot({ path: 'docs/evidencias/fase10-equipe-mobile.png', fullPage: true })
    await mobilePage.screenshot({ path: 'docs/evidencias/fase11-equipe-mobile.png', fullPage: true })
    await mobilePage.close()

    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    await signIn(otherPage, otherAdminEmail, otherTenantSlug, adminPassword)
    expect(await otherPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tenant-accent').trim())).not.toBe('#064E3B')
    await expect(otherPage.getByRole('button', { name: 'Plataforma', exact: true })).toHaveCount(0)
    await operatorContext.close()
    await otherContext.close()
  } finally {
    await db.$disconnect()
  }
})

async function signIn(page: Page, email: string, slug: string, password: string) {
  await page.goto('/')
  const emailInput = page.getByLabel('E-mail').first()
  const agendaButton = page.getByRole('button', { name: 'Agenda', exact: true })
  const firstLoginHeading = page.getByRole('heading', { name: 'Defina sua nova senha' })
  await expect(emailInput.or(agendaButton).or(firstLoginHeading).first()).toBeVisible({ timeout: 15_000 })
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(email)
    await page.getByLabel(/Clínica \(slug\)/).fill(slug)
    await page.getByLabel('Senha').fill(password)
    await page.getByRole('button', { name: 'Entrar' }).click()
  }
  await expect(agendaButton.or(firstLoginHeading).first()).toBeVisible({ timeout: 15_000 })
}
