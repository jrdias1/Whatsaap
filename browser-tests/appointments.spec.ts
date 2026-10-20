import { test, expect, type Page, isolateTestClient } from './fixtures.js'
import { PrismaClient, UserRole } from '../api/node_modules/@prisma/client/index.js'
import * as bcrypt from '../api/node_modules/bcrypt/bcrypt.js'
import { randomBytes } from 'node:crypto'

const db = new PrismaClient()
const password = 'LocalCalendarE2E!123'
const suffix = randomBytes(5).toString('hex')
const email = `calendar-admin-${suffix}@example.test`
const operatorEmail = `calendar-operator-${suffix}@example.test`
const slug = `calendar-e2e-${suffix}`
const webBaseUrl = process.env.PLAYWRIGHT_WEB_URL ?? 'http://localhost:5173'
const apiBaseUrl = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3002'
let tenantId = ''
let unitId = ''
let otherUnitId = ''
let adminId = ''
let patientName = `Paciente agenda ${suffix}`

test.beforeAll(async () => {
  const tenant = await db.tenant.create({ data: { name: `Calendar E2E ${suffix}`, slug } })
  tenantId = tenant.id
  const [unit, otherUnit] = await Promise.all([
    db.unit.create({ data: { tenantId, name: 'Unidade agenda', slug: `agenda-${suffix}` } }),
    db.unit.create({ data: { tenantId, name: 'Unidade restrita', slug: `restrita-${suffix}` } }),
  ])
  unitId = unit.id
  otherUnitId = otherUnit.id
  const admin = await db.user.create({ data: { email, displayName: 'Admin agenda', passwordHash: await bcrypt.hash(password, 4) } })
  adminId = admin.id
  const adminMembership = await db.membership.create({ data: { tenantId, userId: admin.id, role: UserRole.TENANT_ADMIN } })
  await db.unitMembership.createMany({ data: [unitId, otherUnitId].map((id) => ({ tenantId, membershipId: adminMembership.id, unitId: id })) })
  const operator = await db.user.create({ data: { email: operatorEmail, displayName: 'Operador agenda', passwordHash: await bcrypt.hash(password, 4) } })
  const operatorMembership = await db.membership.create({ data: { tenantId, userId: operator.id, role: UserRole.OPERATOR } })
  await db.unitMembership.create({ data: { tenantId, membershipId: operatorMembership.id, unitId } })
  const [patient] = await Promise.all([
    db.patient.create({ data: { tenantId, unitId, fullName: patientName, phone: `55119${Date.now().toString().slice(-8)}` } }),
    db.procedure.create({ data: { tenantId, unitId, name: `Procedimento agenda ${suffix}`, appointmentDurationMinutes: 45 } }),
  ])
  patientName = patient.fullName
})

test.afterAll(async () => {
  try {
    if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } })
    await db.user.deleteMany({ where: { email: { in: [email, operatorEmail] } } })
  } finally { await db.$disconnect() }
})

