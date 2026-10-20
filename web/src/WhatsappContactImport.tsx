import { useEffect, useMemo, useRef, useState } from 'react'

type Unit = { id: string; name: string }
type Contact = { name: string; phone: string }
type Request = (path: string, init?: RequestInit) => Promise<any>

export default function WhatsappContactImport({ request, units, initialUnitId, onClose, onImported }: {
  request: Request
  units: Unit[]
  initialUnitId: string
  onClose: () => void
  onImported: (message: string) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [unitId, setUnitId] = useState(initialUnitId || units[0]?.id || '')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])

  const visibleContacts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalized) return contacts
    return contacts.filter((contact) => `${contact.name} ${contact.phone}`.toLocaleLowerCase('pt-BR').includes(normalized))
  }, [contacts, query])

  async function loadContacts() {
    if (!unitId) { setError('Selecione uma unidade para consultar os contatos.'); return }
    setError('')
    setLoading(true)
    setSelected(new Set())
    try {
      const result = await request(`/messaging/contacts/whatsapp?unitId=${encodeURIComponent(unitId)}`)
      setContacts(Array.isArray(result.contacts) ? result.contacts : [])
      setLoaded(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível consultar os contatos. Verifique a conexão da unidade.')
      setContacts([])
      setLoaded(false)
    } finally { setLoading(false) }
  }

  function toggle(phone: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(phone)) next.delete(phone)
      else if (next.size < 500) next.add(phone)
      return next
    })
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current)
      const allVisibleSelected = visibleContacts.every((contact) => next.has(contact.phone))
      if (allVisibleSelected) visibleContacts.forEach((contact) => next.delete(contact.phone))
      else visibleContacts.slice(0, Math.max(0, 500 - next.size)).forEach((contact) => next.add(contact.phone))
      return next
    })
  }

  async function importSelected() {
    const rows = contacts.filter((contact) => selected.has(contact.phone)).map((contact) => ({ fullName: contact.name, phone: contact.phone, source: 'WHATSAPP' }))
    if (!rows.length || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await request('/patients/import', { method: 'POST', body: JSON.stringify({ rows, unitId }) })
      onImported(`Importação concluída: ${result.imported} adicionados, ${result.duplicates} duplicados ignorados e ${result.errors?.length ?? 0} com erro. Nenhum consentimento de marketing foi presumido.`)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível importar os contatos selecionados.')
    } finally { setSaving(false) }
  }

  return <dialog ref={dialogRef} className="whatsapp-import-dialog" aria-labelledby="whatsapp-import-title" onCancel={(event) => { event.preventDefault(); onClose() }} onClose={onClose}>
    <div className="whatsapp-import-heading">
      <div><h2 id="whatsapp-import-title">Importar contatos do WhatsApp</h2><p>Consulte a agenda da conexão Evolution Baileys 2.3.7 desta unidade e escolha quem deseja adicionar como paciente. A conexão Meta Cloud não disponibiliza esta lista.</p></div>
      <button type="button" className="whatsapp-import-close" aria-label="Fechar" onClick={onClose}>×</button>
    </div>
    <div className="whatsapp-import-controls">
      <label>Unidade<select value={unitId} onChange={(event) => { setUnitId(event.target.value); setLoaded(false); setContacts([]); setSelected(new Set()) }}><option value="">Selecione uma unidade</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
      <button type="button" className="primary" disabled={!unitId || loading} onClick={() => void loadContacts()}>{loading ? 'Buscando contatos…' : loaded ? 'Atualizar lista' : 'Buscar no WhatsApp'}</button>
    </div>
    {error && <p className="whatsapp-import-error" role="alert">{error}</p>}
    {loaded && <>
      <div className="whatsapp-import-list-tools">
        <label className="whatsapp-import-search">Buscar nesta lista<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou telefone" /></label>
        <button type="button" className="small-action" disabled={!visibleContacts.length} onClick={toggleVisible}>{visibleContacts.length > 0 && visibleContacts.every((contact) => selected.has(contact.phone)) ? 'Desmarcar visíveis' : 'Selecionar visíveis'}</button>
        <span>{selected.size} de 500 selecionados</span>
      </div>
      <div className="whatsapp-import-list" aria-label="Contatos encontrados">
        {visibleContacts.map((contact) => <label className="whatsapp-import-contact" key={contact.phone}>
          <input type="checkbox" checked={selected.has(contact.phone)} disabled={!selected.has(contact.phone) && selected.size >= 500} onChange={() => toggle(contact.phone)} />
          <span className="whatsapp-import-avatar" aria-hidden="true">{contact.name.slice(0, 1).toLocaleUpperCase('pt-BR')}</span>
          <span className="whatsapp-import-contact-copy"><strong>{contact.name}</strong><small>{contact.phone}</small></span>
        </label>)}
        {visibleContacts.length === 0 && <p className="whatsapp-import-empty">{contacts.length ? 'Nenhum contato corresponde à busca.' : 'Nenhum contato válido foi encontrado nesta conexão.'}</p>}
      </div>
      <p className="whatsapp-import-consent">Importar um contato não registra consentimento para marketing nem autoriza mensagens. Os contatos selecionados serão adicionados à lista de pacientes da clínica.</p>
      <div className="whatsapp-import-footer"><button type="button" className="small-action" onClick={onClose}>Cancelar</button><button type="button" className="primary" disabled={!selected.size || saving} onClick={() => void importSelected()}>{saving ? 'Importando…' : `Importar ${selected.size} contato${selected.size === 1 ? '' : 's'}`}</button></div>
    </>}
    {!loaded && !loading && !error && <p className="whatsapp-import-empty">A consulta só acontece quando você clicar em “Buscar no WhatsApp”. Nenhuma mensagem será enviada.</p>}
  </dialog>
}
