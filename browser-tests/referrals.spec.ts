import { test, expect, type Page, isolateTestClient } from './fixtures.js'
import { PrismaClient, UserRole } from '../api/node_modules/@prisma/client/index.js'
import * as bcrypt from '../api/node_modules/bcrypt/bcrypt.js'
import { createHash, randomBytes } from 'node:crypto'

const db = new PrismaClient()
const password = 'LocalBrowserE2E!123'
const email = `browser-admin-${randomBytes(5).toString('hex')}@example.test`
const operatorEmail = `browser-operator-${randomBytes(5).toString('hex')}@example.test`
const slug = `browser-e2e-${randomBytes(5).toString('hex')}`
const indicatorPhone = '5511991112222'
const referredPhone = '5511993334444'
const suffix = randomBytes(4).toString('hex')
let tenantId = ''
let unitId = ''
let indicatorPatientId = ''
let referredPatientId = ''

test.beforeAll(async () => {
  const tenant = await db.tenant.create({ data: { name: `Browser E2E ${suffix}`, slug } })
  tenantId = tenant.id
  const unit = await db.unit.create({ data: { tenantId, name: 'Unidade Browser', slug: `browser-${suffix}` } })
  unitId = unit.id
  const admin = await db.user.create({ data: { email, displayName: 'Admin Browser', passwordHash: await bcrypt.hash(password, 4) } })
  const adminMembership = await db.membership.create({ data: { tenantId, userId: admin.id, role: UserRole.TENANT_ADMIN } })
  await db.unitMembership.create({ data: { tenantId, membershipId: adminMembership.id, unitId } })
  const operator = await db.user.create({ data: { email: operatorEmail, displayName: 'Operador Browser', passwordHash: await bcrypt.hash(password, 4) } })
  const operatorMembership = await db.membership.create({ data: { tenantId, userId: operator.id, role: UserRole.OPERATOR } })
  await db.unitMembership.create({ data: { tenantId, membershipId: operatorMembership.id, unitId } })
  const indicator = await db.patient.create({ data: { tenantId, unitId, fullName: `Indicador ${suffix}`, phone: indicatorPhone, phoneNormalized: indicatorPhone } })
  const referred = await db.patient.create({ data: { tenantId, unitId, fullName: `Paciente existente ${suffix}`, phone: referredPhone, phoneNormalized: referredPhone } })
  indicatorPatientId = indicator.id
  referredPatientId = referred.id
})

test.afterAll(async () => {
  try {
    if (tenantId) {
      await db.referralRewardUse.deleteMany({ where: { tenantId } })
      await db.referralRewardSource.deleteMany({ where: { tenantId } })
      await db.referralEvent.deleteMany({ where: { tenantId } })
      await db.referral.deleteMany({ where: { tenantId } })
      await db.referralReward.deleteMany({ where: { tenantId } })
      await db.referralParticipant.deleteMany({ where: { tenantId } })
      await db.referralCampaignUnit.deleteMany({ where: { tenantId } })
      await db.referralCampaign.deleteMany({ where: { tenantId } })
      await db.tenant.deleteMany({ where: { id: tenantId } })
    }
    if (email || operatorEmail) await db.user.deleteMany({ where: { email: { in: [email, operatorEmail] } } })
  } finally {
    await db.$disconnect()
  }
})

async function signIn(page: Page, userEmail: string) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(userEmail)
  await page.getByLabel(/Clínica/).fill(slug)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: /Ol/ })).toBeVisible()
}

function localDateTime(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
}

