import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './whatsapp-import.css'

type Unit = { id: string; name: string }
type Contact = { name: string; phone: string }
type Request = (path: string, init?: RequestInit) => Promise<any>
const IMPORT_BATCH_SIZE = 500

export default function WhatsappContactImport({ request, units, initialUnitId, onClose, onImported }: {
  request: Request
  units: Unit[]
  initialUnitId: string
  onClose: () => void
  onImported: (message: string) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const lastAutoLoadedUnit = useRef('')
  const [unitId, setUnitId] = useState(initialUnitId || units[0]?.id || '')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(initialUnitId || units[0]?.id))
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [importProgress, setImportProgress] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])

  const loadContacts = useCallback(async () => {
    if (!unitId) { setError('Selecione uma filial para consultar os contatos.'); setLoading(false); return }
    setError('')
    setLoading(true)
    setLoaded(false)
    setSelected(new Set())
    try {
      const result = await request(`/messaging/contacts/whatsapp?unitId=${encodeURIComponent(unitId)}`)
      const nextContacts: Contact[] = Array.isArray(result.contacts) ? result.contacts : []
      setContacts(nextContacts)
      setSelected(new Set(nextContacts.map((contact) => contact.phone)))
      setLoaded(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível consultar os contatos. Verifique a conexão da filial.')
      setContacts([])
      setLoaded(false)
    } finally { setLoading(false) }
  }, [request, unitId])

  useEffect(() => {
    if (!unitId || lastAutoLoadedUnit.current === unitId) return
    lastAutoLoadedUnit.current = unitId
    void loadContacts()
  }, [loadContacts, unitId])

  const visibleContacts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalized) return contacts
    return contacts.filter((contact) => `${contact.name} ${contact.phone}`.toLocaleLowerCase('pt-BR').includes(normalized))
  }, [contacts, query])

  function changeUnit(nextUnitId: string) {
    lastAutoLoadedUnit.current = ''
    setUnitId(nextUnitId)
    setContacts([])
    setSelected(new Set())
    setQuery('')
    setLoaded(false)
    setLoading(Boolean(nextUnitId))
    setError('')
  }

  function toggle(phone: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(phone)) next.delete(phone)
      else next.add(phone)
      return next
    })
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current)
      const allVisibleSelected = visibleContacts.length > 0 && visibleContacts.every((contact) => next.has(contact.phone))
      if (allVisibleSelected) visibleContacts.forEach((contact) => next.delete(contact.phone))
      else visibleContacts.forEach((contact) => next.add(contact.phone))
      return next
    })
  }

  async function importSelected() {
    const rows = contacts.filter((contact) => selected.has(contact.phone)).map((contact) => ({ fullName: contact.name, phone: contact.phone, source: 'WHATSAPP' }))
    if (!rows.length || saving) return
    setSaving(true)
    setError('')
    let imported = 0
    let duplicates = 0
    let rowErrors = 0
    let completed = 0
    try {
      const batches = Math.ceil(rows.length / IMPORT_BATCH_SIZE)
      for (let index = 0; index < batches; index++) {
        setImportProgress(`Importando lote ${index + 1} de ${batches}…`)
        const batch = rows.slice(index * IMPORT_BATCH_SIZE, (index + 1) * IMPORT_BATCH_SIZE)
        const result = await request('/patients/import', { method: 'POST', body: JSON.stringify({ rows: batch, unitId }) })
        imported += Number(result.imported ?? 0)
        duplicates += Number(result.duplicates ?? 0)
        rowErrors += Array.isArray(result.errors) ? result.errors.length : 0
        completed += batch.length
      }
      onImported(`Importação concluída: ${imported} adicionados, ${duplicates} duplicados ignorados e ${rowErrors} com erro. Nenhum consentimento de marketing foi presumido.`)
      onClose()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível importar os contatos selecionados.'
      setError(completed ? `${message} Importação parcial: ${imported} adicionados e ${duplicates} duplicados ignorados antes da falha.` : message)
    } finally { setSaving(false); setImportProgress('') }
  }

  const allVisibleSelected = visibleContacts.length > 0 && visibleContacts.every((contact) => selected.has(contact.phone))
  return <dialog ref={dialogRef} className="whatsapp-import-dialog" aria-labelledby="whatsapp-import-title" onCancel={(event) => { event.preventDefault(); onClose() }} onClose={onClose}>
    <div className="whatsapp-import-heading">
      <div className="whatsapp-import-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M11 18.5h2"/></svg></div>
      <div className="whatsapp-import-title-copy"><h2 id="whatsapp-import-title">Importar do WhatsApp</h2><p>Contatos da agenda do WhatsApp da filial selecionada</p></div>
      <button type="button" className="whatsapp-import-close" aria-label="Fechar" onClick={onClose}>×</button>
    </div>
    {loading && <div className="whatsapp-import-loading" role="status"><span className="whatsapp-import-spinner" aria-hidden="true"/><p>Buscando contatos do WhatsApp…</p><small>{units.find((unit) => unit.id === unitId)?.name ?? 'Filial selecionada'}</small></div>}
    {error && <p className="whatsapp-import-error" role="alert">{error}</p>}
    {!loading && <div className="whatsapp-import-controls">
      <label>Filial<select value={unitId} onChange={(event) => changeUnit(event.target.value)}><option value="">Selecione uma filial</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
      <button type="button" className="primary" disabled={!unitId} onClick={() => void loadContacts()}>{error ? 'Tentar novamente' : 'Atualizar lista'}</button>
    </div>}
    {loaded && <>
      <div className="whatsapp-import-list-tools">
        <label className="whatsapp-import-search">Buscar na lista<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou telefone" /></label>
        <button type="button" className="whatsapp-import-select-all" disabled={!visibleContacts.length} onClick={toggleVisible}>{allVisibleSelected ? `Desmarcar todos (${visibleContacts.length})` : `Selecionar todos (${visibleContacts.length})`}</button>
        <span>{selected.size} de {contacts.length} selecionados</span>
      </div>
      <div className="whatsapp-import-list" aria-label="Contatos encontrados">
        {visibleContacts.map((contact) => <label className="whatsapp-import-contact" key={contact.phone}>
          <input type="checkbox" checked={selected.has(contact.phone)} onChange={() => toggle(contact.phone)} />
          <span className="whatsapp-import-avatar" aria-hidden="true">{contact.name.slice(0, 1).toLocaleUpperCase('pt-BR')}</span>
          <span className="whatsapp-import-contact-copy"><strong>{contact.name}</strong><small>{contact.phone}</small></span>
        </label>)}
        {visibleContacts.length === 0 && <p className="whatsapp-import-empty">{contacts.length ? 'Nenhum contato corresponde à busca.' : 'Nenhum contato válido foi encontrado nesta conexão.'}</p>}
      </div>
      <p className="whatsapp-import-consent">A importação não registra consentimento para marketing nem autoriza mensagens. Os contatos selecionados serão adicionados à lista de pacientes da clínica.</p>
      <div className="whatsapp-import-footer"><button type="button" className="small-action" disabled={saving} onClick={onClose}>Cancelar</button><button type="button" className="primary" disabled={!selected.size || saving} onClick={() => void importSelected()}>{saving ? importProgress || 'Importando…' : `Importar (${selected.size})`}</button></div>
    </>}
    {!loaded && !loading && !error && <p className="whatsapp-import-empty">Nenhum contato foi carregado. Escolha uma filial e tente novamente. Nenhuma mensagem será enviada.</p>}
  </dialog>
}
