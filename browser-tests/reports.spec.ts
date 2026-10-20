import { test, expect, type Page } from './fixtures.js'
import { PrismaClient, UserRole } from '../api/node_modules/@prisma/client/index.js'
import * as bcrypt from '../api/node_modules/bcrypt/bcrypt.js'
import { randomBytes } from 'node:crypto'

const db = new PrismaClient()
const suffix = randomBytes(5).toString('hex')
const slug = `reports-ui-${suffix}`
const email = `reports-ui-${suffix}@example.test`
const password = 'Reports-browser-test-2026!'
const patientName = `Paciente NPS ${suffix}`
let tenantId = ''
let userId = ''
let unitId = ''

test.beforeAll(async () => {
  const tenant = await db.tenant.create({ data: { name: `Reports browser ${suffix}`, slug } })
  tenantId = tenant.id
  const unit = await db.unit.create({ data: { tenantId, name: 'Unidade Relatórios', slug: `reports-${suffix}` } })
  unitId = unit.id
  const user = await db.user.create({ data: { email, displayName: 'Admin Relatórios', passwordHash: await bcrypt.hash(password, 4) } })
  userId = user.id
  const membership = await db.membership.create({ data: { tenantId, userId: user.id, role: UserRole.TENANT_ADMIN } })
  await db.unitMembership.create({ data: { tenantId, membershipId: membership.id, unitId } })
  const patient = await db.patient.create({ data: { tenantId, unitId, fullName: patientName } })
  const appointment = await db.appointment.create({ data: { tenantId, unitId, patientId: patient.id, startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() - 1_800_000), completedAt: new Date(Date.now() - 1_800_000), status: 'COMPLETED', source: 'NATIVE' } })
  await db.npsSettings.create({ data: { tenantId, enabled: true, unitId, createFollowupBelow: 6, responsibleUserId: user.id, windowStartMinute: 0, windowEndMinute: 1440 } })
  await db.npsSurvey.create({ data: { tenantId, unitId, patientId: patient.id, appointmentId: appointment.id, scheduledAt: new Date(Date.now() - 60_000), question: 'Indicaria nossa clínica?', allowComment: true } })
})

test.afterAll(async () => {
  try {
    if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } })
    if (userId) await db.user.deleteMany({ where: { id: userId } })
  } finally { await db.$disconnect() }
})

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel(/Clínica|Clinica/).fill(slug)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.locator('.clinic-page-header h1')).toHaveText('Visão geral')
}

test('relatórios filtra, exporta, registra resposta NPS e apresenta follow-up no desktop e celular', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: 'Relatórios', exact: true }).click()
  await expect(page.locator('.clinic-page-header h1')).toHaveText('Relatórios')
  await expect(page.getByRole('article').filter({ hasText: 'Agendamentos criados' })).toContainText('1')
  await page.screenshot({ path: 'docs/evidencias/fase11-relatorios-desktop.png', fullPage: true })
  await page.getByLabel('Unidade do relatório').selectOption(unitId)
  await page.getByRole('button', { name: 'Aplicar filtros' }).click()
  await page.getByText('NPS e pesquisas', { exact: true }).click()
  const npsConfig = page.locator('.reports-nps-config')
  await page.locator('.reports-nps-settings > summary').click()
  await npsConfig.getByLabel('Pergunta que a equipe fará ao paciente').fill('Como avalia a recomendação da clínica?')
  await npsConfig.getByLabel('Criar tarefa para notas iguais ou abaixo').selectOption('6')
  await npsConfig.getByRole('button', { name: 'Salvar configuração' }).click()
  await expect(page.locator('.reports-notice')).toContainText('Configuração do NPS salva')
  await expect(page.getByText('Pendente de registro pela equipe')).toBeVisible()
  await page.locator('.reports-surveys form').getByRole('combobox').first().selectOption('4')
  await page.locator('.reports-surveys form').getByRole('textbox').fill('Atendimento fictício para validação')
  await page.getByRole('button', { name: 'Registrar nota' }).click()
  await expect(page.getByText(/Nota 4\/10/)).toBeVisible()
  await expect(page.getByText(/Acompanhamentos: 1 pendente/)).toBeVisible()
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click()
  await expect(page.getByText('Follow-up NPS: nota 4')).toBeVisible()
  await page.getByRole('button', { name: 'Relatórios', exact: true }).click()
  await page.getByText('NPS e pesquisas', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'NPS da clínica' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar CSV' }).click()
  expect((await download).suggestedFilename()).toContain('.csv')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.clinic-page-header h1')).toHaveText('Relatórios')
  await page.screenshot({ path: 'docs/evidencias/fase9-relatorios-mobile.png', fullPage: true })
  await page.screenshot({ path: 'docs/evidencias/fase11-relatorios-mobile.png', fullPage: true })
})
