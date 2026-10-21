import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import WhatsappContactImport from './WhatsappContactImport.js'
import './patients-page.css'

type Unit = { id: string; name: string }
type Patient = Record<string, any> & { id: string; fullName: string }
type PageResult = { items: Patient[]; total: number; page: number; pageSize: number; totalPages: number }
type Request = (path: string, init?: RequestInit) => Promise<any>

function parseCsv(text: string) {
  const source = text.replace(/^\uFEFF/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const separator = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '"' && quoted && source[i + 1] === '"') { field += '"'; i++ }
    else if (char === '"') quoted = !quoted
    else if (char === separator && !quoted) { row.push(field.trim()); field = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(field.trim()); field = ''
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
    } else field += char
  }
  row.push(field.trim())
  if (row.some((value) => value !== '')) rows.push(row)
  if (rows.length < 2) throw new Error('CSV vazio ou sem linhas de dados.')
  return { headers: rows[0], rows: rows.slice(1).filter((values) => values.some((value) => value.trim())) }
}

const importFields = [
  { key: 'fullName', label: 'Nome', aliases: ['nome', 'name', 'paciente', 'cliente'] },
  { key: 'phone', label: 'Telefone', aliases: ['telefone', 'celular', 'phone', 'fone', 'whatsapp'] },
  { key: 'email', label: 'E-mail', aliases: ['email', 'mail'] },
  { key: 'birthDate', label: 'Nascimento', aliases: ['nascimento', 'birth', 'aniversario', 'datanascimento'] },
  { key: 'source', label: 'Origem', aliases: ['origem', 'source'] },
]
function normalizeHeader(value: string) { return value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '') }
function guessImportMapping(headers: string[]) {
  return Object.fromEntries(importFields.map((field) => [field.key, headers.findIndex((header) => field.aliases.some((alias) => normalizeHeader(header).includes(alias))) ])) as Record<string, number>
}
function mapImportRows(rows: string[][], mapping: Record<string, number>) {
  return rows.map((values) => Object.fromEntries(importFields.map((field) => [field.key, mapping[field.key] >= 0 ? values[mapping[field.key]] ?? '' : field.key === 'source' ? 'Importacao' : '']))).filter((mapped) => Object.values(mapped).some((value) => String(value).trim()))
}
const evidenceTypes = [
  ['SIGNED_DOCUMENT', 'Documento assinado'],
  ['WRITTEN_FORM', 'Formulário físico/digital'],
  ['WHATSAPP_MESSAGE', 'Mensagem de WhatsApp'],
  ['EMAIL_MESSAGE', 'Mensagem de e-mail'],
  ['OTHER', 'Outra evidência identificável'],
]

const messageStatusLabels: Record<string, string> = { QUEUED: 'Na fila', PLANNED: 'Programada', SENT: 'Enviada', DELIVERED: 'Entregue', READ: 'Lida', FAILED: 'Falhou', SUPPRESSED: 'Suprimida', RECEIVED: 'Recebida' }