test('administração, lead público idempotente, aprovação, emissão, resgate e cartão fidelidade', async ({ page, context, browser }) => {
  const patientCountBefore = await db.patient.count({ where: { tenantId } })
  const consentCountBefore = await db.consentPreference.count({ where: { tenantId } })
  await signIn(page, email)
  await page.getByRole('button', { name: 'Indicações' }).click()
  await expect(page.getByRole('heading', { name: 'Indicações' })).toBeVisible()

  const campaignName = `Campanha navegador ${suffix}`
  const form = page.locator('form.module-form').first()
  await form.getByPlaceholder('Nome da campanha').fill(campaignName)
  await form.locator('input[type="datetime-local"]').first().fill(localDateTime(new Date(Date.now() - 60_000)))
  await form.locator('select').nth(0).selectOption('LEAD_REGISTERED')
  await form.locator('select').nth(1).selectOption('VOUCHER')
  await form.getByPlaceholder(/Descri/).last().fill('Voucher de demonstração local; depende de aprovação humana.')
  await form.getByRole('button', { name: 'Criar rascunho' }).click()
  await expect(page.getByText(new RegExp(`${campaignName}.*Rascunho`))).toBeVisible()
  await page.getByRole('button', { name: 'Ativar' }).click()
  await expect(page.getByText(new RegExp(`${campaignName}.*Ativa`))).toBeVisible()

  const linkSection = page.locator('section.module-form').filter({ hasText: 'Emitir link para participante elegível' })
  await linkSection.locator('select').nth(0).selectOption({ label: campaignName })
  await linkSection.locator('select').nth(1).selectOption({ label: `Indicador ${suffix}` })
  await linkSection.locator('select').nth(2).selectOption({ label: 'Unidade Browser' })
  await linkSection.getByRole('button', { name: 'Gerar link privado' }).click()
  const linkNotice = page.locator('.notice').filter({ hasText: 'Link individual emitido' })
  await expect(linkNotice).toBeVisible()
  const noticeText = await linkNotice.innerText()
  const shareToken = noticeText.match(/https?:\/\/[^/\s]+\/indicacao\/([A-Za-z0-9_-]+)/)?.[1]
  expect(shareToken).toBeTruthy()

  const visitor = await context.newPage()
  const publicUrl = `/indicacao/${shareToken}`
  await visitor.goto(publicUrl)
  await expect(visitor.getByLabel('Telefone com DDD')).toBeVisible()
  await expect(visitor.locator('main p').first()).toContainText('autoriza mensagens')
  await visitor.getByLabel('Telefone com DDD').fill('123')
  await visitor.getByRole('button', { name: 'Continuar' }).click()
  await expect(visitor.getByLabel('Telefone com DDD')).toHaveValue('123')
  expect(await visitor.locator('#referral-phone').evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true)

  await visitor.getByLabel('Telefone com DDD').fill(referredPhone)
  expect(await visitor.locator('#referral-phone').evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
  const firstLeadResponsePromise = visitor.waitForResponse((response) => response.url().includes('/public/lead/') && response.request().method() === 'POST')
  await visitor.getByRole('button', { name: 'Continuar' }).click()
  const firstLeadResponse = await firstLeadResponsePromise
  expect(firstLeadResponse.status()).toBe(201)
  expect(await firstLeadResponse.json()).toMatchObject({ accepted: true, patientCreated: false, consentRecorded: false })
  await expect(visitor.locator('#referral-phone')).toHaveCount(0)
  await expect(visitor.locator('main p').first()).toContainText('Nenhum consentimento')
  const referralId = await db.referral.findFirstOrThrow({ where: { tenantId, leadPhoneNormalized: referredPhone } }).then((row) => row.id)
  expect(await db.patient.count({ where: { tenantId } })).toBe(patientCountBefore)
  expect(await db.consentPreference.count({ where: { tenantId } })).toBe(consentCountBefore)

  await visitor.goto(publicUrl)
  await expect(visitor.getByLabel('Telefone com DDD')).toBeVisible()
  const repeatedLeadResponsePromise = visitor.waitForResponse((response) => response.url().includes('/public/lead/') && response.request().method() === 'POST')
  await visitor.getByLabel('Telefone com DDD').fill(referredPhone)
  await visitor.getByRole('button', { name: 'Continuar' }).click()
  const repeatedLeadResponse = await repeatedLeadResponsePromise
  expect(repeatedLeadResponse.status()).toBe(201)
  expect(await repeatedLeadResponse.json()).toMatchObject({ accepted: true, patientCreated: false, consentRecorded: false })
  await expect(visitor.locator('#referral-phone')).toHaveCount(0)
  expect(await db.referral.count({ where: { tenantId, id: referralId } })).toBe(1)
  expect(await db.patient.count({ where: { tenantId } })).toBe(patientCountBefore)
  expect(await db.consentPreference.count({ where: { tenantId } })).toBe(consentCountBefore)

  const invalid = await context.newPage()
  await invalid.goto('/indicacao/token-invalido-sem-identificadores-privados')
  await expect(invalid.getByText(/expirado/i)).toBeVisible()
  await invalid.close()

  await db.referralCampaign.updateMany({ where: { tenantId, name: campaignName }, data: { status: 'PAUSED' } })
  await visitor.goto(publicUrl)
  await expect(visitor.getByText(/expirado/i)).toBeVisible()
  await db.referralCampaign.updateMany({ where: { tenantId, name: campaignName }, data: { status: 'ACTIVE', endsAt: new Date(Date.now() - 60_000) } })
  await visitor.goto(publicUrl)
  await expect(visitor.getByText(/expirado/i)).toBeVisible()
  await visitor.close()

  await page.getByRole('button', { name: 'Atualizar' }).click()
  const referralArticle = page.locator('article').filter({ hasText: campaignName }).filter({ hasText: referredPhone })
  await expect(referralArticle.getByLabel('Paciente existente para associar')).toBeVisible()
  await referralArticle.getByLabel('Paciente existente para associar').selectOption(referredPatientId)
  await referralArticle.getByRole('button', { name: 'Associar' }).click()
  await expect(page.getByText(/Indicação vinculada ao paciente existente/)).toBeVisible()
  await expect(referralArticle.getByText(/Paciente: Paciente existente/)).toBeVisible()

  const pendingReward = await db.referralReward.findFirstOrThrow({ where: { tenantId, campaign: { name: campaignName } } })
  const operatorContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_WEB_URL ?? 'http://localhost:5173' })
  await isolateTestClient(operatorContext, 'referrals.spec.ts')
  const operatorPage = await operatorContext.newPage()
  await signIn(operatorPage, operatorEmail)
  await expect(operatorPage.getByRole('button', { name: 'Indicações' })).toHaveCount(0)
  const deniedStatus = await operatorPage.evaluate(async ({ rewardId, apiUrl }) => {
    const token = sessionStorage.getItem('clinic_access')
    const response = await fetch(`${apiUrl}/api/referrals/rewards/${rewardId}/decision`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'APPROVE' }) })
    return response.status
  }, { rewardId: pendingReward.id, apiUrl: process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3002' })
  expect(deniedStatus).toBe(403)
  await operatorContext.close()

  await page.getByRole('button', { name: 'Aprovar' }).click()
  await expect(page.getByText(/Recompensa aprovada/)).toBeVisible()
  await page.getByRole('button', { name: 'Emitir voucher' }).click()
  const issueNotice = page.locator('.notice').filter({ hasText: 'Benefício emitido' })
  await expect(issueNotice).toBeVisible()
  const issuedText = await issueNotice.innerText()
  const voucherCode = issuedText.match(/Voucher ([A-Z0-9_-]+)/)?.[1]
  expect(voucherCode).toBeTruthy()
  const issuedReward = await db.referralReward.findUniqueOrThrow({ where: { id: pendingReward.id } })
  expect(issuedReward.expiresAt!.getTime() - issuedReward.issuedAt!.getTime()).toBe(90 * 86400000)

  const redeemForm = page.locator('form.module-form').filter({ hasText: 'Registrar resgate interno' })
  await redeemForm.getByLabel('Código do voucher').fill(voucherCode!)
  await redeemForm.getByLabel('Unidade do resgate').selectOption(unitId)
  await redeemForm.getByLabel('Quantidade').fill('1')
  await redeemForm.getByRole('button', { name: 'Confirmar resgate' }).click()
  await expect(page.getByText(/Resgate registrado no SaaS/)).toBeVisible()
  expect((await db.referralReward.findUniqueOrThrow({ where: { id: pendingReward.id } })).status).toBe('USED')

  const loyaltySection = page.locator('section.module-form').filter({ hasText: 'Cartão fidelidade administrativo' })
  await loyaltySection.locator('select').selectOption(indicatorPatientId)
  await expect(loyaltySection.getByText(/1\/1/)).toBeVisible()
  await page.once('dialog', async (dialog) => dialog.accept('Cancelamento após recompensa já usada; revisão humana necessária.'))
  await referralArticle.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByText(/Indicação atualizada para cancelado/)).toBeVisible()
  expect((await db.referralReward.findUniqueOrThrow({ where: { id: pendingReward.id } })).status).toBe('USED')
  expect(await db.referralEvent.count({ where: { tenantId, referralId, event: 'CLICKED' } })).toBe(1)
})

