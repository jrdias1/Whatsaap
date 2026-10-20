import { test, expect, type Page } from './fixtures.js'
import { PrismaClient, UserRole } from '../api/node_modules/@prisma/client/index.js'
import * as bcrypt from '../api/node_modules/bcrypt/bcrypt.js'
import { randomBytes, createHmac } from 'node:crypto'
import { encryptSecret } from '../api/src/security/secret-crypto.js'
import { decodeBase32 } from '../api/src/auth/totp.js'

const db = new PrismaClient()
const suffix = randomBytes(5).toString('hex')
const platformSlug = `visual-platform-${suffix}`
const clinicSlug = `visual-clinic-${suffix}`
const platformEmail = `visual-admin-${suffix}@example.test`
const clinicEmail = `visual-clinic-admin-${suffix}@example.test`
const apiBaseUrl = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3002'
const password = 'Visual-legibility-test-2026!'
const mfaSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
let platformTenantId = ''
let clinicTenantId = ''
let platformToken = ''
let clinicToken = ''
let duplicatePatientPhone = ''

test.beforeAll(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = 'd'.repeat(64)
  const platform = await db.tenant.create({ data: { name: `Plataforma visual ${suffix}`, slug: platformSlug, status: 'ACTIVE' } })
  platformTenantId = platform.id
  const platformUnit = await db.unit.create({ data: { tenantId: platform.id, name: 'Administração visual', slug: `platform-${suffix}` } })
  const platformUser = await db.user.create({ data: { email: platformEmail, displayName: 'Superadmin visual', passwordHash: await bcrypt.hash(password, 4) } })
  const platformMembership = await db.membership.create({ data: { tenantId: platform.id, userId: platformUser.id, role: UserRole.PLATFORM_SUPERADMIN, status: 'ACTIVE' } })
  await db.unitMembership.create({ data: { tenantId: platform.id, membershipId: platformMembership.id, unitId: platformUnit.id } })
  await db.platformAdminIdentity.create({ data: { userId: platformUser.id, totpSecretEncrypted: encryptSecret(mfaSecret) } })

  const clinic = await db.tenant.create({ data: { name: `Clínica Demonstração Visual ${suffix}`, slug: clinicSlug, status: 'ACTIVE' } })
  clinicTenantId = clinic.id
  const [unitA, unitB] = await Promise.all([
    db.unit.create({ data: { tenantId: clinic.id, name: 'Unidade Centro', slug: `centro-${suffix}` } }),
    db.unit.create({ data: { tenantId: clinic.id, name: 'Unidade Norte', slug: `norte-${suffix}` } }),
  ])
  const clinicUser = await db.user.create({ data: { email: clinicEmail, displayName: 'Administradora clínica', passwordHash: await bcrypt.hash(password, 4) } })
  const clinicMembership = await db.membership.create({ data: { tenantId: clinic.id, userId: clinicUser.id, role: UserRole.TENANT_ADMIN, status: 'ACTIVE' } })
  await db.unitMembership.createMany({ data: [unitA.id, unitB.id].map((unitId) => ({ tenantId: clinic.id, membershipId: clinicMembership.id, unitId })) })
  duplicatePatientPhone = `55119${Date.now().toString().slice(-8)}`
  await db.patient.create({ data: { tenantId: clinic.id, unitId: unitA.id, fullName: `Paciente fictício ${suffix}`, phone: duplicatePatientPhone } })

  const platformResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: platformEmail, tenantSlug: platformSlug, password, otp: totpAt(mfaSecret, Date.now()) }),
  })
  if (!platformResponse.ok) throw new Error(`Login local Superadmin falhou: HTTP ${platformResponse.status}`)
  platformToken = (await platformResponse.json() as { accessToken: string }).accessToken
  const clinicResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: clinicEmail, tenantSlug: clinicSlug, password }),
  })
  if (!clinicResponse.ok) throw new Error(`Login local da clínica falhou: HTTP ${clinicResponse.status}`)
  clinicToken = (await clinicResponse.json() as { accessToken: string }).accessToken
})

test.afterAll(async () => {
  try {
    if (platformTenantId) await db.tenant.deleteMany({ where: { id: platformTenantId } })
    if (clinicTenantId) await db.tenant.deleteMany({ where: { id: clinicTenantId } })
    await db.user.deleteMany({ where: { email: { in: [platformEmail, clinicEmail] } } })
  } finally { await db.$disconnect() }
})