async function signIn(page: Page, userEmail: string) {
  await page.goto('/')
  await expect(page.getByLabel('E-mail')).toHaveAttribute('autocomplete', 'username')
  await expect(page.getByLabel('Senha')).toHaveAttribute('autocomplete', 'current-password')
  await page.getByLabel('E-mail').fill(userEmail)
  await page.getByLabel(/Clínica|Clinica/).fill(slug)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.locator('.clinic-page-header h1')).toHaveText('Visão geral')
  await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  await page.getByRole('button', { name: 'Agenda', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
}

function saoPauloDay(date: Date) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(p.map((item) => [item.type, item.value]))
  return `${values.year}-${values.month}-${values.day}`
}
function shiftDay(key: string, amount: number) { const date = new Date(`${key}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return saoPauloDay(date) }

test('recepcao cria, consulta, reagenda e conclui pelo calendario visual', async ({ page }) => {
  await signIn(page, email)
  await page.getByLabel('Visualização').selectOption('WEEK')
  await page.getByRole('button', { name: 'Novo agendamento' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Localizar paciente').fill(patientName)
  await dialog.locator('.appointment-form select').nth(0).selectOption({ index: 1 })
  await dialog.locator('.appointment-form select').nth(1).selectOption({ index: 1 })
  await expect(dialog.locator('.duration-hint')).toContainText('Duração do atendimento: 45 min. Essa duração vem do procedimento.')
  await expect(dialog.locator('.duration-hint')).toContainText('Os recursos selecionados podem limitar os horários de início.')
  const today = saoPauloDay(new Date())
  const appointmentDay = shiftDay(today, 1)
  await dialog.getByLabel(/Data e horário/).fill(`${appointmentDay}T10:00`)
  await dialog.getByRole('button', { name: 'Consultar este horário' }).click()
  await expect(dialog.getByText(/Horário disponível/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirmar agendamento' }).click()
  const event = page.getByRole('button', { name: new RegExp(patientName) })
  await expect(event).toBeVisible()
  await page.screenshot({ path: 'docs/evidencias/fase11-agenda-desktop.png', fullPage: true })
  await event.last().click()
  const details = page.getByRole('dialog')
  await expect(details.getByText(/45 min/)).toBeVisible()
  const newDay = shiftDay(appointmentDay, 1)
  await details.getByLabel(/Novo horário/).fill(`${newDay}T11:00`)
  await details.getByRole('button', { name: 'Consultar disponibilidade' }).click()
  await expect(details.getByText('Horário disponível')).toBeVisible()
  await details.getByRole('button', { name: 'Confirmar reagendamento' }).click()
  await expect(details.getByText('Agendamento reagendado.')).toBeVisible()
  const rescheduledAppointment = await db.appointment.findFirstOrThrow({ where: { tenantId, patient: { fullName: patientName } }, orderBy: { createdAt: 'desc' } })
  const elapsedStart = new Date(Date.now() - 60 * 60_000)
  await db.appointment.update({ where: { id: rescheduledAppointment.id }, data: { startsAt: elapsedStart, endsAt: new Date(elapsedStart.getTime() + 45 * 60_000) } })
  await details.getByRole('button', { name: 'Confirmar' }).click()
  await expect(details.getByText(/Confirmado/)).toBeVisible()
  await details.getByRole('button', { name: 'Concluir atendimento' }).click()
  await expect(details.getByText(/Concluído/)).toBeVisible()
  await expect(event).toBeVisible()
  await details.getByRole('button', { name: 'Fechar' }).click()
  for (const width of [1440, 1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(geometry.content).toBeLessThanOrEqual(geometry.viewport + 1)
    await page.screenshot({ path: `docs/evidencias/qa48-agenda-${width}.png`, fullPage: true })
  }
})

test('renova sessão durante o preenchimento e salva o formulário sem perder os dados', async ({ page }) => {
  await signIn(page, email)
  await page.getByRole('button', { name: 'Novo agendamento' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Localizar paciente').fill(patientName)
  await dialog.locator('.appointment-form select').nth(0).selectOption({ index: 1 })
  await dialog.locator('.appointment-form select').nth(1).selectOption({ index: 1 })
  const appointmentDay = shiftDay(saoPauloDay(new Date()), 3)
  await dialog.getByLabel(/Data e horário/).fill(`${appointmentDay}T13:00`)
  await dialog.getByRole('button', { name: 'Consultar este horário' }).click()
  await expect(dialog.getByText(/Horário disponível/)).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('clinic_access', 'expired-access-token-for-regression'))
  await dialog.getByRole('button', { name: 'Confirmar agendamento' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.notice')).toContainText(/Agendamento criado/)
  const start = new Date(`${appointmentDay}T03:00:00.000Z`)
  const end = new Date(start.getTime() + 86400000)
  await expect.poll(() => db.appointment.count({ where: { tenantId, patient: { fullName: patientName }, startsAt: { gte: start, lt: end } } })).toBe(1)
})

test('dois atendentes não conseguem confirmar simultaneamente o mesmo horário', async ({ browser }) => {
  const beforeCount = await db.appointment.count({ where: { tenantId, unitId, patient: { fullName: patientName } } })
  const firstContext = await browser.newContext({ baseURL: webBaseUrl })
  const secondContext = await browser.newContext({ baseURL: webBaseUrl })
  await Promise.all([isolateTestClient(firstContext, 'appointments.spec.ts'), isolateTestClient(secondContext, 'appointments.spec.ts')])
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()
  try {
    await Promise.all([signIn(first, email), signIn(second, operatorEmail)])
    await Promise.all([first, second].map(async (page) => {
      await page.getByLabel('Visualização').selectOption('WEEK')
      await page.getByRole('button', { name: 'Próximo período' }).click()
      await page.getByRole('button', { name: 'Novo agendamento' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Localizar paciente').fill(patientName)
      await dialog.locator('.appointment-form select').nth(0).selectOption({ index: 1 })
      await dialog.locator('.appointment-form select').nth(1).selectOption({ index: 1 })
      await dialog.getByLabel(/Data e horário/).fill(`${shiftDay(saoPauloDay(new Date()), 2)}T14:00`)
      await dialog.getByRole('button', { name: 'Consultar este horário' }).click()
      await expect(dialog.getByText(/Horário disponível/)).toBeVisible()
    }))
    const responsesPromise = Promise.all([first, second].map((page) => page.waitForResponse((response) => response.url().endsWith('/api/appointments') && response.request().method() === 'POST')))
    await Promise.all([first, second].map((page) => page.getByRole('button', { name: 'Confirmar agendamento' }).click()))
    const responses = await responsesPromise
    const statuses = await Promise.all(responses.map((response) => response.status()))
    expect([...statuses].sort()).toEqual([201, 400])
    const count = await db.appointment.count({ where: { tenantId, unitId, patient: { fullName: patientName } } })
    expect(count).toBe(beforeCount + 1)
    const conflictPage = statuses[0] === 400 ? first : second
    const successPage = statuses[0] === 201 ? first : second
    await expect(conflictPage.locator('.calendar-error')).toContainText(/horário|conflict|appointment/i)
    await expect(successPage.locator('.notice')).toContainText(/Agendamento criado/i)
  } finally {
    await firstContext.close()
    await secondContext.close()
  }
})

test('administra recursos da unidade e associa profissional e sala na agenda', async ({ page }) => {
  await signIn(page, email)
  await page.getByRole('button', { name: 'Recursos', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Profissionais, salas e equipamentos' })).toBeVisible()
  await page.getByLabel('Tipo de recurso').selectOption('PROFESSIONAL')
  await page.getByLabel('Nome do recurso').fill('Dra. Agenda ' + suffix)
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Recurso cadastrado e auditado.')).toBeVisible()
  await page.getByLabel('Tipo de recurso').selectOption('ROOM')
  await page.getByLabel('Nome do recurso').fill('Sala Agenda ' + suffix)
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.locator('.resource-schedule-panel').getByText('Sala Agenda ' + suffix, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Agenda', exact: true }).click()
  await page.getByLabel(/Visualiza/).selectOption('WEEK')
  await page.getByRole('button', { name: 'Novo agendamento' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Localizar paciente').fill(patientName)
  await dialog.locator('.appointment-form select').nth(0).selectOption({ index: 1 })
  await dialog.locator('.appointment-form select').nth(1).selectOption({ index: 1 })
  const appointmentDay = shiftDay(saoPauloDay(new Date()), 3)
  await dialog.getByLabel(/Data e hor/).fill(`${appointmentDay}T10:00`)
  await expect(dialog.locator('.resource-picker input[type="checkbox"]')).toHaveCount(2)
  await dialog.locator('.resource-picker input[type="checkbox"]').nth(0).check()
  await dialog.locator('.resource-picker input[type="checkbox"]').nth(1).check()
  await dialog.getByRole('button', { name: /Consultar este hor/ }).click()
  await expect(dialog.getByText(/Hor.rio dispon.vel/)).toBeVisible()
  const createdResponse = page.waitForResponse((response) => response.url().endsWith('/api/appointments') && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: /Confirmar agendamento/ }).click()
  const created = await createdResponse
  expect(created.status()).toBe(201)
  const createdAppointment = await created.json()
  expect(createdAppointment.resources.map((row: { resource: { name: string } }) => row.resource.name)).toEqual(expect.arrayContaining(['Dra. Agenda ' + suffix, 'Sala Agenda ' + suffix]))
  const event = page.getByRole('button', { name: new RegExp(`${patientName}.*10:00`) })
  await event.click()
  await expect(page.getByRole('dialog')).toContainText('Dra. Agenda ' + suffix)
  await expect(page.getByRole('dialog')).toContainText('Sala Agenda ' + suffix)
})

test('operador não consulta agendamentos de unidade fora do escopo', async ({ page }) => {
  const inaccessibleName = `Paciente unidade restrita ${suffix}`
  const inaccessiblePatient = await db.patient.create({ data: { tenantId, unitId: otherUnitId, fullName: inaccessibleName, phone: `55118${Date.now().toString().slice(-8)}` } })
  const inaccessibleStart = new Date(Date.now() + 24 * 60 * 60_000)
  await db.appointment.create({ data: { tenantId, unitId: otherUnitId, patientId: inaccessiblePatient.id, startsAt: inaccessibleStart, endsAt: new Date(inaccessibleStart.getTime() + 30 * 60_000), source: 'NATIVE' } })
  await signIn(page, operatorEmail)
  await expect(page.getByLabel('Unidade')).toHaveValue(unitId)
  await page.getByLabel('Visualização').selectOption('WEEK')
  const result = await page.evaluate(async ({ id, apiBaseUrl }) => {
    const token = sessionStorage.getItem('clinic_access')
    const response = await fetch(`${apiBaseUrl}/api/appointments?unitId=${id}`, { headers: { Authorization: `Bearer ${token}` } })
    return response.status
  }, { id: otherUnitId, apiBaseUrl })
  expect(result).toBe(403)
  await expect(page.getByRole('button', { name: new RegExp(inaccessibleName) })).toHaveCount(0)
})
