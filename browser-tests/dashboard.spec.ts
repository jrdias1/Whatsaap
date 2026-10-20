import { test, expect, type Page } from './fixtures.js'
import { PrismaClient, UserRole } from '../api/node_modules/@prisma/client/index.js'
import * as bcrypt from '../api/node_modules/bcrypt/bcrypt.js'
import { randomBytes } from 'node:crypto'

const db = new PrismaClient()
const suffix = randomBytes(5).toString('hex')
const slug = `dashboard-e2e-${suffix}`
const email = `dashboard-${suffix}@example.test`
const password = 'Dashboard-browser-test-2026!'
const patientName = `Paciente dashboard ${suffix}`
let tenantId = ''
let unitId = ''

test.beforeAll(async () => {
  const tenant = await db.tenant.create({ data: { name: `Dashboard E2E ${suffix}`, slug } })
  tenantId = tenant.id
  const unit = await db.unit.create({ data: { tenantId, name: 'Unidade Dashboard', slug: `dash-${suffix}` } })
  unitId = unit.id
  const user = await db.user.create({ data: { email, displayName: 'Recepção Dashboard', passwordHash: await bcrypt.hash(password, 4) } })
  const membership = await db.membership.create({ data: { tenantId, userId: user.id, role: UserRole.TENANT_ADMIN } })
  await db.unitMembership.create({ data: { tenantId, membershipId: membership.id, unitId } })
  const patient = await db.patient.create({ data: { tenantId, unitId, fullName: patientName, phone: '5511990000000' } })
  const procedure = await db.procedure.create({ data: { tenantId, unitId, name: `Procedimento ${suffix}`, appointmentDurationMinutes: 30 } })
  const startsAt = new Date(Date.now() + 2 * 60 * 60_000)
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000)
  const appointment = await db.appointment.create({ data: { tenantId, unitId, patientId: patient.id, procedureId: procedure.id, startsAt, endsAt, status: 'PENDING', source: 'NATIVE' } })
  const conversation = await db.conversation.create({ data: { tenantId, unitId, patientId: patient.id, status: 'WAITING_HUMAN', lastMessageAt: new Date(), humanResponseDueAt: new Date(Date.now() + 15 * 60_000) } })
  await db.task.create({ data: { tenantId, unitId, patientId: patient.id, title: 'Retornar ligação', assignedToId: user.id, createdById: user.id, status: 'TODO', dueAt: new Date(Date.now() - 60_000) } })
  await db.task.create({ data: { tenantId, unitId, patientId: patient.id, conversationId: conversation.id, title: 'Contexto conversa dashboard', assignedToId: user.id, createdById: user.id } })
  await db.task.create({ data: { tenantId, unitId, patientId: patient.id, appointmentId: appointment.id, title: 'Contexto agendamento dashboard', assignedToId: user.id, createdById: user.id } })
})

test.afterAll(async () => {
  try {
    if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } })
    if (email) await db.user.deleteMany({ where: { email } })
  } finally { await db.$disconnect() }
})

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel(/Clínica|Clinica/).fill(slug)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: /Olá,/ })).toBeVisible()
}