test('link público nunca transforma lead em consentimento nem revela o indicador', async ({ page }) => {
  const token = randomBytes(32).toString('base64url')
  const publicLeadPhone = `5599${Date.now().toString().slice(-9)}`
  const patientsBefore = await db.patient.count({ where: { tenantId } })
  const consentsBefore = await db.consentPreference.count({ where: { tenantId } })
  const campaign = await db.referralCampaign.create({ data: { tenantId, name: `Public minimal ${suffix}`, startsAt: new Date(Date.now() - 60_000), status: 'ACTIVE', qualificationCriterion: 'LEAD_REGISTERED', rewardEveryQualifiedCount: 1, rewardType: 'VOUCHER', rewardQuantity: 1, rewardDescription: 'Fixture pública', rewardValidityDays: 90, maxRewardsPerParticipant: 1, requireHumanApproval: true } })
  await db.referralCampaignUnit.create({ data: { tenantId, campaignId: campaign.id, unitId } })
  await db.referralParticipant.create({ data: { tenantId, campaignId: campaign.id, patientId: indicatorPatientId, unitId, shareTokenHash: createHash('sha256').update(token).digest('hex') } })
  await page.goto(`/indicacao/${token}`)
  await expect(page.getByRole('heading', { name: /Você recebeu uma indicação/ })).toBeVisible()
  await expect(page.getByText(new RegExp(`Indicador ${suffix}`))).toHaveCount(0)
  await expect(page.locator('main p').first()).toContainText('autoriza mensagens')
  await page.getByLabel('Telefone com DDD').fill(publicLeadPhone)
  const leadResponsePromise = page.waitForResponse((response) => response.url().includes('/public/lead/') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Continuar' }).click()
  const leadResponse = await leadResponsePromise
  expect(await leadResponse.json()).toMatchObject({ accepted: true, patientCreated: false, consentRecorded: false })
  await expect(page.locator('#referral-phone')).toHaveCount(0)
  const preference = await db.consentPreference.findFirst({ where: { tenantId, patientId: referredPatientId } })
  expect(preference).toBeNull()
  expect(await db.patient.count({ where: { tenantId } })).toBe(patientsBefore)
  expect(await db.consentPreference.count({ where: { tenantId } })).toBe(consentsBefore)
  await db.referralRewardSource.deleteMany({ where: { tenantId, referral: { campaignId: campaign.id } } })
  await db.referralReward.deleteMany({ where: { tenantId, campaignId: campaign.id } })
  await db.referralCampaign.delete({ where: { id: campaign.id } })
})
