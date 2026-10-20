import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import './workspace.css'
import './design-tokens.css'
import './clinic-shell.css'
import ClinicSidebar from './ClinicSidebar.js'
import PatientsPanel from './PatientsPanel.js'
import ConversationKanban from './ConversationKanban.js'
import TasksPanel from './TasksPanel.js'
import ReferralsPanel from './ReferralsPanel.js'
import PublicReferralPage from './PublicReferralPage.js'
import CalendarPage from './CalendarPage.js'
import PlatformAdminPanel from './PlatformAdminPanel.js'
import DashboardPage from './DashboardPage.js'
import InboxPatientSummary from './InboxPatientSummary.js'
import InboxConversationList from './InboxConversationList.js'
import InboxConversationPanel from './InboxConversationPanel.js'
import ReportsPage from './ReportsPage.js'
import TeamManagementPage from './TeamManagementPage.js'
import ClinicSettingsPage from './ClinicSettingsPage.js'
import PrivacyRequestsPage from './PrivacyRequestsPage.js'
import AccountSecurityPage from './AccountSecurityPage.js'
import { statusLabel } from './status-labels.js'

type Unit = { id: string; name: string; slug: string }
type Row = Record<string, unknown> & { id: string }
type Page = string
const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3002'
const ResourcesSchedulePanel = lazy(() => import('./ResourcesSchedulePanel.js'))
const CampaignsPanel = lazy(() => import('./CampaignsPanel.js'))
const pages: Page[] = ['Visão geral', 'Agenda', 'Relatórios', 'Pacientes', 'Inbox', 'Tarefas', 'Minha conta', 'Recursos', 'Uno', 'Canais', 'Campanhas', 'Indicações', 'Automações', 'IA', 'Plano', 'Equipe', 'Configurações', 'Privacidade']
const pageDescriptions: Record<string, string> = {
  'Visão geral': 'Acompanhe a rotina da clínica e acesse os módulos de atendimento.',
  Agenda: 'Consulte os horários da unidade e organize os agendamentos.',
  Pacientes: 'Encontre cadastros, etiquetas, histórico clínico e conversas.',
  Inbox: 'Leia conversas, responda pacientes e acompanhe o funil.',
  Campanhas: 'Crie mensagens para etapas do funil ou para pacientes selecionados.',
  Automações: 'Configure mensagens ligadas a agendamentos e atendimentos.',
  Tarefas: 'Acompanhe as pendências da equipe.',
  Canais: 'Consulte e configure as conexões de mensagens por unidade.',
  Recursos: 'Organize profissionais, salas e disponibilidade da agenda.',
  Relatórios: 'Consulte os indicadores da clínica e das unidades autorizadas.',
  'Minha conta': 'Atualize seus dados de acesso e segurança.',
  Uno: 'Consulte a integração e os dados sincronizados com o Uno.',
  IA: 'Configure os recursos de assistência por inteligência artificial.',
  Plano: 'Consulte o plano e o uso da clínica.',
  Equipe: 'Gerencie usuários e permissões da clínica.',
  Configurações: 'Ajuste as preferências da clínica.',
  Privacidade: 'Acompanhe as solicitações de privacidade.',
  Indicações: 'Acompanhe as indicações e os pacientes vinculados.',
}

function App() {
  const referralMatch = window.location.pathname.match(/^\/indicacao\/([^/]+)\/?$/)
  if (referralMatch) return <PublicReferralPage token={decodeURIComponent(referralMatch[1]!)} apiBaseUrl={API}/>
  return <WorkspaceApp/>
}

function WorkspaceApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem('clinic_access') ?? '')
  const [sessionReady, setSessionReady] = useState(() => !sessionStorage.getItem('clinic_access'))
  const [sessionError, setSessionError] = useState('')
  const [identity, setIdentity] = useState('')
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState('')
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [passwordUpdate, setPasswordUpdate] = useState({ current: '', next: '', confirm: '' })
  const [visiblePasswordFields, setVisiblePasswordFields] = useState({ current: false, next: false, confirm: false })
  const [units, setUnits] = useState<Unit[]>([])
  const [unitId, setUnitId] = useState('')
  const [integration, setIntegration] = useState<{ unoStatus: string; activeSource: string } | null>(null)
  const [page, setPage] = useState<Page>('Visão geral')
  const pageScrollPositions = useRef<{ previousPage: Page; positions: Record<string, number> }>({ previousPage: 'Visão geral', positions: {} })
  const [rows, setRows] = useState<Row[]>([])
  const [inboxStages, setInboxStages] = useState<{ id: string; name: string; position: number; active: boolean; campaignId: string | null; inactivityDays: number | null; campaign: { id: string; name: string; body: string; provider: string } | null }[]>([])
  const [inboxCampaigns, setInboxCampaigns] = useState<{ id: string; name: string; body: string; mode: string; status: string }[]>([])
  const [assignees, setAssignees] = useState<{ id: string; displayName: string; role: string }[]>([])
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [patients, setPatients] = useState<Row[]>([])
  const [patientRefreshKey, setPatientRefreshKey] = useState(0)
  const [taskRefreshKey, setTaskRefreshKey] = useState(0)
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0)
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0)
  const [reportsRefreshKey, setReportsRefreshKey] = useState(0)
  const [adminRefreshKey, setAdminRefreshKey] = useState(0)
  const [tenantTheme, setTenantTheme] = useState<{ accentColor?: string | null; secondaryColor?: string | null } | null>(null)
  const [openPatientId, setOpenPatientId] = useState('')
  const [calendarPatientId, setCalendarPatientId] = useState('')
  const [calendarAppointmentId, setCalendarAppointmentId] = useState('')
  const [pendingConversationId, setPendingConversationId] = useState('')
  const [referralsRefreshKey, setReferralsRefreshKey] = useState(0)
  const [selected, setSelected] = useState<Row | null>(null)
  const [messages, setMessages] = useState<Row[]>([])
  const [messagesBusy, setMessagesBusy] = useState(false)
  const [messagesError, setMessagesError] = useState('')
  const conversationLoadSequence = useRef(0)
  const [inboxView, setInboxView] = useState<'LIST' | 'KANBAN'>('LIST')
  const [inboxQuery, setInboxQuery] = useState('')
  const [inboxListFilter, setInboxListFilter] = useState('ALL')
  const [aiDrafts, setAiDrafts] = useState<Row[]>([])
  const [aiDraftError, setAiDraftError] = useState('')
  const [draftPurposes, setDraftPurposes] = useState<Record<string, string>>({})
  const [composerBody, setComposerBody] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const consumeCalendarContext = useCallback(() => { setCalendarPatientId(''); setCalendarAppointmentId('') }, [])
  const [login, setLogin] = useState({ email: '', tenantSlug: '', password: '', otp: '' })
  const accessTokenRef = useRef(token)
  const refreshInFlightRef = useRef<Promise<string | null> | null>(null)
  const visiblePages = useMemo(() => role === 'PLATFORM_SUPERADMIN' ? ['Plataforma'] : pages.filter((item) => {
    if (['Configurações', 'Privacidade'].includes(item)) return role === 'TENANT_ADMIN'
    if (item === 'Equipe') return ['TENANT_ADMIN', 'UNIT_MANAGER'].includes(role)
    if (['Canais', 'Uno', 'IA', 'Plano'].includes(item)) return role === 'TENANT_ADMIN'
    return (role === 'TENANT_ADMIN' || role === 'UNIT_MANAGER' || item === 'Campanhas' && role === 'OPERATOR' || !['Campanhas', 'Indicações', 'Automações', 'Canais', 'Recursos', 'Relatórios'].includes(item)) && (item !== 'Recursos' || ['TENANT_ADMIN', 'UNIT_MANAGER'].includes(role))
  }), [role])

  const storeAccessToken = useCallback((accessToken: string) => {
    accessTokenRef.current = accessToken
    sessionStorage.setItem('clinic_access', accessToken)
    setToken(accessToken)
  }, [])

  const clearClientSession = useCallback((message = '') => {
    accessTokenRef.current = ''
    sessionStorage.removeItem('clinic_access')
    setToken('')
    setIdentity(''); setUserId(''); setRole(''); setUnits([]); setUnitId(''); setMustChangePassword(false); setTenantTheme(null); setSessionReady(true)
    setSessionError('')
    if (message) setNotice(message)
  }, [])

  const refreshAccessToken = useCallback((): Promise<string | null> => {
    if (!refreshInFlightRef.current) {
      refreshInFlightRef.current = (async () => {
        const response = await fetch(`${API}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
        if (response.status === 401) {
          clearClientSession('Sua sessão expirou. Entre novamente para continuar.')
          return null
        }
        const data = await response.json().catch(() => null) as { accessToken?: string; message?: string | string[] } | null
        if (!response.ok || typeof data?.accessToken !== 'string') {
          const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message
          throw new Error(message || `Falha ao renovar a sessão (HTTP ${response.status}).`)
        }
        storeAccessToken(data.accessToken)
        return data.accessToken
      })().finally(() => { refreshInFlightRef.current = null })
    }
    return refreshInFlightRef.current
  }, [clearClientSession, storeAccessToken])

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
    const fetchApi = async (url: string, options: RequestInit) => {
      try { return await fetch(url, options) }
      catch { throw new Error('Não foi possível conectar à API. Verifique se o servidor está em execução e tente novamente.') }
    }
    const send = (access: string) => fetchApi(`${API}/api${path}`, { ...init, credentials: 'include', headers: { ...(!isFormData ? { 'Content-Type': 'application/json' } : {}), ...(access ? { Authorization: `Bearer ${access}` } : {}), ...init.headers } })
    const initialToken = accessTokenRef.current
    let response = await send(initialToken)
    if (response.status === 401 && path !== '/auth/refresh') {
      const authFailure = await response.clone().json().catch(() => null) as { code?: string } | null
      if (['ACCESS_TOKEN_REQUIRED', 'ACCESS_TOKEN_INVALID', 'SESSION_INVALID'].includes(String(authFailure?.code))) {
        const currentToken = accessTokenRef.current
        const freshToken = currentToken && currentToken !== initialToken ? currentToken : await refreshAccessToken()
        if (freshToken) response = await send(freshToken)
        else throw new Error('Sua sessão expirou. Entre novamente para continuar.')
      }
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null)
    if (response.status === 401 && ['ACCESS_TOKEN_REQUIRED', 'ACCESS_TOKEN_INVALID', 'SESSION_INVALID'].includes(String(data?.code))) {
      clearClientSession('Sua sessão expirou ou foi revogada. Entre novamente para continuar.')
      throw new Error('Sua sessão expirou ou foi revogada. Entre novamente para continuar.')
    }
    if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : `Falha HTTP ${response.status}`)
    return data
  }, [clearClientSession, refreshAccessToken])

  const downloadFile = useCallback(async (path: string, filename: string) => {
    const send = (access: string) => fetch(`${API}/api${path}`, { credentials: 'include', headers: access ? { Authorization: `Bearer ${access}` } : {} })
    const initialToken = accessTokenRef.current
    let response = await send(initialToken)
    if (response.status === 401) {
      const authFailure = await response.clone().json().catch(() => null) as { code?: string } | null
      if (['ACCESS_TOKEN_REQUIRED', 'ACCESS_TOKEN_INVALID', 'SESSION_INVALID'].includes(String(authFailure?.code))) {
        const currentToken = accessTokenRef.current
        const freshToken = currentToken && currentToken !== initialToken ? currentToken : await refreshAccessToken()
        if (freshToken) response = await send(freshToken)
        else throw new Error('Sua sessão expirou. Entre novamente para continuar.')
      }
    }
    if (!response.ok) { const data = await response.json().catch(() => null); if (response.status === 401 && ['ACCESS_TOKEN_REQUIRED', 'ACCESS_TOKEN_INVALID', 'SESSION_INVALID'].includes(String(data?.code))) clearClientSession('Sua sessão expirou ou foi revogada. Entre novamente para continuar.'); throw new Error(typeof data?.message === 'string' ? data.message : `Falha HTTP ${response.status}`) }
    const objectUrl = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(objectUrl)
  }, [clearClientSession, refreshAccessToken])

  const loadSession = useCallback(async () => {
    if (!token) { setSessionReady(true); return }
    setSessionError('')
    setSessionReady(false)
    try {
      const me = await request('/auth/me')
      const nextRole = me.memberships?.[0]?.role ?? ''
      const pendingPasswordChange = nextRole !== 'PLATFORM_SUPERADMIN' && Boolean(me.mustChangePassword)
      const availableUnits = pendingPasswordChange || nextRole === 'PLATFORM_SUPERADMIN' ? [] : await request('/units')
      setIdentity(me.displayName); setUserId(me.id); setRole(nextRole); setUnits(availableUnits); setUnitId((current) => availableUnits.some((unit: Row) => unit.id === current) ? current : availableUnits[0]?.id || ''); setMustChangePassword(pendingPasswordChange)
      if (nextRole === 'PLATFORM_SUPERADMIN') setPage('Plataforma')
    } catch (cause) {
      if (accessTokenRef.current) setSessionError(cause instanceof Error ? cause.message : 'Não foi possível validar o acesso. Tente novamente.')
    }
    finally { setSessionReady(true) }
  }, [clearClientSession, request, token])

  useEffect(() => { void loadSession() }, [loadSession])
  useEffect(() => {
    if (role && page !== 'Plataforma' && !visiblePages.includes(page)) setPage(visiblePages[0] ?? 'Visão geral')
  }, [role, page, visiblePages])
  useEffect(() => { setNotice('') }, [page])
  useEffect(() => {
    if (!token || !role || role === 'PLATFORM_SUPERADMIN' || mustChangePassword) { setTenantTheme(null); return }
    let current = true
    request('/settings/tenant').then((result) => { if (current) setTenantTheme(result.tenant ?? null) }).catch(() => { if (current) setTenantTheme(null) })
    return () => { current = false }
  }, [token, role, request, mustChangePassword])
  useEffect(() => {
    const root = document.documentElement
    const setSafe = (name: string, value: string | null | undefined) => {
      if (value && /^#[0-9a-f]{6}$/i.test(value)) root.style.setProperty(name, value)
      else root.style.removeProperty(name)
    }
    setSafe('--tenant-accent', tenantTheme?.accentColor)
    setSafe('--tenant-secondary', tenantTheme?.secondaryColor)
  }, [tenantTheme])
  useEffect(() => {
    const state = pageScrollPositions.current
    state.positions[state.previousPage] = window.scrollY
    state.previousPage = page
    window.scrollTo(0, state.positions[page] ?? 0)
  }, [page])
  useEffect(() => {
    if (!token) {
      void fetch(`${API}/api/auth/refresh`, { method: 'POST', credentials: 'include' }).then(async (response) => {
        if (!response.ok) return
        const result = await response.json() as { accessToken: string }
        storeAccessToken(result.accessToken); setSessionReady(false)
      }).catch(() => undefined)
    }
  }, [storeAccessToken, token])
  useEffect(() => {
    if (!token || mustChangePassword || !sessionReady) return
    if (page === 'IA' || page === 'Plano' || page === 'Plataforma' || page === 'Tarefas' || page === 'Minha conta' || page === 'Canais' || page === 'Indicações' || page === 'Agenda' || page === 'Recursos' || page === 'Relatórios' || page === 'Visão geral' || page === 'Equipe' || page === 'Configurações' || page === 'Privacidade') return
    if (page === 'Pacientes') return
    let path = '/appointments'
    if (page === 'Inbox') path = '/inbox/conversations' + (unitId ? `?unitId=${encodeURIComponent(unitId)}` : '') + (assigneeFilter ? `${unitId ? '&' : '?'}assigneeId=${encodeURIComponent(assigneeFilter)}` : '')
    if (page === 'Campanhas') path = '/campaigns'
    if (page === 'Automações') path = '/automations'
    setBusy(true); request(path).then(setRows).catch((error: Error) => setNotice(error.message)).finally(() => setBusy(false))
    if (page === 'Inbox') {
      const query = unitId ? `?unitId=${encodeURIComponent(unitId)}` : ''
      Promise.all([request('/inbox/stages'), request('/inbox/assignees' + query), request('/campaigns')]).then(([nextStages, nextAssignees, nextCampaigns]) => { setInboxStages(nextStages); setAssignees(nextAssignees); setInboxCampaigns(nextCampaigns) }).catch((error: Error) => setNotice(error.message))
    }
    if (page === 'Agenda' || page === 'Inbox') request('/patients?page=1&pageSize=100&status=ACTIVE').then((data: { items: Row[] }) => setPatients(data.items)).catch((error: Error) => setNotice(error.message))
    setSelected(null); setMessages([])
  }, [page, token, request, unitId, assigneeFilter, mustChangePassword, sessionReady])
  useEffect(() => {
    if (!token || !sessionReady || mustChangePassword || !unitId || role === 'PLATFORM_SUPERADMIN' || !units.some((unit) => unit.id === unitId)) { setIntegration(null); return }
    let active = true
    request(`/integrations/uno/${unitId}/status`).then((result) => { if (active) setIntegration(result) }).catch(() => { if (active) setIntegration(null) })
    return () => { active = false }
  }, [token, sessionReady, mustChangePassword, unitId, units, role, request])

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice('')
    const platformSlug = import.meta.env.VITE_PLATFORM_TENANT_SLUG ?? 'essencial-platform'
    const otp = login.tenantSlug.toLowerCase() === platformSlug.toLowerCase() ? login.otp : ''
    try { const result = await request('/auth/login', { method: 'POST', body: JSON.stringify({ ...login, otp }) }); storeAccessToken(result.accessToken); setLogin((current) => ({ ...current, password: '' })); setSessionReady(false); setNotice('Acesso iniciado.') }
    catch (error) { setNotice((error as Error).message) }
  }
  async function changePasswordFromPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    if (passwordUpdate.next !== passwordUpdate.confirm) { setNotice('A confirmação não coincide com a nova senha.'); return }
    if (passwordUpdate.next === passwordUpdate.current) { setNotice('A nova senha deve ser diferente da senha provisória.'); return }
    setBusy(true)
    try {
      await request('/auth/password', { method: 'PATCH', body: JSON.stringify({ currentPassword: passwordUpdate.current, newPassword: passwordUpdate.next }) })
      setPasswordUpdate({ current: '', next: '', confirm: '' })
      setMustChangePassword(false)
      await loadSession()
      setNotice('Senha atualizada. Acesso liberado.')
    } catch (error) { setNotice((error as Error).message) }
    finally { setBusy(false) }
  }
  async function logout() { try { await request('/auth/logout', { method: 'POST' }) } finally { clearClientSession() } }
  async function reload() {
    if (page === 'Relatórios') { setReportsRefreshKey((value) => value + 1); return }
    if (page === 'Equipe' || page === 'Configurações' || page === 'Privacidade') { setAdminRefreshKey((value) => value + 1); return }
    if (page === 'IA' || page === 'Plano') return
    if (page === 'Visão geral') { setDashboardRefreshKey((value) => value + 1); return }
    if (page === 'Agenda') { setCalendarRefreshKey((value) => value + 1); return }
    if (page === 'Pacientes') { setPatientRefreshKey((value) => value + 1); return }
    if (page === 'Tarefas') { setTaskRefreshKey((value) => value + 1); return }
    if (page === 'Recursos') { setCalendarRefreshKey((value) => value + 1); return }
    if (page === 'Indicações') { setReferralsRefreshKey((value) => value + 1); return }
    let path = page === 'Inbox' ? '/inbox/conversations' + (unitId ? `?unitId=${encodeURIComponent(unitId)}` : '') + (assigneeFilter ? `${unitId ? '&' : '?'}assigneeId=${encodeURIComponent(assigneeFilter)}` : '') : page === 'Campanhas' ? '/campaigns' : page === 'Automações' ? '/automations' : '/appointments'
    if (page === 'Agenda') path += `?from=${encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 30 * 86400000).toISOString())}`
    setRows(await request(path))
  }
  async function moveConversation(id: string, status: string) {
    try {
      await request(`/inbox/conversations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      setNotice('Etapa da conversa atualizada e auditada.')
      await reload()
    } catch (error) { setNotice((error as Error).message) }
  }
  async function moveConversationStage(id: string, stageId: string, enrollCampaign?: boolean) { try { await request(`/inbox/conversations/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stageId, ...(enrollCampaign === undefined ? {} : { enrollCampaign }) }) }); const days = inboxStages.find((stage) => stage.id === stageId)?.inactivityDays; setNotice(enrollCampaign ? days === 0 ? 'Paciente incluído. A mensagem será avaliada ao entrar na etapa, respeitando conversa ativa, consentimento e limite de contato.' : 'Paciente incluído no acompanhamento. A mensagem será avaliada após o prazo sem resposta.' : 'Etapa do funil atualizada.'); await reload() } catch (error) { setNotice((error as Error).message) } }
  async function claimConversation(id: string) { try { await request(`/inbox/conversations/${id}/claim`, { method: 'POST' }); setNotice('Conversa assumida.'); await reload() } catch (error) { setNotice((error as Error).message) } }
  async function assignConversation(id: string, assigneeId: string | null) { try { await request(`/inbox/conversations/${id}/assignment`, { method: 'PATCH', body: JSON.stringify({ assigneeId }) }); setNotice(assigneeId ? 'Conversa atribuída/transferida.' : 'Conversa liberada para a fila compartilhada.'); await reload() } catch (error) { setNotice((error as Error).message) } }
  async function createConversationStage(data: { name: string; position: number; campaignId: string | null; inactivityDays: number | null }) { try { await request('/inbox/stages', { method: 'POST', body: JSON.stringify(data) }); setInboxStages(await request('/inbox/stages')); setNotice('Etapa criada para esta clínica.') } catch (error) { setNotice((error as Error).message) } }
  async function updateConversationStage(id: string, data: Record<string, unknown>) { try { await request(`/inbox/stages/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); setInboxStages(await request('/inbox/stages')); await reload() } catch (error) { setNotice((error as Error).message) } }
  const selectConversation = useCallback(async (row: Row) => {
    const sequence = ++conversationLoadSequence.current
    setSelected(row); setMessages([]); setAiDrafts([]); setMessagesError(''); setMessagesBusy(true)
    try {
      const [history, drafts] = await Promise.all([request(`/inbox/conversations/${row.id}/messages`), request(`/ai/conversations/${row.id}/drafts`)])
      if (sequence === conversationLoadSequence.current) { setMessages(history); setAiDrafts(drafts) }
    } catch (error) { if (sequence === conversationLoadSequence.current) setMessagesError((error as Error).message) }
    finally { if (sequence === conversationLoadSequence.current) setMessagesBusy(false) }
  }, [request])
  useEffect(() => {
    if (page !== 'Inbox' || !pendingConversationId) return
    const conversation = rows.find((row) => row.id === pendingConversationId)
    if (!conversation) return
    setPendingConversationId('')
    void selectConversation(conversation)
  }, [page, rows, pendingConversationId, selectConversation])
  async function generateAiDraft() { if (!selected) return; setAiDraftError(''); try { const draft = await request(`/ai/conversations/${selected.id}/drafts`, { method: 'POST' }); setAiDrafts((items) => [draft, ...items]); setNotice('Rascunho de IA criado. Revise antes de aprovar; nenhuma mensagem foi enviada.') } catch (error) { const message = (error as Error).message; setAiDraftError(/não está configurada com autorização/i.test(message) ? 'A geração de rascunhos está indisponível porque a IA ainda não foi configurada e autorizada pela clínica.' : message) } }
  async function reviewAiDraft(draftId: string, approved: boolean, purpose?: string) { try { const result = await request(`/ai/drafts/${draftId}/${approved ? 'approve' : 'reject'}`, { method: 'POST', body: approved ? JSON.stringify({ purpose }) : undefined }); setAiDrafts((items) => items.map((draft) => draft.id === draftId ? { ...draft, status: approved ? 'APPROVED' : 'REJECTED' } : draft)); if (approved && result.message) setMessages((items) => [...items, result.message]); setNotice(approved ? 'Rascunho aprovado e registrado na fila lógica. Envio externo continua desligado.' : 'Rascunho rejeitado.') } catch (error) { setNotice((error as Error).message) } }
  async function createConversation(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); try { await request('/inbox/conversations', { method: 'POST', body: JSON.stringify({ unitId, patientId: data.get('patientId') }) }); setNotice('Conversa aberta.'); await reload() } catch (error) { setNotice((error as Error).message) } }
  async function sendDraft(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selected) return; const data = new FormData(event.currentTarget); try { const message = await request(`/inbox/conversations/${selected.id}/messages`, { method: 'POST', body: JSON.stringify({ body: composerBody, purpose: data.get('purpose'), actor: 'HUMAN' }) }); setMessages((current) => [...current, message]); setComposerBody(''); setNotice('Resposta registrada na fila local. Nenhuma mensagem foi enviada pelo WhatsApp.') } catch (error) { setNotice((error as Error).message) } }

  if (!token) return <main className="login-page"><form className="login-card" onSubmit={submitLogin}><div className="brand"><b>e</b><span>essencial<small>CLÍNICAS</small></span></div><h1>Entrar na plataforma</h1><p>Use o e-mail e o identificador da sua clínica.</p><label>E-mail<input required type="email" name="email" autoComplete="username" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} /></label><label>Clínica (slug)<input required name="tenantSlug" autoComplete="organization" value={login.tenantSlug} onChange={(e) => setLogin({ ...login, tenantSlug: e.target.value })} /></label><label>Senha<input required type="password" name="password" autoComplete="current-password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} /></label>{login.tenantSlug.toLowerCase() === "essencial-platform" && <label>Código MFA do Superadmin<input name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={login.otp} onChange={(e) => setLogin({ ...login, otp: e.target.value.replace(/\D/g, "").slice(0, 6) })}/></label>}<button className="primary">Entrar</button>{notice && <div className="notice" role="status" aria-live="polite">{notice}</div>}</form></main>

  if (token && !sessionReady) return <main className="session-loading" role="status">Validando sessao segura...</main>
  if (token && sessionError && !role) return <main className="login-page"><section className="login-card" role="alert"><div className="brand"><b>e</b><span>essencial<small>CLÍNICAS</small></span></div><h1>Não foi possível validar o acesso</h1><p>{sessionError}</p><button type="button" className="primary" onClick={() => void loadSession()}>Tentar novamente</button><button type="button" onClick={logout}>Sair</button></section></main>
  if (mustChangePassword) return <main className="login-page"><section className="login-card" aria-labelledby="initial-password-title"><div className="brand"><b>e</b><span>essencial<small>CLÍNICAS</small></span></div><h1 id="initial-password-title">Defina sua nova senha</h1><p>Por segurança, você precisa alterar a senha provisória fornecida pelo administrador antes de continuar.</p><form className="initial-password-form" onSubmit={(event) => void changePasswordFromPrompt(event)}><div className="initial-password-field"><label htmlFor="temporary-password">Senha provisória atual</label><div className="initial-password-control"><input id="temporary-password" required type={visiblePasswordFields.current ? 'text' : 'password'} autoComplete="current-password" value={passwordUpdate.current} onChange={(event) => setPasswordUpdate({ ...passwordUpdate, current: event.target.value })}/><button type="button" aria-label={visiblePasswordFields.current ? 'Ocultar senha provisória' : 'Mostrar senha provisória'} onClick={() => setVisiblePasswordFields({ ...visiblePasswordFields, current: !visiblePasswordFields.current })}>{visiblePasswordFields.current ? 'Ocultar' : 'Mostrar'}</button></div></div><div className="initial-password-field"><label htmlFor="new-password">Nova senha</label><div className="initial-password-control"><input id="new-password" required type={visiblePasswordFields.next ? 'text' : 'password'} minLength={8} maxLength={72} autoComplete="new-password" aria-describedby="password-requirements" value={passwordUpdate.next} onChange={(event) => setPasswordUpdate({ ...passwordUpdate, next: event.target.value })}/><button type="button" aria-label={visiblePasswordFields.next ? 'Ocultar nova senha' : 'Mostrar nova senha'} onClick={() => setVisiblePasswordFields({ ...visiblePasswordFields, next: !visiblePasswordFields.next })}>{visiblePasswordFields.next ? 'Ocultar' : 'Mostrar'}</button></div><small id="password-requirements">Use pelo menos 8 caracteres. A senha deve ser diferente da provisória.</small></div><div className="initial-password-field"><label htmlFor="confirm-password">Confirmar nova senha</label><div className="initial-password-control"><input id="confirm-password" required type={visiblePasswordFields.confirm ? 'text' : 'password'} minLength={8} maxLength={72} autoComplete="new-password" value={passwordUpdate.confirm} onChange={(event) => setPasswordUpdate({ ...passwordUpdate, confirm: event.target.value })}/><button type="button" aria-label={visiblePasswordFields.confirm ? 'Ocultar confirmação' : 'Mostrar confirmação'} onClick={() => setVisiblePasswordFields({ ...visiblePasswordFields, confirm: !visiblePasswordFields.confirm })}>{visiblePasswordFields.confirm ? 'Ocultar' : 'Mostrar'}</button></div></div><button className="primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha e continuar'}</button></form>{notice && <div className="notice" role="alert" aria-live="assertive">{notice}</div>}<button type="button" className="link-button" onClick={() => void logout()}>Sair</button></section></main>
  if (role === 'PLATFORM_SUPERADMIN') return <PlatformAdminPanel request={request} setNotice={setNotice} identity={identity} onLogout={() => void logout()}/>
  return <div className="layout"><ClinicSidebar pages={visiblePages} activePage={page} identity={identity} unitName={units.find((unit) => unit.id === unitId)?.name ?? ""} integration={integration} onNavigate={setPage} onLogout={() => void logout()}/>
    <main className="workspace"><header className="clinic-topbar"><span>Clínica <i>/</i> {page}</span><div className="header-tools"><select aria-label="Unidade" value={unitId} onChange={(e) => setUnitId(e.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></div></header><section className="content"><div className="clinic-page-header"><div className="clinic-page-header-copy"><h1>{page}</h1><p>{pageDescriptions[page]}</p></div>{!['IA', 'Plano'].includes(page) && <button type="button" className="primary clinic-page-refresh" disabled={busy} onClick={() => void reload()}>{busy ? 'Atualizando…' : 'Atualizar'}</button>}</div>{page === 'Inbox' && <section className="inbox-workflow" aria-label="Como atender uma conversa"><div><b>Como atender</b><ol><li>Escolha uma conversa na lista.</li><li>Leia o histórico e registre a resposta.</li><li>Consulte o paciente e agende, se necessário.</li></ol></div><p>Nesta etapa, as respostas são registradas na fila e não são enviadas pelo WhatsApp.</p></section>}{sessionError && role && <div className="calendar-error" role="alert">{sessionError}<button type="button" onClick={() => void loadSession()}>Tentar novamente</button></div>}{notice && <div className="notice" role="status" aria-live="polite" aria-atomic="true">{notice}<button aria-label="Fechar aviso" onClick={() => setNotice('')}>×</button></div>}
      {page === 'Visão geral' && <DashboardPage request={request} unitId={unitId} availablePages={visiblePages} onNavigate={setPage} onNewAppointment={() => setPage('Agenda')} refreshKey={dashboardRefreshKey}/>}
      {page === 'Relatórios' && <ReportsPage request={request} download={downloadFile} units={units} unitId={unitId} role={role} userId={userId} refreshKey={reportsRefreshKey} onNavigate={setPage}/>}

      {page === 'Agenda' && <CalendarPage request={request} units={units} unitId={unitId} role={role} setNotice={setNotice} onOpenPatient={(id) => { setOpenPatientId(id); setPage('Pacientes') }} initialPatientId={calendarPatientId} initialAppointmentId={calendarAppointmentId} onContextConsumed={consumeCalendarContext} refreshKey={calendarRefreshKey}/>}
      {page === 'Recursos' && <Suspense fallback={<p className="calendar-state" role="status">Carregando configurações da unidade…</p>}><ResourcesSchedulePanel key={`${unitId}:${calendarRefreshKey}`} request={request} units={units} unitId={unitId} setNotice={setNotice}/></Suspense>}
      {page === 'Pacientes' && <PatientsPanel request={request} units={units} role={role} refreshKey={patientRefreshKey} setNotice={setNotice} initialPatientId={openPatientId} onInitialPatientOpened={() => setOpenPatientId('')} onOpenConversation={(id) => { setRows([]); setPendingConversationId(id); setPage('Inbox') }} onOpenAppointment={(id) => { setCalendarAppointmentId(id); setPage('Agenda') }}/>}
      {page === 'Inbox' && <>
        <div className="inbox-mode-switch"><div className="inbox-toolbar" role="group" aria-label="Modo de visualização dos atendimentos"><button type="button" className={inboxView === 'LIST' ? 'active' : ''} aria-pressed={inboxView === 'LIST'} onClick={() => setInboxView('LIST')}>Conversas</button><button type="button" className={inboxView === 'KANBAN' ? 'active' : ''} aria-pressed={inboxView === 'KANBAN'} onClick={() => setInboxView('KANBAN')}>Quadro</button></div><p className="inbox-view-description">{inboxView === 'LIST' ? 'Leia e responda conversas.' : 'Organize por estado ou etapa.'}</p></div>
        {inboxView === 'KANBAN' ? <ConversationKanban rows={rows} stages={inboxStages} campaigns={inboxCampaigns} assignees={assignees} userId={userId} isAdmin={role === 'TENANT_ADMIN'} assigneeFilter={assigneeFilter} onAssigneeFilter={setAssigneeFilter} onSelect={(row) => void selectConversation(row)} onMove={(id, status) => void moveConversation(id, status)} onMoveStage={(id, stageId, enrollCampaign) => void moveConversationStage(id, stageId, enrollCampaign)} onClaim={(id) => void claimConversation(id)} onAssign={(id, assigneeId) => void assignConversation(id, assigneeId)} onCreateStage={(data) => void createConversationStage(data)} onUpdateStage={(id, data) => void updateConversationStage(id, data)} onOpenCampaigns={() => setPage('Campanhas')}/> :
          <div className={`inbox-grid ${selected && Boolean(selected.patient) ? 'has-patient-context' : ''}`}>
            <InboxConversationList rows={rows} patients={patients} selectedId={selected?.id} userId={userId} query={inboxQuery} filter={inboxListFilter} onQueryChange={setInboxQuery} onFilterChange={setInboxListFilter} onSelect={(row) => void selectConversation(row)} onCreate={createConversation}/>
            <InboxConversationPanel selected={selected} messages={messages} drafts={aiDrafts} draftPurposes={draftPurposes} loading={messagesBusy} error={messagesError} aiDraftError={aiDraftError} setDraftPurpose={(id, purpose) => setDraftPurposes((current) => ({ ...current, [id]: purpose }))} composerBody={composerBody} setComposerBody={setComposerBody} onGenerateDraft={() => void generateAiDraft()} onReviewDraft={(id, approved, purpose) => void reviewAiDraft(id, approved, purpose)} onSendDraft={sendDraft} quickReplies={selected ? <QuickRepliesPanel request={request} conversationId={selected.id} role={role} onInsert={(body) => setComposerBody((current) => current ? `${current}\n${body}` : body)}/> : null} patientSummary={selected && Boolean(selected.patient) ? <InboxPatientSummary request={request} patientId={String((selected.patient as Row).id)} conversationId={selected.id} unitId={unitId} onTaskCreated={() => { setTaskRefreshKey((value) => value + 1); setNotice('Tarefa vinculada à conversa e enviada à central de tarefas.') }} onOpenPatient={(id) => { setOpenPatientId(id); setPage('Pacientes') }} onOpenCalendar={(id) => { setCalendarPatientId(id); setPage('Agenda') }} onOpenAppointment={(id) => { setCalendarAppointmentId(id); setPage('Agenda') }}/> : null}/>
          </div>}
      </>}
      {page === 'Tarefas' && <TasksPanel request={request} unitId={unitId} userId={userId} role={role} refreshKey={taskRefreshKey} setNotice={setNotice} onOpenConversation={(id) => { setRows([]); setPendingConversationId(id); setPage('Inbox') }} onOpenPatient={(id) => { setOpenPatientId(id); setPage('Pacientes') }} onOpenAppointment={(id) => { setCalendarAppointmentId(id); setPage('Agenda') }}/>}
      {page === 'Minha conta' && <AccountSecurityPage request={request} setNotice={setNotice}/>}
      {page === 'Uno' && <UnoPanel unitId={unitId} request={request} setNotice={setNotice}/>}
      {page === 'Canais' && <MessagingConnectionsPanel unitId={unitId} units={units} request={request} setNotice={setNotice}/>}
      {page === 'IA' && <AiPanel request={request} setNotice={setNotice}/>}
      {page === 'Plano' && <UsagePanel request={request}/>}
      {page === 'Equipe' && <TeamManagementPage request={request} units={units} role={role} userId={userId} setNotice={setNotice} refreshKey={adminRefreshKey}/>}
      {page === 'Configurações' && <ClinicSettingsPage request={request} setNotice={setNotice} onThemeUpdated={(clinic) => setTenantTheme(clinic)} onNavigate={setPage} refreshKey={adminRefreshKey}/>}
      {page === 'Privacidade' && <PrivacyRequestsPage request={request} setNotice={setNotice}/>}
      {page === 'Indicações' && <ReferralsPanel request={request} units={units} setNotice={setNotice} refreshKey={referralsRefreshKey}/>}
      {page === 'Campanhas' && <Suspense fallback={<p className="calendar-state" role="status">Carregando campanhas…</p>}><CampaignsPanel rows={rows} request={request} onRefresh={reload} setNotice={setNotice} onOpenInbox={() => { setInboxView('KANBAN'); setPage('Inbox') }}/></Suspense>}
      {page === 'Automações' && <AutomationsPanel key={`${unitId}:${userId}`} unitId={unitId} units={units} userId={userId} request={request} setNotice={setNotice}/>}
      </section></main></div>
}

function AutomationsPanel({ unitId, units, userId, request, setNotice }: { unitId: string; units: Unit[]; userId: string; request: (path: string, init?: RequestInit) => Promise<any>; setNotice: (message: string) => void }) {
  const [items, setItems] = useState<Row[]>([])
  const [procedures, setProcedures] = useState<Row[]>([])
  const [automationTags, setAutomationTags] = useState<Row[]>([])
  const [automationAssignees, setAutomationAssignees] = useState<Array<{ id: string; displayName: string }>>([])
  const [procedureForm, setProcedureForm] = useState({ id: '', name: '', unitId: '', appointmentDurationMinutes: 30, returnAfterDays: 10, reminderAdvanceDays: 2 })
  const [selectedId, setSelectedId] = useState('')
  const [history, setHistory] = useState<Row[]>([])
  const [results, setResults] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    name: '', trigger: 'APPOINTMENT_CONFIRMATION', unitId, procedureId: '', advanceMinutes: 1440, targetTagId: '', steps: [{ id: String(crypto.randomUUID()), delayMinutes: 0, body: '' }],
    returnAfterDays: 10, reminderAdvanceDays: 2, responseWindowHours: 72, maxContactsPerPatient: 2,
    allowedDaysOfWeek: '1,2,3,4,5', interestKeywords: 'TENHO INTERESSE,QUERO RETORNAR', returnKeywords: 'AGENDAR,REAGENDAR', noContactKeywords: 'NAO QUERO CONTATO,PARAR RETORNOS',
    allowedStartHour: 8, allowedEndHour: 20, provider: 'META_CLOUD', connectionId: '',
    body: 'Olá {{paciente.nome}}, confirme seu agendamento respondendo CONFIRMAR.',
    confirmKeywords: 'CONFIRMAR', rescheduleKeywords: 'REAGENDAR', humanKeywords: 'ATENDENTE,HUMANO',
    opening: 'Olá {{paciente.nome}}!', question: 'Como você classifica sua experiência?',
    version: 1,
    thankExcellent: 'Muito obrigado por compartilhar sua experiência!', thankGood: 'Obrigado por avaliar sua experiência!',
    thankRegular: 'Obrigado por contar como foi sua experiência.', thankPoor: 'Obrigado por nos avisar. Nossa equipe vai acompanhar seu relato.',
    thankVeryPoor: 'Obrigado por nos avisar. Nossa equipe vai acompanhar seu relato.', regularAction: 'NONE', noResponseAction: 'NONE', responsibleUserId: userId,
  })
  const load = useCallback(async () => { const [rules, catalog, tags] = await Promise.all([request('/automations'), request('/procedures'), request('/patients/tags')]); setItems(rules); setProcedures(catalog); setAutomationTags(tags) }, [request])
  useEffect(() => { void load().catch((cause: Error) => setError(cause.message)) }, [load])
  useEffect(() => { request(`/inbox/assignees?unitId=${encodeURIComponent(form.unitId || unitId)}`).then(setAutomationAssignees).catch(() => setAutomationAssignees([])) }, [request, unitId, form.unitId])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true)
    const common = { unitId: form.unitId, procedureId: form.procedureId || null, advanceMinutes: Number(form.advanceMinutes), allowedStartHour: Number(form.allowedStartHour), allowedEndHour: Number(form.allowedEndHour), provider: form.provider, connectionId: form.connectionId || null, responsibleUserId: form.responsibleUserId }
    const configuration = form.trigger === 'POST_CARE_TAG_FLOW'
      ? { ...common, procedureId: null, advanceMinutes: 0, targetTagId: form.targetTagId || null, steps: form.steps.map((step) => ({ ...step, delayMinutes: Number(step.delayMinutes) })) }
      : form.trigger === 'PROCEDURE_RETURN'
      ? { ...common, procedureId: form.procedureId, body: form.body, responseWindowHours: Number(form.responseWindowHours), maxContactsPerPatient: Number(form.maxContactsPerPatient), allowedDaysOfWeek: form.allowedDaysOfWeek.split(',').map((x) => Number(x.trim())), interestKeywords: form.interestKeywords.split(',').map((x) => x.trim()).filter(Boolean), rescheduleKeywords: form.returnKeywords.split(',').map((x) => x.trim()).filter(Boolean), noContactKeywords: form.noContactKeywords.split(',').map((x) => x.trim()).filter(Boolean), noResponseAction: form.noResponseAction }
      : form.trigger === 'POST_CARE_SATISFACTION'
      ? { ...common, opening: form.opening, question: form.question, responseWindowHours: Number(form.responseWindowHours), version: Number(form.version), regularAction: form.regularAction, noResponseAction: form.noResponseAction, thankYou: { EXCELLENT: form.thankExcellent, GOOD: form.thankGood, REGULAR: form.thankRegular, POOR: form.thankPoor, VERY_POOR: form.thankVeryPoor } }
      : { ...common, body: form.body, confirmKeywords: form.confirmKeywords.split(',').map((x) => x.trim()).filter(Boolean), rescheduleKeywords: form.rescheduleKeywords.split(',').map((x) => x.trim()).filter(Boolean), humanKeywords: form.humanKeywords.split(',').map((x) => x.trim()).filter(Boolean), noResponseAction: form.noResponseAction }
    try {
      if (selectedId) await request(`/automations/${selectedId}`, { method: 'PATCH', body: JSON.stringify({ name: form.name, configuration }) })
      else await request('/automations', { method: 'POST', body: JSON.stringify({ name: form.name, trigger: form.trigger, configuration }) })
      setSelectedId(''); setHistory([]); setResults(null); setNotice('Regra salva inativa. Revise e ative quando estiver pronta.'); await load()
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  async function choose(item: Row) {
    const config = (item.configuration ?? {}) as Record<string, any>
    setSelectedId(item.id); setResults(null)
    setForm((current) => ({ ...current, name: String(item.name), trigger: String(item.trigger), unitId: String(config.unitId ?? unitId), procedureId: String(config.procedureId ?? ''), targetTagId: String(config.targetTagId ?? ''), steps: Array.isArray(config.steps) && config.steps.length ? config.steps.map((step: any) => ({ id: String(step.id), delayMinutes: Number(step.delayMinutes), body: String(step.body) })) : current.steps, advanceMinutes: Number(config.advanceMinutes ?? 1440), allowedStartHour: Number(config.allowedStartHour ?? 8), allowedEndHour: Number(config.allowedEndHour ?? 20), provider: String(config.provider ?? 'META_CLOUD'), connectionId: String(config.connectionId ?? ''), body: String(config.body ?? current.body), returnAfterDays: Number(config.returnAfterDays ?? 10), reminderAdvanceDays: Number(config.reminderAdvanceDays ?? 2), maxContactsPerPatient: Number(config.maxContactsPerPatient ?? 2), allowedDaysOfWeek: (config.allowedDaysOfWeek ?? [1,2,3,4,5]).join(','), interestKeywords: (config.interestKeywords ?? ['TENHO INTERESSE','QUERO RETORNAR']).join(','), returnKeywords: (config.rescheduleKeywords ?? ['AGENDAR','REAGENDAR']).join(','), noContactKeywords: (config.noContactKeywords ?? ['NAO QUERO CONTATO','PARAR RETORNOS']).join(','), confirmKeywords: (config.confirmKeywords ?? ['CONFIRMAR']).join(','), rescheduleKeywords: (config.rescheduleKeywords ?? ['REAGENDAR']).join(','), humanKeywords: (config.humanKeywords ?? ['ATENDENTE', 'HUMANO']).join(','), opening: String(config.opening ?? current.opening), question: String(config.question ?? current.question), responseWindowHours: Number(config.responseWindowHours ?? 24), version: Number(config.version ?? 1), thankExcellent: String(config.thankYou?.EXCELLENT ?? current.thankExcellent), thankGood: String(config.thankYou?.GOOD ?? current.thankGood), thankRegular: String(config.thankYou?.REGULAR ?? current.thankRegular), thankPoor: String(config.thankYou?.POOR ?? current.thankPoor), thankVeryPoor: String(config.thankYou?.VERY_POOR ?? current.thankVeryPoor), regularAction: String(config.regularAction ?? 'NONE'), noResponseAction: String(config.noResponseAction ?? 'NONE'), responsibleUserId: String(config.responsibleUserId ?? userId) }))
    try {
      setHistory(await request(`/automations/${item.id}/executions`))
      if (item.trigger === 'POST_CARE_SATISFACTION') setResults(await request(`/automations/${item.id}/satisfaction-results`))
    } catch (cause) { setError((cause as Error).message) }
  }
  async function setStatus(item: Row) {
    try { const status = item.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'; await request(`/automations/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setNotice(status === 'ACTIVE' ? 'Regra ativada; as execuções locais permanecem em modo de simulação.' : 'Regra pausada; as execuções e mensagens pendentes foram canceladas.'); await load() }
    catch (cause) { setError((cause as Error).message) }
  }
  const set = (key: string, value: string | number) => setForm((current) => ({ ...current, [key]: value }))
  return <div className="module-form stacked automation-workspace"><h2>Automações</h2><p>Confirmações e pesquisas de satisfação usam uma fila única de mensagens. Nesta etapa, toda execução é apenas simulada e nenhuma mensagem é enviada externamente.</p>
    <section className="module-form stacked"><h3>Catálogo de procedimentos</h3><p>Duração em minutos é para agenda; prazo de retorno e antecedência são dias estimados configurados pela clínica.</p>
      <label>Procedimento<select value={procedureForm.id} onChange={(e) => { const p = procedures.find((x) => x.id === e.target.value); setProcedureForm(p ? { id: String(p.id), name: String(p.name), unitId: String(p.unitId ?? ''), appointmentDurationMinutes: Number(p.appointmentDurationMinutes), returnAfterDays: Number(p.returnAfterDays ?? 10), reminderAdvanceDays: Number(p.reminderAdvanceDays ?? 2) } : { id: '', name: '', unitId: '', appointmentDurationMinutes: 30, returnAfterDays: 10, reminderAdvanceDays: 2 }); if (p) set('procedureId', String(p.id)) }}><option value="">Novo procedimento</option>{procedures.map((p) => <option key={p.id} value={p.id}>{String(p.name)}</option>)}</select></label>
      <label>Nome<input value={procedureForm.name} onChange={(e) => setProcedureForm((p) => ({ ...p, name: e.target.value }))}/></label><label>Unidade<select value={procedureForm.unitId} onChange={(e) => setProcedureForm((p) => ({ ...p, unitId: e.target.value }))}><option value="">Compartilhado</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label>Duração na agenda (minutos)<input type="number" min="5" max="1440" value={procedureForm.appointmentDurationMinutes} onChange={(e) => setProcedureForm((p) => ({ ...p, appointmentDurationMinutes: Number(e.target.value) }))}/></label><label>Efeito estimado (dias)<input type="number" min="1" max="3650" value={procedureForm.returnAfterDays} onChange={(e) => setProcedureForm((p) => ({ ...p, returnAfterDays: Number(e.target.value) }))}/></label><label>Antecedência do contato (dias)<input type="number" min="0" max={procedureForm.returnAfterDays} value={procedureForm.reminderAdvanceDays} onChange={(e) => setProcedureForm((p) => ({ ...p, reminderAdvanceDays: Number(e.target.value) }))}/></label>
      <button type="button" onClick={async () => { try { const saved = procedureForm.id ? await request(`/procedures/${procedureForm.id}`, { method: 'PATCH', body: JSON.stringify(procedureForm) }) : await request('/procedures', { method: 'POST', body: JSON.stringify(procedureForm) }); setProcedureForm((p) => ({ ...p, id: String(saved.id) })); set('procedureId', String(saved.id)); setNotice('Procedimento salvo.'); await load() } catch (cause) { setError((cause as Error).message) } }}>Salvar procedimento</button>
    </section>
    <form className="module-form stacked" onSubmit={save}><strong>{selectedId ? 'Editar regra' : 'Nova regra'}</strong>
      <label>Tipo<select value={form.trigger} disabled={Boolean(selectedId)} onChange={(e) => set('trigger', e.target.value)}><option value="APPOINTMENT_CONFIRMATION">Confirmação de agendamento</option><option value="POST_CARE_SATISFACTION">Pesquisa de satisfação pós-atendimento</option><option value="PROCEDURE_RETURN">Retorno por procedimento</option><option value="POST_CARE_TAG_FLOW">Fluxo pós-atendimento por etiqueta</option></select></label>
      <input required maxLength={120} placeholder="Nome da regra" value={form.name} onChange={(e) => set('name', e.target.value)}/>
      <label>Unidade<select value={form.unitId} onChange={(e) => set('unitId', e.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
      {form.trigger === 'PROCEDURE_RETURN' ? <label>Procedimento<select required value={form.procedureId} onChange={(e) => set('procedureId', e.target.value)}><option value="">Selecione</option>{procedures.filter((p) => !p.unitId || p.unitId === form.unitId).map((p) => <option key={p.id} value={p.id}>{String(p.name)} · efeito {String(p.returnAfterDays ?? 'não definido')}d · aviso {String(p.reminderAdvanceDays ?? 'não definido')}d antes</option>)}</select></label> : form.trigger !== 'POST_CARE_TAG_FLOW' ? <label>Procedimento (opcional)<input value={form.procedureId} onChange={(e) => set('procedureId', e.target.value)}/></label> : null}
      {form.trigger !== 'POST_CARE_TAG_FLOW' && <label>{form.trigger === 'POST_CARE_SATISFACTION' ? 'Atraso após conclusão (minutos; 1440 = 24h)' : 'Antecedência (minutos)'}<input type="number" min="0" max={form.trigger === 'POST_CARE_SATISFACTION' ? 43200 : 10080} value={form.advanceMinutes} onChange={(e) => set('advanceMinutes', Number(e.target.value))}/></label>}
      <label>Contato permitido, hora local São Paulo<input aria-label="Hora inicial permitida" type="number" min="0" max="23" value={form.allowedStartHour} onChange={(e) => set('allowedStartHour', Number(e.target.value))}/><input aria-label="Hora final permitida" type="number" min="1" max="24" value={form.allowedEndHour} onChange={(e) => set('allowedEndHour', Number(e.target.value))}/></label>
      <label>Canal<select value={form.provider} onChange={(e) => set('provider', e.target.value)}><option value="META_CLOUD">Meta Cloud</option><option value="EVOLUTION_BAILEYS">Evolution API · Baileys (não oficial)</option></select></label>
      <label>Conexão (opcional)<input aria-describedby="automation-connection-help" value={form.connectionId} onChange={(e) => set('connectionId', e.target.value)}/><small id="automation-connection-help">Informe o identificador apenas se a regra usar uma conexão específica; deixe vazio para usar a padrão da unidade.</small></label>
      {form.trigger === 'POST_CARE_TAG_FLOW' ? <>
        <p>O fluxo começa quando o atendimento é marcado como concluído. Selecione uma etiqueta para criar uma sequência complementar para aquele grupo. Etiquetas sem um fluxo associado continuam apenas categorizando e filtrando pacientes. Sem etiqueta selecionada, esta sequência vale para todos os pacientes da unidade.</p>
        <label>Aplicar a<select value={form.targetTagId} onChange={(e) => set('targetTagId', e.target.value)}><option value="">Todos os pacientes</option>{automationTags.map((tag) => <option key={tag.id} value={tag.id}>{String(tag.name)}</option>)}</select></label>
        <section className="module-form stacked"><strong>Etapas da sequência</strong>{form.steps.map((step, index) => <fieldset className="module-form stacked" key={step.id}><legend>Etapa {index + 1}</legend><label>Enviar após a conclusão (minutos)<input type="number" min="0" max="525600" value={step.delayMinutes} onChange={(e) => setForm((current) => ({ ...current, steps: current.steps.map((item) => item.id === step.id ? { ...item, delayMinutes: Number(e.target.value) } : item) }))}/></label><label>Mensagem<textarea required maxLength={4000} value={step.body} onChange={(e) => setForm((current) => ({ ...current, steps: current.steps.map((item) => item.id === step.id ? { ...item, body: e.target.value } : item) }))}/></label><small>Variáveis: &#123;&#123;paciente.nome&#125;&#125;, &#123;&#123;agendamento.data&#125;&#125;, &#123;&#123;agendamento.hora&#125;&#125;</small>{form.steps.length > 1 && <button type="button" onClick={() => setForm((current) => ({ ...current, steps: current.steps.filter((item) => item.id !== step.id) }))}>Remover etapa</button>}</fieldset>)}<button type="button" onClick={() => setForm((current) => ({ ...current, steps: [...current.steps, { id: crypto.randomUUID(), delayMinutes: 1440, body: '' }] }))} disabled={form.steps.length >= 10}>Adicionar etapa</button></section>
        <p role="note">O sistema respeita o consentimento de pós-atendimento, pausa durante conversas ativas e limita mensagens automáticas a uma por paciente por dia. Evite incluir diagnóstico ou informação de saúde no texto: etiquetas de saúde são sensíveis.</p>
      </> : form.trigger === 'PROCEDURE_RETURN' ? <>
        <label>Mensagem discreta<textarea required maxLength={4000} value={form.body} onChange={(e) => set('body', e.target.value)}/></label><small>Prévia: {form.body.replaceAll('{{paciente.nome}}', 'Maria').replaceAll('{{agendamento.data}}', '18/10/2026').replaceAll('{{agendamento.hora}}', '14:00')} · Use texto genérico sobre organizar o retorno; não exponha o procedimento. O sistema só registra uma simulação, sem envio externo.</small>
        <label>Máximo de contatos por paciente<input type="number" min="1" max="12" value={form.maxContactsPerPatient} onChange={(e) => set('maxContactsPerPatient', Number(e.target.value))}/></label><label>Expirar resposta após (horas)<input type="number" min="1" max="720" value={form.responseWindowHours} onChange={(e) => set('responseWindowHours', Number(e.target.value))}/></label>
        <label>Dias permitidos (0 domingo a 6 sábado)<input value={form.allowedDaysOfWeek} onChange={(e) => set('allowedDaysOfWeek', e.target.value)}/></label><label>Respostas exatas de interesse<input value={form.interestKeywords} onChange={(e) => set('interestKeywords', e.target.value)}/></label><label>Solicitação de agendamento/reagendamento<input value={form.returnKeywords} onChange={(e) => set('returnKeywords', e.target.value)}/></label><label>Não deseja contato<input value={form.noContactKeywords} onChange={(e) => set('noContactKeywords', e.target.value)}/></label><label>Sem resposta<select value={form.noResponseAction} onChange={(e) => set('noResponseAction', e.target.value)}><option value="NONE">Expirar sem tarefa</option><option value="CREATE_TASK">Criar tarefa humana ao expirar</option></select></label>
      </> : form.trigger === 'POST_CARE_SATISFACTION' ? <>
        <label>Abertura<textarea required maxLength={500} value={form.opening} onChange={(e) => set('opening', e.target.value)}/></label>
        <label>Pergunta<textarea required maxLength={1000} value={form.question} onChange={(e) => set('question', e.target.value)}/></label>
        <label>Prazo para resposta (horas)<input type="number" min="1" max="720" value={form.responseWindowHours} onChange={(e) => set('responseWindowHours', Number(e.target.value))}/></label>
        <label>Versão da pesquisa<input type="number" min="1" max="1000" value={form.version} onChange={(e) => set('version', Number(e.target.value))}/></label>
        <fieldset className="module-form stacked"><legend>Mensagens de agradecimento por classificação</legend>{[['thankExcellent','Ótimo'],['thankGood','Bom'],['thankRegular','Regular'],['thankPoor','Ruim'],['thankVeryPoor','Péssimo']].map(([key, label]) => <label key={key}>{label}<input required maxLength={500} value={String(form[key as keyof typeof form])} onChange={(e) => set(key, e.target.value)}/></label>)}</fieldset>
        <label>Resposta Regular<select value={form.regularAction} onChange={(e) => set('regularAction', e.target.value)}><option value="NONE">Somente agradecer</option><option value="CREATE_TASK">Criar tarefa de acompanhamento</option></select></label>
        <label>Sem resposta até expirar<select value={form.noResponseAction} onChange={(e) => set('noResponseAction', e.target.value)}><option value="NONE">Somente marcar como expirada</option><option value="CREATE_TASK">Criar tarefa para equipe</option></select></label>
        <small>Classificações exatas: Ótimo, Bom, Regular, Ruim e Péssimo. Não é NPS. Resposta negativa gera tarefa urgente para atendimento humano.</small>
      </> : <>
        <label>Mensagem<input required maxLength={4000} value={form.body} onChange={(e) => set('body', e.target.value)}/></label>
        <small>Variáveis: &#123;&#123;paciente.nome&#125;&#125;, &#123;&#123;agendamento.data&#125;&#125;, &#123;&#123;agendamento.hora&#125;&#125;</small>
        <label>Respostas exatas de confirmação<input value={form.confirmKeywords} onChange={(e) => set('confirmKeywords', e.target.value)}/></label>
        <label>Respostas exatas para reagendar<input value={form.rescheduleKeywords} onChange={(e) => set('rescheduleKeywords', e.target.value)}/></label>
        <label>Palavras para atendimento humano<input value={form.humanKeywords} onChange={(e) => set('humanKeywords', e.target.value)}/></label>
        <label>Sem resposta<select value={form.noResponseAction} onChange={(e) => set('noResponseAction', e.target.value)}><option value="NONE">Sem ação automática</option><option value="CREATE_TASK">Criar tarefa se não houver resposta</option></select></label>
      </>}
      <label>Responsável por tarefas<select required value={form.responsibleUserId} onChange={(e) => set('responsibleUserId', e.target.value)}>{automationAssignees.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
      <button className="primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar como rascunho'}</button>{selectedId && <button type="button" onClick={() => { setSelectedId(''); setHistory([]); setResults(null) }}>Cancelar edição</button>}
    </form>
    <div className="record-list">{items.map((item) => { const config = item.configuration as Record<string, any>; const metrics = (item.metrics ?? {}) as Record<string, unknown>; const triggerName = item.trigger === 'POST_CARE_SATISFACTION' ? 'Pesquisa de satisfação' : item.trigger === 'PROCEDURE_RETURN' ? 'Retorno por procedimento' : item.trigger === 'POST_CARE_TAG_FLOW' ? 'Fluxo pós-atendimento' : 'Confirmação'; const tagName = automationTags.find((tag) => tag.id === config?.targetTagId)?.name; return <article key={item.id}><b>{String(item.name)} · {triggerName}{item.trigger === 'POST_CARE_TAG_FLOW' ? ` · ${tagName ? `Etiqueta: ${String(tagName)}` : 'Todos os pacientes'}` : ''} · {statusLabel(item.status)}</b><span>Unidade: {units.find((u) => u.id === config?.unitId)?.name ?? '—'} · {item.trigger === 'POST_CARE_TAG_FLOW' ? `${Array.isArray(config?.steps) ? config.steps.length : 0} etapa(s)` : `antecedência: ${String(config?.advanceMinutes ?? '—')} min`} · canal: {statusLabel(config?.provider ?? '—')}</span><span>Execuções: {Number(metrics.total ?? 0).toLocaleString('pt-BR')} · pendentes: {Number(metrics.pending ?? 0).toLocaleString('pt-BR')} · simulações: {Number(metrics.simulated ?? 0).toLocaleString('pt-BR')} · suprimidas: {Number(metrics.suppressed ?? 0).toLocaleString('pt-BR')} · falhas: {Number(metrics.failed ?? 0).toLocaleString('pt-BR')} · respostas: {Number(metrics.surveyResponses ?? 0).toLocaleString('pt-BR')} · tarefas: {Number(metrics.taskCount ?? 0).toLocaleString('pt-BR')}</span><div><button type="button" onClick={() => void choose(item)}>Editar / histórico</button><button type="button" onClick={() => void setStatus(item)}>{item.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}</button></div></article> })}</div>
    {results && <section className="record-list"><h3>Respostas registradas — cinco classificações</h3><p>Pesquisas simuladas sem resposta não entram neste resultado.</p>{Object.entries(results.received ?? {}).map(([classification, count]) => <article key={classification}><b>{classification}</b><span>{String(count)}</span></article>)}<small>Total {String(results.total)} · pendentes {String(results.pending)} · simuladas {String(results.simulated)} · expiradas {String(results.expired)} · suprimidas {String(results.suppressed)} · falhas {String(results.failed)}</small></section>}
    {history.length > 0 && <section><h3>Histórico de execuções · simulações sem envio</h3>{history.map((item) => <article key={item.id}><b>{statusLabel(item.status)} · {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(String(item.scheduledAt)))}</b><span>{item.outboxMessageId ? 'Registro de mensagem associado' : String(item.lastError ?? 'Sem mensagem associada')}</span>{Boolean(item.survey) && <small>Pesquisa: {statusLabel((item.survey as Record<string, unknown>).state)} · classificação: {statusLabel((item.survey as Record<string, unknown>).classification ?? 'sem resposta')}</small>}{Boolean(item.outbox) && <small>Fila de mensagens: {statusLabel((item.outbox as Record<string, unknown>).status)} {String((item.outbox as Record<string, unknown>).suppressionReason ?? '')}</small>}</article>)}</section>}
    {error && <div role="alert">{error}</div>}
  </div>
}
function QuickRepliesPanel({ request, conversationId, role, onInsert }: { request: (path: string, init?: RequestInit) => Promise<any>; conversationId: string; role: string; onInsert: (body: string) => void }) {
  const [items, setItems] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [preview, setPreview] = useState<{ body: string; unresolved: string[]; canInsert: boolean } | null>(null)
  const [form, setForm] = useState({ name: '', description: '', shortcut: '', category: 'Geral', body: '' })
  const [error, setError] = useState('')
  const canManage = ['TENANT_ADMIN', 'UNIT_MANAGER'].includes(role)
  useEffect(() => { request(`/quick-replies${search ? `?search=${encodeURIComponent(search)}` : ''}`).then(setItems).catch((cause: Error) => setError(cause.message)) }, [request, search])
  async function select(id: string) { setSelectedId(id); setPreview(null); try { const result = await request(`/quick-replies/${id}/preview`, { method: 'POST', body: JSON.stringify({ conversationId }) }); setPreview(result) } catch (cause) { setError((cause as Error).message) } }
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(''); try { await request(selectedId ? `/quick-replies/${selectedId}` : '/quick-replies', { method: selectedId ? 'PATCH' : 'POST', body: JSON.stringify(form) }); setForm({ name: '', description: '', shortcut: '', category: 'Geral', body: '' }); setSelectedId(''); setItems(await request('/quick-replies')); } catch (cause) { setError((cause as Error).message) } }
  async function deactivate(item: Row) { try { await request(`/quick-replies/${item.id}`, { method: 'PATCH', body: JSON.stringify({ active: false }) }); setItems((current) => current.filter((entry) => entry.id !== item.id)); if (selectedId === item.id) setSelectedId('') } catch (cause) { setError((cause as Error).message) } }
  return <section className="module-form stacked" aria-label="Respostas rápidas"><input aria-label="Buscar respostas rápidas" placeholder="Buscar por nome, atalho ou categoria" value={search} onChange={(event) => setSearch(event.target.value)}/><div className="inbox-toolbar">{items.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => void select(item.id)}>{String(item.name)}</button>)}</div>{preview && <article><p>{preview.body}</p>{preview.unresolved.length > 0 && <small>Complete as variáveis: {preview.unresolved.join(', ')}</small>}<button type="button" disabled={!preview.canInsert} onClick={() => onInsert(preview.body)}>Inserir no rascunho</button></article>}{canManage && <><form className="module-form stacked" onSubmit={save}><strong>{selectedId ? 'Editar resposta rápida' : 'Nova resposta rápida'}</strong><input required maxLength={100} placeholder="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/><input maxLength={40} placeholder="Atalho opcional" value={form.shortcut} onChange={(event) => setForm({ ...form, shortcut: event.target.value })}/><input required maxLength={60} placeholder="Categoria" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}/><input maxLength={240} placeholder="Descrição opcional" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}/><textarea required maxLength={4000} placeholder="Texto. Variáveis: {{paciente.primeiroNome}}, {{unidade.nome}}, {{atendente.nome}}, {{agendamento.data}}, {{agendamento.hora}}" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })}/><div><button className="primary">Salvar resposta</button>{selectedId && <button type="button" onClick={() => { const item = items.find((entry) => entry.id === selectedId); if (item) void deactivate(item) }}>Arquivar</button>}</div></form>{items.find((item) => item.id === selectedId) && <button type="button" onClick={() => { const item = items.find((entry) => entry.id === selectedId)!; setForm({ name: String(item.name), description: String(item.description ?? ''), shortcut: String(item.shortcut ?? ''), category: String(item.category), body: String(item.body) }) }}>Carregar para edição</button>}</>}{error && <div className="notice">{error}</div>}</section>
}

function MessagingConnectionsPanel({ unitId, units, request, setNotice }: { unitId: string; units: Unit[]; request: (path: string, init?: RequestInit) => Promise<any>; setNotice: (message: string) => void }) {
  const [items, setItems] = useState<Row[]>([])
  const [provider, setProvider] = useState<'META_CLOUD' | 'EVOLUTION_BAILEYS'>('META_CLOUD')
  const [meta, setMeta] = useState({ displayName: '', unitId, wabaId: '', phoneNumberId: '', graphApiVersion: '', accessToken: '', isDefault: false })
  const [evolution, setEvolution] = useState({ displayName: '', unitId, apiBaseUrl: '', instanceName: '', apiVersion: '', phoneNumber: '', apiKey: '', isDefault: false })
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const path = unitId ? `/messaging/connections?unitId=${encodeURIComponent(unitId)}` : '/messaging/connections'
  const refresh = useCallback(async () => { setItems(await request(path)) }, [path, request])
  useEffect(() => { void refresh().catch((cause: Error) => setError(cause.message)) }, [refresh])
  useEffect(() => { setMeta((current) => ({ ...current, unitId })); setEvolution((current) => ({ ...current, unitId })) }, [unitId])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const saved = provider === 'META_CLOUD'
        ? await request('/messaging/connections/meta', { method: 'POST', body: JSON.stringify(meta) })
        : await request('/messaging/connections/evolution', { method: 'POST', body: JSON.stringify({ ...evolution, mode: 'EVOLUTION_BAILEYS' }) })
      setResult(saved); setMeta((current) => ({ ...current, displayName: '', wabaId: '', phoneNumberId: '', graphApiVersion: '', accessToken: '', isDefault: false })); setEvolution((current) => ({ ...current, displayName: '', apiBaseUrl: '', instanceName: '', apiVersion: '', phoneNumber: '', apiKey: '', isDefault: false })); await refresh()
      setNotice('Conexão salva com segredo protegido. Nenhuma chamada ao provedor foi feita.')
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  async function dryRun(id: string) { setError(''); try { setResult(await request(`/messaging/connections/${id}/dry-run`, { method: 'POST', body: '{}' })) } catch (cause) { setError((cause as Error).message) } }
  async function disable(id: string) { setError(''); try { await request(`/messaging/connections/${id}/disconnect-local`, { method: 'POST', body: '{}' }); await refresh(); setNotice('Conexão desativada somente no SaaS; nenhuma operação remota foi feita.') } catch (cause) { setError((cause as Error).message) } }
  const unitOptions = units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)
  return <section className="channels-page"><div className="channels-intro"><h2>Conexões de WhatsApp</h2><p>Cadastre conexões por unidade. Chaves não são devolvidas ao navegador. O estado operacional, QR Code e chamadas externas dependem da homologação do contrato e da versão instalada. As verificações desta etapa são simuladas e não enviam mensagens.</p><label>Provedor<select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="META_CLOUD">Meta Cloud API oficial</option><option value="EVOLUTION_BAILEYS">Evolution API · Baileys (não oficial)</option></select></label></div>
    <form className="module-form channel-form" onSubmit={save}><label>Nome da conexão<input required value={provider === 'META_CLOUD' ? meta.displayName : evolution.displayName} onChange={(event) => provider === 'META_CLOUD' ? setMeta({ ...meta, displayName: event.target.value }) : setEvolution({ ...evolution, displayName: event.target.value })}/></label><label>Unidade<select required value={provider === 'META_CLOUD' ? meta.unitId : evolution.unitId} onChange={(event) => provider === 'META_CLOUD' ? setMeta({ ...meta, unitId: event.target.value }) : setEvolution({ ...evolution, unitId: event.target.value })}>{unitOptions}</select></label>
      {provider === 'META_CLOUD' ? <><label>WABA ID<input required value={meta.wabaId} onChange={(event) => setMeta({ ...meta, wabaId: event.target.value })}/></label><label>Phone Number ID<input required value={meta.phoneNumberId} onChange={(event) => setMeta({ ...meta, phoneNumberId: event.target.value })}/></label><label>Versão da Graph API<input placeholder="vXX.X · confirmar com Meta" value={meta.graphApiVersion} onChange={(event) => setMeta({ ...meta, graphApiVersion: event.target.value })}/></label><label>Token de acesso<input type="password" autoComplete="new-password" required value={meta.accessToken} onChange={(event) => setMeta({ ...meta, accessToken: event.target.value })}/></label></> : <><label>URL da Evolution API<input type="url" required placeholder="https://evolution.seudominio" value={evolution.apiBaseUrl} onChange={(event) => setEvolution({ ...evolution, apiBaseUrl: event.target.value })}/></label><label>Instância existente<input required value={evolution.instanceName} onChange={(event) => setEvolution({ ...evolution, instanceName: event.target.value })}/></label><label>Versão da Evolution<input placeholder="Não presumir 2.3.7" value={evolution.apiVersion} onChange={(event) => setEvolution({ ...evolution, apiVersion: event.target.value })}/></label><label>Número conectado (opcional)<input value={evolution.phoneNumber} onChange={(event) => setEvolution({ ...evolution, phoneNumber: event.target.value })}/></label><label>API Key<input type="password" autoComplete="new-password" required value={evolution.apiKey} onChange={(event) => setEvolution({ ...evolution, apiKey: event.target.value })}/></label><p role="note">Baileys usa WhatsApp Web e não é uma conexão oficial da Meta; pode desconectar ou sofrer restrições. Campanhas de marketing em massa são bloqueadas nesse modo.</p></>}
      <label><input type="checkbox" checked={provider === 'META_CLOUD' ? meta.isDefault : evolution.isDefault} onChange={(event) => provider === 'META_CLOUD' ? setMeta({ ...meta, isDefault: event.target.checked }) : setEvolution({ ...evolution, isDefault: event.target.checked })}/> Usar como conexão padrão desta unidade</label>
      <button className="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar conexão'}</button></form>
    {result?.webhookSecret && <article><b>Segredo de webhook da Evolution (exibido uma vez)</b><code>{String(result.webhookSecret)}</code><p>Configure a URL e o header `x-evolution-webhook-secret` na instância. Use TLS e restrição de rede/proxy na VPS após confirmar o contrato.</p></article>}
    {result && <article><b>Resultado local</b><pre>{JSON.stringify(result, null, 2)}</pre></article>}
    <div className="record-list">{items.map((item) => <article key={item.id}><b>{String(item.displayName)} · {statusLabel(item.provider)} · {statusLabel(item.status)}</b><span>Unidade: {units.find((u) => u.id === item.unitId)?.name ?? 'Unidade indisponível'} · homologação: {statusLabel(item.homologation)} · segredo configurado: {item.credentialsConfigured ? 'sim (oculto)' : 'não'}</span><span>{item.provider === 'META_CLOUD' ? `WABA ${String(item.wabaId)} · Phone Number ID ${String(item.phoneNumberId)} · versão da Graph API ${String(item.graphApiVersion)}` : `Instância ${String(item.instanceName)} · versão ${String(item.apiVersion)} · ${String(item.apiBaseUrl)}`}</span>{Boolean(item.warning) && <small>{String(item.warning)}</small>}<div><button type="button" onClick={() => void dryRun(item.id)}>Simular verificação local (sem chamada externa)</button><button type="button" onClick={() => void disable(item.id)}>Desativar localmente</button><button type="button" disabled title="Consulta de estado e QR exigem versão/API da VPS confirmadas e autorização de conexão">Status / QR indisponíveis até homologação</button></div></article>)}</div>{error && <div className="notice" role="alert">{error}</div>}</section>
}

function UnoPanel({ unitId, request, setNotice }: { unitId: string; request: (path: string, init?: RequestInit) => Promise<any>; setNotice: (message: string) => void }) {
  const [config, setConfig] = useState<any>({ selectedCategories: [], selectedFields: [] })
  const [credentials, setCredentials] = useState({ accessToken: '', secretKey: '' })
  const [webhook, setWebhook] = useState('')
  useEffect(() => { if (unitId) request(`/integrations/uno/${unitId}`).then(setConfig).catch((error: Error) => setNotice(error.message)) }, [unitId, request, setNotice])
  const categories = ['APPOINTMENT_CREATED','APPOINTMENT_UPDATED','APPOINTMENT_REMOVED','ORDER_CREATED','ORDER_UPDATED']
  const fields = ['id','startDate','endDate','status','serviceSession','customer','employee','room','service','totalPrice','totalDiscount','totalPaid','items']
  function toggle(key: 'selectedCategories' | 'selectedFields', value: string) { setConfig((current: any) => ({ ...current, [key]: current[key]?.includes(value) ? current[key].filter((x: string) => x !== value) : [...(current[key] ?? []), value] })) }
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); try { const result = await request(`/integrations/uno/${unitId}`, { method: 'PUT', body: JSON.stringify({ ...config, ...credentials, rotateWebhookToken: !config.credentialsConfigured }) }); setConfig(result); if (result.webhookToken) { setWebhook(`URL: ${result.webhookUrl ?? '(configure API_PUBLIC_URL)'}\nToken Uno (exibido uma vez): ${result.webhookToken}`) } setCredentials({ accessToken: '', secretKey: '' }); setNotice('Configuração Uno salva. A agenda continua nativa até homologação.') } catch (error) { setNotice((error as Error).message) } }
  return <form className="uno-form" onSubmit={save}><h2>Integração Uno · {config.status ?? 'não configurada'}</h2><p>Credenciais são criptografadas. Deixe os campos vazios para manter valores salvos.</p><label htmlFor="uno-access-token">Token de acesso da integração (deixe em branco para manter o salvo)</label><input id="uno-access-token" type="password" autoComplete="new-password" value={credentials.accessToken} onChange={(e) => setCredentials({ ...credentials, accessToken: e.target.value })}/><label htmlFor="uno-secret-key">Chave secreta da integração (deixe em branco para manter a salva)</label><input id="uno-secret-key" type="password" autoComplete="new-password" value={credentials.secretKey} onChange={(e) => setCredentials({ ...credentials, secretKey: e.target.value })}/><strong>Eventos selecionados</strong><div className="checks">{categories.map((value) => <label key={value}><input type="checkbox" checked={config.selectedCategories?.includes(value) ?? false} onChange={() => toggle('selectedCategories', value)}/>{({ APPOINTMENT_CREATED: 'Agendamento criado', APPOINTMENT_UPDATED: 'Agendamento atualizado', APPOINTMENT_REMOVED: 'Agendamento removido', ORDER_CREATED: 'Pedido criado', ORDER_UPDATED: 'Pedido atualizado' } as Record<string, string>)[value] ?? value}</label>)}</div><strong>Campos processados</strong><div className="checks">{fields.map((value) => <label key={value}><input type="checkbox" checked={config.selectedFields?.includes(value) ?? false} onChange={() => toggle('selectedFields', value)}/>{({ id: 'Identificador', startDate: 'Data de início', endDate: 'Data de término', status: 'Status', serviceSession: 'Sessão de atendimento', customer: 'Cliente', employee: 'Profissional', room: 'Sala', service: 'Serviço', totalPrice: 'Valor total', totalDiscount: 'Desconto total', totalPaid: 'Valor pago', items: 'Itens' } as Record<string, string>)[value] ?? value}</label>)}</div><button className="primary">Salvar configuração</button><button type="button" onClick={async () => { try { const result = await request(`/integrations/uno/${unitId}/test`, { method: 'POST' }); setConfig((current: any) => ({ ...current, status: result.connected ? 'CONNECTED' : 'ERROR' })); setNotice(result.connected ? 'Credenciais válidas. Agenda permanece nativa.' : result.error ?? `Uno respondeu ${result.statusCode}`) } catch (error) { setNotice((error as Error).message) } }}>Testar conexão</button>{webhook && <pre className="webhook-once">{webhook}</pre>}</form>
}