test('dashboard mostra dados agregados e navega da visão geral ao atendimento com resumo do paciente', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Agenda de hoje' })).toBeVisible()
  await page.screenshot({ path: 'docs/evidencias/fase11-dashboard-desktop.png', fullPage: true })
  await page.screenshot({ path: 'docs/evidencias/fase8-dashboard-desktop.png', fullPage: true })
  await expect(page.getByRole('button', { name: /Agendamentos hoje/ })).toContainText('1')
  await expect(page.getByRole('button', { name: /Conversas na fila/ })).toContainText('1')
  await expect(page.getByRole('button', { name: /Tarefas pendentes/ })).toContainText('3')
  await expect(page.getByText(patientName)).toBeVisible()
  await page.getByLabel('Unidade').selectOption(unitId)
  await expect(page.locator('.clinic-dashboard-date')).toContainText('Unidade Dashboard')

  await page.getByRole('button', { name: 'Inbox', exact: true }).click()
  await page.getByLabel('Buscar conversas').fill('sem resultado')
  await expect(page.getByRole('button', { name: new RegExp(patientName) })).toHaveCount(0)
  await page.getByLabel('Buscar conversas').fill(patientName)
  await page.getByLabel('Filtro de conversas').selectOption('QUEUE')
  await expect(page.getByRole('button', { name: new RegExp(patientName) })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(patientName) }).click()
  const summary = page.getByRole('complementary', { name: 'Resumo do paciente' })
  await expect(summary).toContainText(patientName)
  const conversationPanel = page.getByRole('region', { name: 'Painel da conversa' })
  const emptyReply = conversationPanel.getByRole('button', { name: /Registrar na fila/ })
  await emptyReply.click()
  expect(await conversationPanel.locator('#human-message-body').evaluate((element: HTMLTextAreaElement) => element.validationMessage)).toBe('Escreva uma resposta antes de registrar na fila.')
  await page.route('**/ai/conversations/*/drafts', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'A IA não está configurada com autorização.' }) }))
  await conversationPanel.getByRole('button', { name: 'Gerar rascunho de IA' }).click()
  await expect(conversationPanel.getByRole('status')).toContainText('A geração de rascunhos está indisponível')
  await page.unrouteAll()
  await summary.getByRole('button', { name: /Criar tarefa para a equipe/ }).click()
  await summary.locator('input[name="title"]').fill('Retornar contato dashboard')
  await summary.getByRole('button', { name: /Salvar tarefa/ }).click()
  await expect(page.getByText(/Tarefa vinculada/)).toBeVisible()
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click()
  await expect(page.getByText('Retornar contato dashboard')).toBeVisible()
  await page.screenshot({ path: 'docs/evidencias/fase11-tarefas-desktop.png', fullPage: true })
  const conversationTask = page.locator('.task-card').filter({ hasText: 'Contexto conversa dashboard' })
  await conversationTask.getByRole('button', { name: 'Abrir conversa' }).click()
  await expect(page.getByRole('region', { name: 'Painel da conversa' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Resumo do paciente' })).toContainText(patientName)
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click()
  const appointmentTask = page.locator('.task-card').filter({ hasText: 'Contexto agendamento dashboard' })
  await appointmentTask.getByRole('button', { name: /Abrir agendamento/ }).click()
  await expect(page.getByRole('dialog', { name: 'Agendamento' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Agendamento' }).getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click()
  const patientTask = page.locator('.task-card').filter({ hasText: 'Contexto agendamento dashboard' })
  await patientTask.getByRole('button', { name: 'Abrir paciente' }).click()
  await expect(page.getByRole('heading', { name: patientName })).toBeVisible()
  await page.screenshot({ path: 'docs/evidencias/fase11-perfil-paciente-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Abrir conversa' }).click()
  await expect(page.getByRole('region', { name: 'Painel da conversa' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Resumo do paciente' })).toContainText('Nenhum atendimento concluído registrado')
  await page.getByRole('complementary', { name: 'Resumo do paciente' }).getByRole('button', { name: 'Abrir / reagendar atendimento' }).click()
  await expect(page.getByRole('dialog', { name: 'Agendamento' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Agendamento' }).getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByRole('button', { name: 'Inbox', exact: true }).click()
  await page.getByRole('button', { name: new RegExp(patientName) }).click()
  await expect(page.getByRole('complementary', { name: 'Resumo do paciente' })).toBeVisible()
  await page.screenshot({ path: 'docs/evidencias/fase8-inbox-desktop.png', fullPage: true })
  await page.screenshot({ path: 'docs/evidencias/fase11-atendimentos-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Abrir perfil completo' })).toBeVisible()
  await page.screenshot({ path: 'docs/evidencias/fase8-inbox-mobile.png', fullPage: true })
  await page.screenshot({ path: 'docs/evidencias/fase11-atendimentos-mobile.png', fullPage: true })
})