export default function PatientsPanel({
  request,
  units,
  role,
  unitId,
  refreshKey,
  setNotice,
  initialPatientId = '',
  onInitialPatientOpened,
  onOpenConversation,
  onOpenAppointment,
}: {
  request: Request
  units: Unit[]
  role: string
  unitId: string
  refreshKey: number
  setNotice: (message: string) => void
  initialPatientId?: string
  onInitialPatientOpened?: () => void
  onOpenConversation?: (id: string) => void
  onOpenAppointment?: (id: string) => void
}) {
  const [result, setResult] = useState<PageResult>({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [tagOptions, setTagOptions] = useState<{ id: string; name: string; color: string }[]>([])
  const [statusFilter, setStatusFilter] = useState('ACTIVE')
  const [selected, setSelected] = useState<Patient | null>(null)
  const [profile, setProfile] = useState<Patient | null>(null)
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'HISTORY' | 'DOCUMENTS' | 'NPS'>('OVERVIEW')
  const [messageHistory, setMessageHistory] = useState<Patient[]>([])
  const [documents, setDocuments] = useState<Patient[]>([])
  const [documentBusy, setDocumentBusy] = useState(false)
  const [consent, setConsent] = useState<{ preferences: Patient[]; events: Patient[] }>({ preferences: [], events: [] })
  const [tags, setTags] = useState<Patient[]>([])
  const [notes, setNotes] = useState<Patient[]>([])
  const [importRows, setImportRows] = useState<Record<string, string>[]>([])
  const [importHeaders, setImportHeaders] = useState<string[]>([])
  const [importRawRows, setImportRawRows] = useState<string[][]>([])
  const [importMapping, setImportMapping] = useState<Record<string, number>>({})
  const [importSheets, setImportSheets] = useState<string[]>([])
  const [importSheet, setImportSheet] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importReport, setImportReport] = useState<{ duplicateRows: number[]; errors: { row: number; message: string }[] } | null>(null)
  const [importUnitId, setImportUnitId] = useState('')
  const [consentStatus, setConsentStatus] = useState('')
  const [createConsentStatus, setCreateConsentStatus] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exportBusy, setExportBusy] = useState(false)
  const [whatsappImportOpen, setWhatsappImportOpen] = useState(false)
  const [showCreatePatient, setShowCreatePatient] = useState(false)
  const [showImportPanel, setShowImportPanel] = useState(false)
  const [duplicateCandidate, setDuplicateCandidate] = useState<{ patient: Patient; key: string } | null>(null)
  const approvedDuplicateKey = useRef('')

  const query = new URLSearchParams({ page: String(page), pageSize: '25', status: statusFilter })
  if (appliedSearch) query.set('search', appliedSearch)
  if (unitFilter) query.set('unitId', unitFilter)
  if (tagFilter) query.set('tagId', tagFilter)
  const queryString = query.toString()

  useEffect(() => {
    let active = true
    request(`/patients?${queryString}`)
      .then((data: PageResult) => { if (active) setResult(data) })
      .catch((error: Error) => { if (active) setNotice(error.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [request, queryString, refreshKey, revision, setNotice])

  useEffect(() => {
    let active = true
    request('/patients/tags')
      .then((data: { id: string; name: string; color: string }[]) => { if (active) setTagOptions(data) })
      .catch((error: Error) => { if (active) setNotice(error.message) })
    return () => { active = false }
  }, [request, revision, setNotice])

  useEffect(() => {
    let active = true
    if (!selected) {
      return () => { active = false }
    }
    Promise.all([request(`/patients/${selected.id}`), request(`/patients/${selected.id}/consents`), request(`/patients/${selected.id}/tags`), request(`/patients/${selected.id}/notes`)]).then(async ([patient, history, patientTags, patientNotes]) => {
      if (!active) return
      setProfile(patient)
      setConsent(history)
      setTags(patientTags.map((item: Patient) => item.tag))
      setNotes(patientNotes)
      const [messages, patientDocuments] = await Promise.allSettled([request(`/patients/${selected.id}/messages`), request(`/patients/${selected.id}/documents`)])
      if (!active) return
      if (messages.status === 'fulfilled') setMessageHistory(messages.value)
      else { setMessageHistory([]); setNotice((messages.reason as Error).message) }
      if (patientDocuments.status === 'fulfilled') setDocuments(patientDocuments.value)
      else { setDocuments([]); setNotice((patientDocuments.reason as Error).message) }
    }).catch((error: Error) => { if (active) setNotice(error.message) })
    return () => { active = false }
  }, [request, selected, revision, setNotice])

  useEffect(() => {
    if (!initialPatientId) return
    let active = true
    request(`/patients/${initialPatientId}`).then((patient: Patient) => {
      if (active) { setSelected(patient); setPage(1); setAppliedSearch('') }
    }).catch((error: Error) => { if (active) setNotice(error.message) }).finally(() => { if (active) onInitialPatientOpened?.() })
    return () => { active = false }
  }, [initialPatientId, request, setNotice, onInitialPatientOpened])

  async function createPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const phone = String(data.get('phone') ?? '').trim()
    const email = String(data.get('email') ?? '').trim()
    const unitId = String(data.get('unitId') ?? '')
    const duplicateKey = JSON.stringify({ phone, email: email.toLocaleLowerCase('pt-BR'), unitId })
    try {
      if (approvedDuplicateKey.current !== duplicateKey) {
        const terms = [phone, email].filter(Boolean)
        const matches = await Promise.all(terms.map(async (term) => {
          const params = new URLSearchParams({ page: '1', pageSize: '100', status: 'ALL', search: term, ...(unitId ? { unitId, includeUnassigned: 'true' } : {}) })
          const result = await request(`/patients?${params}`)
          return result.items as Patient[]
        }))
        const phoneKey = phone.replace(/\D/g, '')
        const candidate = matches.flat().find((patient) => {
          const samePhone = phoneKey.length > 0 && String(patient.phoneNormalized ?? patient.phone ?? '').replace(/\D/g, '') === phoneKey
          const sameEmail = email.length > 0 && String(patient.email ?? '').trim().toLocaleLowerCase('pt-BR') === email.toLocaleLowerCase('pt-BR')
          return samePhone || sameEmail
        })
        if (candidate) { setDuplicateCandidate({ patient: candidate, key: duplicateKey }); return }
      }
      approvedDuplicateKey.current = ''
      setDuplicateCandidate(null)
      await request('/patients', {
        method: 'POST',
        body: JSON.stringify({
          fullName: data.get('fullName'),
          phone,
          email,
          unitId: unitId || null,
          source: data.get('source'),
          marketingConsent: data.get('marketingConsent'),
          evidenceType: data.get('evidenceType') || null,
          evidenceReference: data.get('evidenceReference') || null,
          evidence: data.get('evidence') || null,
        }),
      })
      setNotice('Paciente cadastrado; escolha e evidência do consentimento foram registradas.')
      form.reset()
      setCreateConsentStatus('')
      setShowCreatePatient(false)
      setRevision((value) => value + 1)
    } catch (error) { approvedDuplicateKey.current = ''; setNotice((error as Error).message) }
  }

  async function updatePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    const data = new FormData(event.currentTarget)
    try {
      await request(`/patients/${profile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: data.get('fullName'),
          phone: data.get('phone'),
          email: data.get('email'),
          unitId: data.get('unitId') || null,
          source: data.get('source'),
          birthDate: data.get('birthDate') || null,
        }),
      })
      setNotice('Cadastro atualizado. O histórico de consentimento não foi alterado.')
      setRevision((value) => value + 1)
    } catch (error) { setNotice((error as Error).message) }
  }

  async function archivePatient() {
    if (!profile || !window.confirm(`Arquivar ${profile.fullName}? O cadastro e o histórico serão preservados; envios pendentes serão suprimidos.`)) return
    try {
      const response = await request(`/patients/${profile.id}/archive`, { method: 'PATCH' })
      const suppressedCount = Number(response.suppressedOutboxCount ?? 0)
      setNotice(suppressedCount === 1 ? 'Paciente arquivado. 1 envio pendente foi suprimido.' : `Paciente arquivado. ${suppressedCount} envios pendentes foram suprimidos.`)
      setSelected(null)
      setRevision((value) => value + 1)
    } catch (error) { setNotice((error as Error).message) }
  }

  async function recordConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      await request(`/patients/${profile.id}/consents`, {
        method: 'POST',
        body: JSON.stringify({
          channel: data.get('channel'),
          purpose: data.get('purpose'),
          status: data.get('status'),
          source: 'MANUAL',
          evidenceType: data.get('evidenceType') || null,
          evidenceReference: data.get('evidenceReference') || null,
          evidence: data.get('evidence') || null,
          policyVersion: data.get('policyVersion') || null,
        }),
      })
      setNotice('Evento de consentimento registrado; histórico anterior preservado.')
      form.reset()
      setConsentStatus('')
      setRevision((value) => value + 1)
    } catch (error) { setNotice((error as Error).message) }
  }

  async function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      await request(`/patients/${profile.id}/tags`, { method: 'POST', body: JSON.stringify({ name: data.get('name'), color: data.get('color') }) })
      setNotice('Etiqueta adicionada ao paciente.')
      form.reset()
      setRevision((value) => value + 1)
    } catch (error) { setNotice((error as Error).message) }
  }

  async function removeTag(tagId: string) {
    if (!profile) return
    try {
      await request(`/patients/${profile.id}/tags/${tagId}/remove`, { method: 'PATCH' })
      setNotice('Etiqueta removida do paciente.')
      setRevision((value) => value + 1)
    } catch (error) { setNotice((error as Error).message) }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      await request(`/patients/${profile.id}/notes`, { method: 'POST', body: JSON.stringify({ content: data.get('content') }) })
      setNotice('Nota interna registrada.')
      form.reset()
      setRevision((value) => value + 1)
    } catch (error) { setNotice((error as Error).message) }
  }

  function applyImportPreview(headers: string[], rows: string[][], sheets: string[] = [], sheet = '') {
    if (rows.length > 500) throw new Error('Separe o arquivo em lotes de até 500 linhas.')
    const mapping = guessImportMapping(headers)
    setImportHeaders(headers)
    setImportRawRows(rows)
    setImportMapping(mapping)
    setImportRows(mapImportRows(rows, mapping))
    setImportSheets(sheets)
    setImportSheet(sheet)
    setImportReport(null)
  }

  async function loadXlsx(file: File, sheetName?: string) {
    const form = new FormData()
    form.append('file', file)
    if (sheetName) form.append('sheetName', sheetName)
    const preview = await request('/patients/import/preview', { method: 'POST', body: form })
    applyImportPreview(preview.headers, preview.rows, preview.sheets, preview.sheetName)
    setNotice(String(preview.rowCount) + ' linha(s) na aba "' + preview.sheetName + '". Revise o mapeamento antes de importar.')
  }

  async function readImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setNotice('O arquivo deve ter no máximo 5 MB.'); return }
    setImportFile(file)
    setImportRows([])
    try {
      if (/\.xlsx$/i.test(file.name) && !/\.xlsm$/i.test(file.name)) {
        await loadXlsx(file)
      } else if (/\.csv$/i.test(file.name)) {
        let csv: string
        try {
          csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        } catch {
          throw new Error('O CSV não está em UTF-8. Exporte novamente como CSV UTF-8 para preservar os acentos.')
        }
        const parsed = parseCsv(csv)
        applyImportPreview(parsed.headers, parsed.rows)
        setNotice(String(parsed.rows.length) + ' linha(s) prontas para revisão.')
      } else {
        throw new Error('Escolha um arquivo CSV ou XLSX. Arquivos com macro não são aceitos.')
      }
    } catch (error) { setNotice((error as Error).message); setImportFile(null) }
  }

  function changeImportMapping(field: string, column: number) {
    const mapping = { ...importMapping, [field]: column }
    setImportMapping(mapping)
    setImportRows(mapImportRows(importRawRows, mapping))
  }

  async function importPatients() {
    if (!importRows.length) return
    try {
      const result = await request('/patients/import', { method: 'POST', body: JSON.stringify({ rows: importRows, unitId: importUnitId || null }) })
      setImportReport({ duplicateRows: result.duplicateRows ?? [], errors: result.errors ?? [] })
      setNotice('Importados: ' + result.imported + '; duplicados ignorados: ' + result.duplicates + '; linhas com erro: ' + result.errors.length + '. Nenhum consentimento foi presumido.')
      setImportRows([])
      setRevision((value) => value + 1)
    } catch (error) { setNotice((error as Error).message) }
  }

  function downloadImportReport() {
    if (!importReport) return
    const lines = [['Linha', 'Resultado', 'Detalhe'], ...importReport.duplicateRows.map((row) => [String(row), 'DUPLICADA', 'Contato já existe na clínica']), ...importReport.errors.map((item) => [String(item.row), 'REJEITADA', item.message])]
    const csv = lines.map((line) => line.map((value) => '"' + String(value).replace(/"/g, '""') + '"').join(';')).join('\r\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'relatorio-importacao-pacientes.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setAppliedSearch(search.trim())
  }

  async function exportPatients() {
    setExportBusy(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100', status: statusFilter })
      if (appliedSearch) params.set('search', appliedSearch)
      if (unitFilter) params.set('unitId', unitFilter)
      const firstPage = await request(`/patients?${params}`) as PageResult
      const items = [...firstPage.items]
      for (let pageNumber = 2; pageNumber <= firstPage.totalPages; pageNumber++) {
        params.set('page', String(pageNumber))
        const nextPage = await request(`/patients?${params}`) as PageResult
        items.push(...nextPage.items)
      }
      if (!items.length) { setNotice('Não há pacientes para exportar com os filtros atuais.'); return }
      const cells = [
        ['Nome', 'Telefone', 'E-mail', 'Unidade', 'Nascimento', 'Origem', 'Status'],
        ...items.map((patient) => [patient.fullName, patient.phone ?? '', patient.email ?? '', patient.unit?.name ?? '', patient.birthDate ? new Date(patient.birthDate).toLocaleDateString('pt-BR') : '', patient.source ?? '', patient.deletedAt ? 'Arquivado' : patient.active ? 'Ativo' : 'Inativo']),
      ]
      const csv = cells.map((row) => row.map((value) => {
        const safe = String(value).replace(/^[\s]*([=+\-@])/u, "'$1")
        return '"' + safe.replace(/"/g, '""') + '"'
      }).join(';')).join('\r\n')
      const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'pacientes.csv'
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(`${items.length.toLocaleString('pt-BR')} paciente(s) exportado(s) com os filtros atuais.`)
    } catch (error) { setNotice((error as Error).message) }
    finally { setExportBusy(false) }
  }

  async function uploadPatientDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !selected) return
    if (file.size > 10 * 1024 * 1024) { setNotice('O arquivo deve ter no máximo 10 MB.'); return }
    const form = new FormData()
    form.append('file', file)
    setDocumentBusy(true)
    try {
      await request(`/patients/${selected.id}/documents`, { method: 'POST', body: form })
      setNotice('Documento salvo no armazenamento local de demonstração.')
      setRevision((value) => value + 1)
    } catch (error) { setNotice((error as Error).message) }
    finally { setDocumentBusy(false) }
  }

  async function downloadPatientDocument(document: Patient) {
    if (!selected) return
    try {
      const result = await request(`/patients/${selected.id}/documents/${document.id}/download`)
      const binary = window.atob(result.contentBase64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = result.fileName
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setNotice((error as Error).message) }
  }

  const clinicAppointments: Patient[] = profile?.appointments ?? []
  if (!selected) return <div className="patients-page">
    {showCreatePatient && <form className="patient-create-form" onSubmit={createPatient}><strong>Novo paciente</strong><div className="patient-create-grid">
      <label>Nome completo<input required name="fullName" minLength={2} maxLength={160} placeholder="Nome do paciente"/></label><label>Telefone<input name="phone" maxLength={40} placeholder="(00) 00000-0000"/></label><label>E-mail<input name="email" type="email" maxLength={254} placeholder="nome@email.com"/></label>
      <label>Unidade<select required={role !== 'TENANT_ADMIN'} name="unitId" defaultValue=""><option value="">{role === 'TENANT_ADMIN' ? 'Sem unidade preferencial' : 'Selecione a unidade'}</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label>Origem<input name="source" maxLength={60} placeholder="WhatsApp, indicação…"/></label></div>
      <fieldset className="patient-consent-field"><legend>Marketing por WhatsApp</legend><label><input required type="radio" name="marketingConsent" value="GRANTED" onChange={() => setCreateConsentStatus('GRANTED')}/> Autorizou</label><label><input required type="radio" name="marketingConsent" value="DENIED" onChange={() => setCreateConsentStatus('DENIED')}/> Não autorizou</label></fieldset>
      {createConsentStatus === 'GRANTED' && <div className="patient-create-grid"><label>Tipo de evidência<select required name="evidenceType"><option value="">Selecione</option>{evidenceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Referência<input required name="evidenceReference" maxLength={255} placeholder="ID, protocolo ou documento"/></label><label>Detalhes<input name="evidence" maxLength={1000}/></label></div>}
      <small>A autorização requer evidência localizável. A escolha negativa também fica registrada.</small>
      {duplicateCandidate && <div className="patient-duplicate-warning" role="alert"><strong>Possível cadastro existente</strong><p>{duplicateCandidate.patient.fullName} · {duplicateCandidate.patient.phone || 'Sem telefone'} · {duplicateCandidate.patient.unit?.name || 'Sem unidade'}</p><p>Confira se é a mesma pessoa. Telefones podem ser compartilhados por familiares.</p><button type="button" className="small-action" onClick={() => { setProfile(null); setSelected(duplicateCandidate.patient); setDuplicateCandidate(null) }}>Abrir cadastro existente</button><button type="button" className="small-action" onClick={(event) => { approvedDuplicateKey.current = duplicateCandidate.key; setDuplicateCandidate(null); event.currentTarget.form?.requestSubmit() }}>Cadastrar mesmo assim</button><button type="button" className="small-action" onClick={() => setDuplicateCandidate(null)}>Revisar dados</button></div>}
      <button className="patients-primary">Cadastrar paciente</button></form>}
    <form className="patients-toolbar" onSubmit={applySearch}><input aria-label="Buscar paciente" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, telefone ou e-mail"/><select aria-label="Filtrar unidade" value={unitFilter} onChange={(event) => { setUnitFilter(event.target.value); setPage(1) }}><option value="">Todas as unidades</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><select aria-label="Filtrar status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}><option value="ACTIVE">Ativos</option><option value="ARCHIVED">Arquivados</option><option value="ALL">Todos</option></select><select aria-label="Filtrar etiqueta" value={tagFilter} onChange={(event) => { setTagFilter(event.target.value); setPage(1) }}><option value="">Todas as etiquetas</option>{tagOptions.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><button className="patients-secondary" type="submit">Buscar</button><button type="button" className="patients-secondary" onClick={() => setWhatsappImportOpen(true)}>Importar do WhatsApp</button><button type="button" className="patients-secondary" onClick={() => setShowImportPanel(!showImportPanel)}>{showImportPanel ? 'Fechar importação' : 'Importar CSV/XLSX'}</button><button type="button" className="patients-secondary" disabled={exportBusy} onClick={() => void exportPatients()}>{exportBusy ? 'Exportando…' : 'Exportar CSV'}</button><button type="button" className="patients-primary" onClick={() => setShowCreatePatient(!showCreatePatient)}>{showCreatePatient ? 'Fechar cadastro' : '+ Novo paciente'}</button></form>
    {showImportPanel && <section className="patient-import"><strong>Importar pacientes</strong><p>Revise os dados antes de importar. O consentimento não é importado nem presumido.</p><label className="patient-import-file">Escolher arquivo CSV ou XLSX<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void readImportFile(event)}/></label><small>Até 5 MB e 500 linhas por lote. Arquivos CSV devem estar em UTF-8.</small>
      {importSheets.length > 1 && importFile && <label>Aba da planilha<select value={importSheet} onChange={(event) => void loadXlsx(importFile, event.target.value)}>{importSheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label>}
      {importHeaders.length > 0 && importRows.length > 0 && <><div className="import-column-mapping"><b>Mapeamento de colunas</b>{importFields.map((field) => <label key={field.key}>{field.label}<select value={importMapping[field.key] ?? -1} onChange={(event) => changeImportMapping(field.key, Number(event.target.value))}><option value={-1}>Não importar</option>{importHeaders.map((header, index) => <option key={index} value={index}>{header || ('Coluna ' + (index + 1))}</option>)}</select></label>)}</div><label>Unidade para este lote<select required={role !== 'TENANT_ADMIN'} value={importUnitId} onChange={(event) => setImportUnitId(event.target.value)}><option value="">{role === 'TENANT_ADMIN' ? 'Sem unidade' : 'Selecione'}</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><small>{importRows.length} linha(s) após mapeamento. Prévia das primeiras 5:</small><div className="import-preview">{importRows.slice(0, 5).map((row, index) => <article key={String(row.fullName) + '-' + index}><b>{row.fullName || 'Nome ausente (será rejeitado)'}</b><span>{row.phone || 'Sem telefone'} · {row.email || 'Sem e-mail'}</span></article>)}</div><button type="button" className="primary" disabled={role !== 'TENANT_ADMIN' && !importUnitId || importMapping.fullName < 0} onClick={() => void importPatients()}>Importar {importRows.length}</button><button type="button" className="small-action" onClick={() => { setImportRows([]); setImportHeaders([]); setImportRawRows([]); setImportFile(null) }}>Cancelar</button></>}
      {importReport && <div className="import-report"><span>Importação concluída: {importReport.duplicateRows.length} duplicidade(s), {importReport.errors.length} rejeição(ões).</span><button type="button" className="small-action" onClick={downloadImportReport}>Baixar relatório CSV</button></div>}</section>}
    <section className="patient-table-section"><div className="patient-count">{loading ? 'Carregando pacientes…' : result.total.toLocaleString('pt-BR') + (result.total === 1 ? ' paciente' : ' pacientes')}</div><div className="patient-table-scroll"><table className="patient-table"><thead><tr><th>Nome</th><th>Telefone</th><th>Etiquetas</th><th>Unidade</th><th>Status</th><th>Cadastro</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>
      {result.items.map((patient) => { const patientTags = (patient.tags ?? []).map((assignment: Patient) => assignment.tag).filter(Boolean) as { id: string; name: string; color: string }[]; return <tr key={patient.id} onClick={() => { setProfile(null); setSelected(patient); setActiveTab('OVERVIEW') }} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setProfile(null); setSelected(patient); setActiveTab('OVERVIEW') } }}><td><strong>{patient.fullName}</strong><small>{patient.email || 'Sem e-mail'}</small></td><td>{patient.phone || '—'}</td><td><div className="patient-row-tags" aria-label={patientTags.length ? `Etiquetas: ${patientTags.map((tag) => tag.name).join(', ')}` : 'Sem etiquetas'}>{patientTags.length ? patientTags.map((tag) => <span key={tag.id} style={{ borderColor: tag.color, color: tag.color }}>{tag.name}</span>) : <span className="patient-no-tags">—</span>}</div></td><td>{patient.unit?.name || 'Sem unidade'}</td><td><span className={'patient-status ' + (patient.deletedAt || !patient.active ? 'is-inactive' : 'is-active')}>{patient.deletedAt ? 'Arquivado' : patient.active ? 'Ativo' : 'Inativo'}</span></td><td>{patient.createdAt ? new Date(patient.createdAt).toLocaleDateString('pt-BR') : '—'}</td><td><button type="button" className="patient-open" onClick={(event) => { event.stopPropagation(); setProfile(null); setSelected(patient); setActiveTab('OVERVIEW') }}>Abrir perfil</button></td></tr> })}
      {!loading && result.items.length === 0 && <tr><td colSpan={7} className="patient-table-empty">Nenhum paciente encontrado com esses filtros.</td></tr>}
      </tbody></table></div><div className="patient-pagination"><button disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Anterior</button><span>Página {result.page} de {Math.max(result.totalPages, 1)}</span><button disabled={page >= result.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Próxima</button></div></section>
    {whatsappImportOpen && <WhatsappContactImport request={request} units={units} initialUnitId={unitFilter || unitId} onClose={() => setWhatsappImportOpen(false)} onImported={(message) => { setNotice(message); setRevision((value) => value + 1) }}/>}
  </div>

  return <div className="patients-page patient-detail-page"><button type="button" className="patient-back" onClick={() => { setSelected(null); setProfile(null) }}>← Voltar para pacientes</button>
    {!profile || profile.id !== selected.id ? <section className="patient-profile-loading" role="status">Carregando perfil do paciente…</section> : <>
      <header className="patient-detail-heading"><div><h2>{profile.fullName}</h2><p>{profile.phone || 'Telefone não informado'} · {profile.email || 'E-mail não informado'} · {profile.unit?.name || 'Sem unidade preferencial'}</p></div><div className="patient-detail-actions">{profile.phone && <a href={'https://wa.me/' + String(profile.phoneNormalized || profile.phone).replace(/\D/g, '')} target="_blank" rel="noreferrer">WhatsApp</a>}{!profile.deletedAt && (role === 'TENANT_ADMIN' || role === 'UNIT_MANAGER') && <button type="button" className="patient-danger" onClick={() => void archivePatient()}>Arquivar</button>}</div></header>
      <nav className="patient-tabs" aria-label="Seções do perfil do paciente"><button type="button" aria-current={activeTab === 'OVERVIEW' ? 'page' : undefined} onClick={() => setActiveTab('OVERVIEW')}>Visão geral</button><button type="button" aria-current={activeTab === 'HISTORY' ? 'page' : undefined} onClick={() => setActiveTab('HISTORY')}>Histórico de atendimento</button><button type="button" aria-current={activeTab === 'DOCUMENTS' ? 'page' : undefined} onClick={() => setActiveTab('DOCUMENTS')}>Documentos</button><button type="button" aria-current={activeTab === 'NPS' ? 'page' : undefined} onClick={() => setActiveTab('NPS')}>Avaliações / NPS</button></nav>
      {activeTab === 'OVERVIEW' && <div className="patient-profile-content"><section className="patient-panel"><h3>Dados do paciente</h3><dl className="patient-facts"><div><dt>Unidade preferencial</dt><dd>{profile.unit?.name || 'Não definida'}</dd></div><div><dt>Telefone</dt><dd>{profile.phone || 'Não informado'}</dd></div><div><dt>E-mail</dt><dd>{profile.email || 'Não informado'}</dd></div><div><dt>Nascimento</dt><dd>{profile.birthDate ? new Date(profile.birthDate).toLocaleDateString('pt-BR') : 'Não informado'}</dd></div><div><dt>Origem</dt><dd>{profile.source || 'Não informada'}</dd></div><div><dt>Status</dt><dd>{profile.deletedAt ? 'Arquivado' : profile.active ? 'Ativo' : 'Inativo'}</dd></div></dl>
        {profile.deletedAt == null && <details className="patient-inline-edit"><summary>Editar dados</summary><form className="patient-create-grid" onSubmit={updatePatient}><label>Nome<input required name="fullName" minLength={2} maxLength={160} defaultValue={profile.fullName}/></label><label>Telefone<input name="phone" maxLength={40} defaultValue={profile.phone || ''}/></label><label>E-mail<input name="email" type="email" maxLength={254} defaultValue={profile.email || ''}/></label><label>Unidade<select required={role !== 'TENANT_ADMIN'} name="unitId" defaultValue={profile.unitId || ''}><option value="">Sem unidade preferencial</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label>Origem<input name="source" maxLength={60} defaultValue={profile.source || ''}/></label><label>Nascimento<input name="birthDate" type="date" defaultValue={profile.birthDate ? String(profile.birthDate).slice(0, 10) : ''}/></label><button className="patients-primary">Salvar alterações</button></form></details>}</section>
        <section className="patient-panel"><h3>Histórico de mensagens</h3>{messageHistory.length ? <div className="patient-message-history">{messageHistory.slice(0, 8).map((message) => <article key={message.id}><div><strong>{message.direction === 'INBOUND' ? 'Paciente' : 'Clínica'}</strong><time>{new Date(message.createdAt).toLocaleString('pt-BR')}</time></div><p>{message.body}</p><small>{messageStatusLabels[message.status] || message.status} · {message.conversation?.unit?.name || 'Unidade'}</small><button type="button" className="patient-text-action" onClick={() => onOpenConversation?.(message.conversation.id)}>Abrir conversa</button></article>)}</div> : <p className="patient-empty">Nenhuma mensagem registrada.</p>}</section>
        <section className="patient-panel"><h3>Etiquetas</h3>{tags.length ? <div className="patient-tags">{tags.map((tag) => <span key={tag.id} style={{ borderColor: tag.color, color: tag.color }}>{tag.name}{profile.deletedAt == null && <button type="button" aria-label={'Remover ' + tag.name} onClick={() => void removeTag(tag.id)}>×</button>}</span>)}</div> : <p className="patient-empty">Nenhuma etiqueta.</p>}{profile.deletedAt == null && <form className="patient-create-grid compact" onSubmit={addTag}><label>Nova etiqueta<input required name="name" minLength={2} maxLength={40}/></label><label>Cor<input name="color" type="color" defaultValue="#64748b"/></label><button className="patients-secondary">Adicionar</button></form>}</section>
        <section className="patient-panel"><h3>Observações operacionais</h3><p className="patient-caution">Use apenas para observações operacionais. Não registre diagnóstico ou dados clínicos.</p>{notes.map((note) => <article className="patient-note" key={note.id}><p>{note.content}</p><small>{new Date(note.createdAt).toLocaleString('pt-BR')} · {note.author?.displayName || 'Equipe'}</small></article>)}{profile.deletedAt == null && <form className="patient-create-grid compact" onSubmit={addNote}><label>Nova observação<textarea required name="content" maxLength={2000}/></label><button className="patients-secondary">Adicionar</button></form>}</section>
        <details className="patient-panel patient-consents"><summary>Consentimentos e preferências de contato</summary>{consent.preferences.length ? consent.preferences.map((item) => <div className="consent-preference" key={item.channel + '-' + item.purpose}><b>{item.channel} · {item.purpose}</b><span>{item.status === 'GRANTED' ? 'Autorizado' : item.status === 'DENIED' ? 'Negado' : 'Revogado'} · {item.source}</span><small>{item.lastChangedAt ? new Date(item.lastChangedAt).toLocaleString('pt-BR') : ''}{item.evidenceReference ? ' · Ref. ' + item.evidenceReference : ''}</small></div>) : <p className="patient-empty">Nenhuma preferência registrada.</p>}
          {profile.deletedAt == null && <form className="patient-create-grid compact" onSubmit={recordConsent}><label>Canal<select required name="channel" defaultValue="WHATSAPP"><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">E-mail</option><option value="SMS">SMS</option></select></label><label>Finalidade<select required name="purpose" defaultValue="MARKETING"><option value="MARKETING">Marketing</option><option value="POST_CARE">Pós-atendimento</option><option value="APPOINTMENT_REMINDER">Lembrete de agendamento</option><option value="SATISFACTION_SURVEY">Pesquisa de satisfação</option><option value="PROCEDURE_RETURN">Retorno por procedimento</option></select></label><label>Decisão<select required name="status" value={consentStatus} onChange={(event) => setConsentStatus(event.target.value)}><option value="">Escolha</option><option value="GRANTED">Concedido</option><option value="DENIED">Negado</option><option value="REVOKED">Revogado</option></select></label>{consentStatus === 'GRANTED' && <><label>Evidência<select required name="evidenceType"><option value="">Selecione</option>{evidenceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Referência<input required name="evidenceReference" maxLength={255}/></label></>}<label>Detalhes<input name="evidence" maxLength={1000}/></label><label>Versão da política<input name="policyVersion" maxLength={80}/></label><button className="patients-secondary" disabled={!consentStatus}>Registrar decisão</button></form>}<h4>Histórico de eventos</h4>{consent.events.length ? <div className="consent-events">{consent.events.map((event) => <article key={event.id}><b>{event.status} · {event.channel} · {event.purpose}</b><span>{new Date(event.occurredAt).toLocaleString('pt-BR')} · {event.source} · {event.actor?.displayName || 'Sistema'}</span><small>{event.evidenceType || 'Sem tipo de evidência'}{event.evidenceReference ? ' · ' + event.evidenceReference : ''}</small></article>)}</div> : <p className="patient-empty">Nenhum evento registrado.</p>}</details></div>}
      {activeTab === 'HISTORY' && <div className="patient-history-streams">
        <section className="patient-panel patient-history-panel">
          <div className="patient-history-heading"><div><h3>Atendimentos da clínica</h3><p>Procedimentos e agendamentos registrados pela equipe.</p></div><span className="patient-history-count">{clinicAppointments.filter((appointment: Patient) => appointment.status === 'COMPLETED').length} concluídos</span></div>
          {clinicAppointments.length ? <div className="patient-clinic-visits">{clinicAppointments.map((appointment: Patient) => {
            const procedureId = appointment.procedureId || appointment.procedure?.id || ''
            const completedVisits = procedureId ? clinicAppointments.filter((item: Patient) => item.status === 'COMPLETED' && (item.procedureId || item.procedure?.id || '') === procedureId).sort((a: Patient, b: Patient) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()) : []
            const visitNumber = appointment.status === 'COMPLETED' ? completedVisits.findIndex((item: Patient) => item.id === appointment.id) + 1 : 0
            const resources = (appointment.resources || []).map((item: Patient) => item.resource).filter(Boolean)
            const professionals = resources.filter((resource: Patient) => resource.type === 'PROFESSIONAL')
            const otherResources = resources.filter((resource: Patient) => resource.type !== 'PROFESSIONAL')
            const statusLabels: Record<string, string> = { COMPLETED: 'Concluído', CONFIRMED: 'Confirmado', PENDING: 'Pendente', CANCELLED: 'Cancelado', NO_SHOW: 'Não compareceu' }
            return <article className="patient-clinic-visit" key={appointment.id}>
              <div className="patient-clinic-visit-date"><time>{new Date(appointment.startsAt).toLocaleString('pt-BR')}</time><span className={'patient-visit-status is-' + String(appointment.status).toLowerCase()}>{statusLabels[appointment.status] || appointment.status}</span></div>
              <h4>{appointment.procedure?.name || 'Procedimento não informado'}</h4>
              <dl><div><dt>Unidade</dt><dd>{appointment.unit?.name || '—'}</dd></div><div><dt>Profissional responsável</dt><dd>{professionals.length ? professionals.map((resource: Patient) => resource.name).join(', ') : 'Não registrado'}</dd></div>{otherResources.length ? <div><dt>Sala / equipamento</dt><dd>{otherResources.map((resource: Patient) => resource.name).join(', ')}</dd></div> : null}{appointment.createdByName ? <div><dt>Agendado por</dt><dd>{appointment.createdByName}</dd></div> : null}</dl>
              {appointment.status === 'COMPLETED' && <p className="patient-visit-repeat">{!procedureId ? 'Atendimento concluído · procedimento não identificado para verificar repetição' : visitNumber > 1 ? `Retorno · ${visitNumber}º atendimento concluído deste procedimento` : completedVisits.length > 1 ? `1º atendimento · ${completedVisits.length} atendimentos concluídos deste procedimento` : 'Primeiro atendimento concluído deste procedimento'}</p>}
              <button type="button" className="patient-text-action" onClick={() => onOpenAppointment?.(appointment.id)}>Abrir agendamento</button>
            </article>
          })}</div> : <p className="patient-empty">Nenhum agendamento registrado para este paciente.</p>}
          <p className="patient-history-note">O sistema mostra o profissional vinculado ao agendamento. Quem realizou o procedimento só pode ser confirmado quando esse dado for registrado pela clínica.</p>
        </section>
        <section className="patient-panel patient-history-panel">
          <div className="patient-history-heading"><div><h3>Conversas do WhatsApp</h3><p>Mensagens recebidas e enviadas nas conversas deste paciente.</p></div><span className="patient-history-count">{messageHistory.length} mensagens</span></div>
          {messageHistory.length ? <div className="patient-whatsapp-history">{Array.from(messageHistory.reduce((groups: Map<string, Patient[]>, message: Patient) => { const id = message.conversation?.id || 'sem-conversa'; groups.set(id, [...(groups.get(id) || []), message]); return groups }, new Map<string, Patient[]>()).entries()).map(([conversationId, messages]) => {
            const latest = messages[0]
            return <article className="patient-whatsapp-thread" key={conversationId}><header><div><strong>Conversa · {latest.conversation?.unit?.name || 'Unidade não informada'}</strong><time>{new Date(latest.createdAt).toLocaleString('pt-BR')}</time></div><button type="button" className="patient-text-action" onClick={() => onOpenConversation?.(conversationId)}>Abrir conversa completa</button></header><div className="patient-whatsapp-messages">{messages.map((message: Patient) => <div className={'patient-whatsapp-message is-' + String(message.direction).toLowerCase()} key={message.id}><div><strong>{message.direction === 'INBOUND' ? 'Paciente' : message.actor === 'AI' ? 'Assistente IA' : 'Clínica'}</strong><time>{new Date(message.createdAt).toLocaleString('pt-BR')}</time></div><p>{message.body}</p><small>{messageStatusLabels[message.status] || message.status}</small></div>)}</div></article>
          })}</div> : <p className="patient-empty">Nenhuma mensagem de WhatsApp registrada para este paciente.</p>}
        </section>
      </div>}      {activeTab === 'DOCUMENTS' && <section className="patient-panel patient-documents-panel"><div className="patient-panel-heading"><div><h3>Documentos do paciente</h3><p>PDF, JPG ou PNG, até 10 MB por arquivo.</p></div>{profile.deletedAt == null && <label className="patients-primary patient-upload-label">{documentBusy ? 'Enviando…' : 'Enviar documento'}<input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" disabled={documentBusy} onChange={(event) => void uploadPatientDocument(event)}/></label>}</div><div className="patient-storage-note">Armazenamento local protegido para demonstração. Configure armazenamento e controles de produção antes de anexar dados reais.</div>{documents.length ? <div className="patient-documents-list">{documents.map((document) => <article key={document.id}><span className="patient-file-mark">{document.mimeType === 'application/pdf' ? 'PDF' : 'IMG'}</span><div><strong>{document.originalName}</strong><small>{(document.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB · {new Date(document.createdAt).toLocaleString('pt-BR')} · {document.uploadedBy?.displayName || 'Equipe'}</small></div><button type="button" className="patients-secondary" onClick={() => void downloadPatientDocument(document)}>Baixar</button></article>)}</div> : <p className="patient-empty patient-documents-empty">Nenhum documento enviado ainda.</p>}</section>}
      {activeTab === 'NPS' && <section className="patient-panel patient-nps-panel"><h3>Avaliações / NPS</h3>{role !== 'TENANT_ADMIN' && role !== 'UNIT_MANAGER' ? <p className="patient-empty">As avaliações NPS ficam disponíveis para administradores e gerentes de unidade.</p> : profile.npsSurveys?.some((survey: Patient) => survey.status === 'RESPONDED') ? <div className="patient-nps-list">{profile.npsSurveys.filter((survey: Patient) => survey.status === 'RESPONDED').map((survey: Patient) => <article key={survey.id}><strong>Nota {survey.score}/10</strong><span>{survey.unit?.name || 'Unidade'} · {survey.respondedAt ? new Date(survey.respondedAt).toLocaleString('pt-BR') : 'Data não informada'}</span><p>{survey.comment || 'Sem comentário.'}</p></article>)}</div> : <div className="patient-nps-empty"><strong>Nenhuma avaliação recebida ainda.</strong><p>O NPS pode ser programado após o atendimento quando a pesquisa estiver ativa e houver consentimento. O envio depende da configuração da clínica e do canal conectado.</p>{profile.npsSurveys?.some((survey: Patient) => survey.status === 'PLANNED') ? <small>Há pesquisa(s) programada(s), sem resposta registrada.</small> : null}</div>}</section>}
    </>}
    {whatsappImportOpen && <WhatsappContactImport request={request} units={units} initialUnitId={unitFilter} onClose={() => setWhatsappImportOpen(false)} onImported={(message) => { setNotice(message); setRevision((value) => value + 1) }}/>}
  </div>
}