function AiPanel({ request, setNotice }: { request: (path: string, init?: RequestInit) => Promise<any>; setNotice: (message: string) => void }) {
  const [settings, setSettings] = useState<any>({ enabled: false, model: 'gpt-4o-mini', instructions: '', conversationProcessingAuthorized: false })
  const [savedSettings, setSavedSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [apiKey, setApiKey] = useState('')
  useEffect(() => { let active = true; request('/ai/settings').then((result) => { if (active) { setSettings(result); setSavedSettings(result) } }).catch((error: Error) => { if (active) setNotice(error.message) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [request, setNotice])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true)
    try { const result = await request('/ai/settings', { method: 'PATCH', body: JSON.stringify({ ...settings, apiKey: apiKey || undefined }) }); setSettings(result); setSavedSettings(result); setApiKey(''); setNotice('Configuração de IA salva. Rascunhos continuam sujeitos a aprovação humana.') }
    catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }
  const savedState = loading ? 'Verificando configuração…' : !savedSettings?.enabled ? 'Desativado' : !savedSettings?.configured ? 'Aguardando chave do provedor' : !savedSettings?.conversationProcessingAuthorized ? 'Aguardando autorização da clínica' : 'Ativo para rascunhos com aprovação humana'
  return <form className="module-form stacked" onSubmit={save}><h2>Assistente IA · {savedState}</h2><p>Usa somente mensagens recentes da conversa, mascarando e-mail, telefone e CPF. Não envia mensagem nem altera agendamentos.</p><label>Chave OpenAI<input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.configured ? 'Configurada · deixe vazio para manter' : 'sk-…'} /></label><label>Modelo<select value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })}><option value="gpt-4o-mini">gpt-4o-mini</option></select></label><label>Instruções adicionais<textarea maxLength={2000} value={settings.instructions} onChange={(event) => setSettings({ ...settings, instructions: event.target.value })} /></label><label><input type="checkbox" checked={settings.conversationProcessingAuthorized} onChange={(event) => setSettings({ ...settings, conversationProcessingAuthorized: event.target.checked })} /> A clínica autorizou o envio do contexto mínimo ao provedor OpenAI para gerar rascunhos.</label><label><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} /> Ativar geração de rascunhos</label><button className="primary" disabled={busy || loading}>{busy ? 'Salvando…' : 'Salvar configuração'}</button></form>
}