async function useToken(page: Page, token: string) {
  await page.addInitScript((accessToken) => sessionStorage.setItem('clinic_access', accessToken), token)
  await page.goto('/')
}

test('visualiza páginas administrativas e clínicas em desktop, zoom e mobile', async ({ page }) => {
  test.setTimeout(120_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Entrar na plataforma' })).toBeVisible()
  await page.screenshot({ path: 'docs/evidencias/revisao-front-login-desktop.png', fullPage: true })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(geometry.content, `overflow horizontal no login (${width}px)`).toBeLessThanOrEqual(geometry.viewport + 1)
    await page.screenshot({ path: `docs/evidencias/revisao-front-login-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await useToken(page, platformToken)
  await expect(page.locator('.platform-shell')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Painel', exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).not.toBe('none')
  await page.screenshot({ path: 'docs/evidencias/fase11-legibilidade-superadmin-dashboard-desktop.png', fullPage: true })

  const platformNavItems = page.locator('.platform-nav button')
  const platformNavLabels = await platformNavItems.allTextContents()
  for (const label of platformNavLabels.map((item) => item.trim()).filter(Boolean)) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(250)
    const file = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: `docs/evidencias/revisao-front-plataforma-${file}-desktop.png` })
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
      expect(geometry.content, `overflow horizontal Superadmin ${label} (${width}px)`).toBeLessThanOrEqual(geometry.viewport + 1)
      await page.screenshot({ path: `docs/evidencias/revisao-front-plataforma-${file}-${width}.png` })
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
  }

  await page.getByRole('button', { name: 'Clínicas', exact: true }).click()
  const clinicRow = page.locator('.platform-tenant-list article').filter({ hasText: clinicSlug })
  await expect(clinicRow).toBeVisible()
  await clinicRow.getByRole('button', { name: 'Administrar' }).click()
  await expect(page.locator('.platform-detail-title')).toContainText(`Clínica Demonstração Visual ${suffix}`)
  await page.screenshot({ path: 'docs/evidencias/fase11-legibilidade-superadmin-clinica-desktop.png', fullPage: true })
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(geometry.content).toBeLessThanOrEqual(geometry.viewport + 1)
    await page.screenshot({ path: `docs/evidencias/qa48-superadmin-clinica-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const label of ['Assinatura', 'Limites e uso', 'Integrações', 'Pendências', 'Auditoria']) {
    await page.locator('.platform-tabs').getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(250)
    const file = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await page.screenshot({ path: `docs/evidencias/revisao-front-plataforma-clinica-${file}-desktop.png` })
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
      expect(geometry.content, `overflow horizontal Superadmin clínica ${label} (${width}px)`).toBeLessThanOrEqual(geometry.viewport + 1)
      await page.screenshot({ path: `docs/evidencias/revisao-front-plataforma-clinica-${file}-${width}.png` })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await page.getByRole('button', { name: 'Equipe', exact: true }).click()
  await expect(page.locator('.platform-team-member-list')).toBeVisible()
  await page.screenshot({ path: 'docs/evidencias/fase11-legibilidade-superadmin-equipe-desktop.png', fullPage: true })

  for (const zoom of [1.25, 1.5, 2]) {
    await page.setViewportSize({ width: Math.round(1440 / zoom), height: 900 })
    await expect(page.locator('.platform-detail-title')).toBeVisible()
    const geometry = await page.evaluate(() => {
      const sidebar = document.querySelector('.platform-sidebar')!
      const box = sidebar.getBoundingClientRect()
      return { viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth, sidebarRight: box.right }
    })
    expect(geometry.content).toBeLessThanOrEqual(geometry.viewport + 1)
    if (geometry.viewport <= 760) expect(geometry.sidebarRight).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `docs/evidencias/fase11-legibilidade-superadmin-clinica-zoom-${Math.round(zoom * 100)}.png`, fullPage: true })
  }

  const keySizes = await page.evaluate(() => ({
    tab: getComputedStyle(document.querySelector('.platform-tabs button')!).fontSize,
    label: getComputedStyle(document.querySelector('.platform-form label')!).fontSize,
  }))
  expect(parseFloat(keySizes.tab)).toBeGreaterThanOrEqual(14)
  expect(parseFloat(keySizes.label)).toBeGreaterThanOrEqual(14)
  const platformContrasts = await contrastSamples(page, [
    '.platform-page-heading p', '.platform-callout', '.platform-form label',
    '.platform-tabs button.active', '.platform-nav button.active',
  ])
  expect(platformContrasts.every((sample) => sample.ratio >= 4.5)).toBe(true)

  const clinicPage = await page.context().newPage()
  await clinicPage.setViewportSize({ width: 1440, height: 1000 })
  await useToken(clinicPage, clinicToken)
  await expect(clinicPage.getByRole('heading', { name: 'Painel', exact: true })).toBeVisible()
  await expect(clinicPage.locator('.clinic-metric-card').first()).toBeVisible()
  const clinicContrasts = await contrastSamples(clinicPage, [
    '.clinic-dashboard-heading p', '.clinic-metric-card > span', '.clinic-metric-card > small',
  ])
  expect(clinicContrasts.every((sample) => sample.ratio >= 4.5)).toBe(true)
  await clinicPage.screenshot({ path: 'docs/evidencias/fase11-legibilidade-dashboard-clinico-desktop.png', fullPage: true })
  for (const width of [1280, 768, 390, 320]) {
    await clinicPage.setViewportSize({ width, height: 900 })
    const geometry = await clinicPage.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(geometry.content).toBeLessThanOrEqual(geometry.viewport + 1)
    await clinicPage.screenshot({ path: `docs/evidencias/qa48-dashboard-clinico-${width}.png`, fullPage: true })
  }
  await clinicPage.setViewportSize({ width: 1440, height: 1000 })
  const pages = [
    { button: 'Agenda', heading: 'Agenda', file: 'agenda' },
    { button: 'Inbox', heading: 'Central de Atendimentos', file: 'atendimentos' },
    { button: 'Pacientes', heading: 'Pacientes', file: 'pacientes' },
    { button: 'Relatórios', heading: 'Relatórios', file: 'relatorios' },
    { button: 'Equipe', heading: 'Equipe', file: 'equipe' },
  ]
  for (const item of pages) {
    await clinicPage.getByRole('button', { name: item.button, exact: true }).click()
    if (item.file === 'atendimentos') await expect(clinicPage.locator('.inbox-grid')).toBeVisible()
    else await expect(clinicPage.locator('main h1, main h2').filter({ hasText: item.heading }).first()).toBeVisible()
    if (item.file === 'relatorios') await expect(clinicPage.locator('.reports-cards').first()).toBeVisible()
    if (item.file === 'pacientes') await expect(clinicPage.locator('.patient-table tbody tr').first()).toBeVisible()
    await clinicPage.screenshot({ path: `docs/evidencias/fase11-legibilidade-${item.file}-desktop.png`, fullPage: true })
    for (const width of [1280, 768, 390, 320]) {
      await clinicPage.setViewportSize({ width, height: 900 })
      const geometry = await clinicPage.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
      if (geometry.content > geometry.viewport + 1) console.log('Overflow:', item.file, width, await clinicPage.evaluate(() => ['.content','.patients-page','.patient-table-section','.patient-table-scroll','.patient-table'].map((selector) => { const element = document.querySelector<HTMLElement>(selector)!; return { selector, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX } })))
      await clinicPage.screenshot({ path: `docs/evidencias/qa48-${item.file}-${width}.png`, fullPage: true })
      expect(geometry.content, `overflow horizontal em ${item.file} (${width}px)`).toBeLessThanOrEqual(geometry.viewport + 1)
    }
    await clinicPage.setViewportSize({ width: 1440, height: 1000 })
    if (item.file === 'pacientes') {
      for (const width of [390, 320]) {
        await clinicPage.setViewportSize({ width, height: 844 })
        const geometry = await clinicPage.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll<HTMLElement>('*')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.right > document.documentElement.clientWidth + 1 && rect.right < document.documentElement.clientWidth + 20 }).map((element) => ({ tag: element.tagName, className: element.className, text: element.innerText.slice(0, 35), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })) }))
        if (geometry.content > geometry.viewport + 1) console.log(`Overflow Pacientes ${width}px: ${JSON.stringify(geometry.overflowing)}`)
        if (width === 390) await clinicPage.screenshot({ path: 'docs/evidencias/fase11-revisao-pacientes-mobile-390.png', fullPage: true })
        expect(geometry.content).toBeLessThanOrEqual(geometry.viewport + 1)
      }
      await clinicPage.setViewportSize({ width: 1440, height: 1000 })
      await clinicPage.getByRole('button', { name: '+ Novo paciente' }).click()
      const createPatient = clinicPage.locator('.patient-create-form')
      await createPatient.getByPlaceholder('Nome do paciente').fill(`Tentativa duplicada ${suffix}`)
      await createPatient.getByPlaceholder('(00) 00000-0000').fill(duplicatePatientPhone)
      await createPatient.locator('select[name="unitId"]').selectOption({ label: 'Unidade Centro' })
      await createPatient.getByRole('radio', { name: 'Não autorizou' }).check()
      await createPatient.getByRole('button', { name: 'Cadastrar paciente' }).click()
      await expect(createPatient.getByRole('alert')).toContainText('Possível cadastro existente')
      await expect(createPatient.getByRole('alert')).toContainText(`Paciente fictício ${suffix}`)
    }
    if (item.file === 'agenda') {
      for (const zoom of [1.25, 1.5, 2]) {
        await clinicPage.setViewportSize({ width: Math.round(1440 / zoom), height: 900 })
        const geometry = await clinicPage.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
        expect(geometry.content).toBeLessThanOrEqual(geometry.viewport + 1)
        await clinicPage.screenshot({ path: `docs/evidencias/fase11-legibilidade-agenda-zoom-${Math.round(zoom * 100)}.png`, fullPage: true })
      }
      await clinicPage.setViewportSize({ width: 1440, height: 1000 })
    }
  }

  await clinicPage.setViewportSize({ width: 390, height: 844 })
  await clinicPage.getByRole('button', { name: 'Visão geral', exact: true }).click()
  await expect(clinicPage.getByRole('heading', { name: 'Painel', exact: true })).toBeVisible()
  await clinicPage.screenshot({ path: 'docs/evidencias/fase11-legibilidade-dashboard-clinico-mobile.png', fullPage: true })
  const mobileGeometry = await clinicPage.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  expect(mobileGeometry.content).toBeLessThanOrEqual(mobileGeometry.viewport + 1)

  // Full navigation sweep for this visual audit: capture every clinic screen
  // with the same isolated, fictitious tenant used by the existing checks.
  const navItems = clinicPage.locator('.clinic-sidebar-nav .clinic-nav-link')
  const navLabels = await navItems.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? '').filter(Boolean))
  expect(navLabels.length).toBeGreaterThan(0)
  for (const [index, label] of navLabels.entries()) {
    await clinicPage.setViewportSize({ width: 1440, height: 1000 })
    await navItems.nth(index).click()
    await clinicPage.waitForTimeout(350)
    await expect(clinicPage.locator('.layout')).toBeVisible()
    await expect(clinicPage.locator('vite-error-overlay')).toHaveCount(0)
    const file = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await clinicPage.setViewportSize({ width: 1440, height: 1000 })
    await clinicPage.screenshot({ path: `docs/evidencias/revisao-front-${file}-desktop.png`, fullPage: true })
    for (const width of [390, 320]) {
      await clinicPage.setViewportSize({ width, height: 844 })
      const geometry = await clinicPage.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
      expect(await clinicPage.locator('.clinic-sidebar').evaluate((element) => element.getBoundingClientRect().height), `altura da navegação móvel em ${label}`).toBeLessThanOrEqual(130)
      expect(geometry.content, `overflow horizontal em ${label} (${width}px)`).toBeLessThanOrEqual(geometry.viewport + 1)
      await clinicPage.screenshot({ path: `docs/evidencias/revisao-front-${file}-${width}.png`, fullPage: true })
    }
  }
  await clinicPage.close()
})

function totpAt(secret: string, now: number) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
  const index = digest[digest.length - 1]! & 15
  const binary = ((digest[index]! & 127) << 24) | (digest[index + 1]! << 16) | (digest[index + 2]! << 8) | digest[index + 3]!
  return String(binary % 1_000_000).padStart(6, '0')
}

async function contrastSamples(page: Page, selectors: string[]) {
  return page.evaluate((selectorsToCheck) => {
    const luminance = (color: string) => {
      const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0]
      const channels = values.map((value) => {
        const channel = value / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
    }
    return selectorsToCheck.map((selector) => {
      const element = document.querySelector(selector)!
      const foreground = getComputedStyle(element).color
      let parent: Element | null = element
      let background = 'rgb(255, 255, 255)'
      while (parent) {
        const candidate = getComputedStyle(parent).backgroundColor
        if (candidate !== 'rgba(0, 0, 0, 0)' && candidate !== 'transparent') { background = candidate; break }
        parent = parent.parentElement
      }
      const a = luminance(foreground), b = luminance(background)
      return { selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
    })
  }, selectors)
}