function UsagePanel({ request }: { request: (path: string, init?: RequestInit) => Promise<any> }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await request('/usage')) }
    catch (cause) { setError((cause as Error).message || 'Não foi possível carregar o plano e o consumo.') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { void load() }, [load])
  if (loading) return <div className="record-list" aria-live="polite"><article><b>Plano e consumo</b><span>Carregando os dados do ciclo…</span></article></div>
  if (error) return <div className="record-list"><article role="alert"><b>Não foi possível carregar o plano</b><span>{error}</span><button type="button" onClick={() => void load()}>Tentar novamente</button></article></div>
  if (!data) return <div className="record-list"><article><b>Plano e consumo</b><span>Não há dados de assinatura disponíveis para esta clínica.</span></article></div>
  const usageLabels: Record<string, string> = { patients: 'Pacientes cadastrados', users: 'Usuários', whatsappConnections: 'Conexões de WhatsApp', activeAutomations: 'Automações ativas', messages: 'Mensagens no ciclo' }
  return <div className="record-list"><article><b>{data.plan.name} · R$ {(data.plan.priceCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mês</b><span>Ciclo {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date(data.cycle.startsAt))} a {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date(data.cycle.endsAt))} · {statusLabel(data.cycle.status)}</span></article>{Object.entries(data.usage).map(([name, value]: [string, any]) => <article key={name}><b>{usageLabels[name] ?? name.replaceAll('_', ' ')}</b><span>{Number(value.current).toLocaleString('pt-BR')} / {value.limit == null ? 'sem limite no plano' : Number(value.limit).toLocaleString('pt-BR')}</span></article>)}</div>
}

export default App
