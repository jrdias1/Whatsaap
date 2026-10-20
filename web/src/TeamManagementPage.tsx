import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './phase10-admin.css'

type Request = (path: string, init?: RequestInit) => Promise<any>
type Unit = { id: string; name: string; slug: string }
type Member = { id: string; role: string; status: string; unitScopes: { unitId: string }[]; user: { id: string; email: string; displayName: string; active: boolean } }
type Credentials = { email: string; password: string; displayName: string }

export default function TeamManagementPage({ request, units, role, userId, setNotice, refreshKey }: { request: Request; units: Unit[]; role: string; userId: string; setNotice: (value: string) => void; refreshKey: number }) {
  const [users, setUsers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<any[]>([])
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [history, setHistory] = useState<Record<string, any[]>>({})
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [accessForm, setAccessForm] = useState({ email: '', displayName: '', role: 'OPERATOR', unitIds: [] as string[], password: '', confirmPassword: '' })
  const [credentials, setCredentials] = useState<Credentials | null>(null)

  async function load(search = query, role = roleFilter, unit = unitFilter) {
    setBusy(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      if (role) params.set('role', role)
      if (unit) params.set('unitId', unit)
      const result = await request(`/users?${params.toString()}`)
      setUsers(result.users); setInvitations(result.invitations)
    } catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [refreshKey])

  async function loadHistory(member: Member) {
    try { const result = await request(`/users/${member.id}/history`); setHistory((current) => ({ ...current, [member.id]: result })) }
    catch (error) { setNotice((error as Error).message) }
  }

  async function createAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setCredentials(null)
    try {
      if (accessForm.password !== accessForm.confirmPassword) throw new Error('As senhas não coincidem.')
      await request('/users/members', { method: 'POST', body: JSON.stringify({ email: accessForm.email, displayName: accessForm.displayName, role: accessForm.role, password: accessForm.password, unitIds: accessForm.unitIds }) })
      setCredentials({ email: accessForm.email.trim().toLowerCase(), password: accessForm.password, displayName: accessForm.displayName })
      setNotice(`${accessForm.role === 'OPERATOR' ? 'Operador' : 'Gerente'} cadastrado. A troca da senha será obrigatória no primeiro acesso.`)
      setAccessForm({ email: '', displayName: '', role: 'OPERATOR', unitIds: [], password: '', confirmPassword: '' })
      await load()
    } catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }

  async function resetMemberPassword(event: FormEvent<HTMLFormElement>, member: Member) {
    event.preventDefault()
    if (!window.confirm(`Redefinir a senha de ${member.user.displayName}? Todas as sessões serão encerradas e a próxima entrada exigirá uma nova senha.`)) return
    const form = event.currentTarget
    const data = new FormData(form)
    const password = String(data.get('password') ?? '')
    if (password !== data.get('confirmPassword')) { setNotice('As senhas não coincidem.'); return }
    setBusy(true)
    try {
      await request(`/users/${member.id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) })
      setCredentials({ email: member.user.email, password, displayName: member.user.displayName })
      form.reset()
      setNotice(`Senha redefinida e sessões anteriores encerradas. Entregue a nova senha diretamente a ${member.role === 'OPERATOR' ? 'este operador' : 'esta pessoa'}.`)
    } catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }

  async function copyCredentials() {
    if (!credentials) return
    try { await navigator.clipboard.writeText(`Login: ${credentials.email}\nSenha: ${credentials.password}`); setNotice('Dados de acesso copiados. Entregue-os em canal privado.') }
    catch { setNotice('Não foi possível copiar automaticamente. Selecione e copie os dados exibidos.') }
  }

  async function update(member: Member, data: Record<string, unknown>) {
    setBusy(true)
    try { await request(`/users/${member.id}`, { method: 'PATCH', body: JSON.stringify(data) }); setNotice('Acesso atualizado; sessões anteriores revogadas.'); await load() }
    catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }

  return <div className="phase10-admin">
    <section className="phase10-card" aria-labelledby="team-title">
      <div className="phase10-heading"><div><h2 id="team-title">Equipe e permissões</h2><p>Cadastre operadores com login e senha, convide gerentes e limite cada acesso às unidades necessárias.</p></div><div className="phase10-filters"><label>Buscar<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load() }} placeholder="Nome ou e-mail" /></label><label>Papel<select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); void load(query, event.target.value, unitFilter) }}><option value="">Todos</option><option value="TENANT_ADMIN">Administrador</option><option value="UNIT_MANAGER">Gerente</option><option value="OPERATOR">Operador</option></select></label><label>Unidade<select value={unitFilter} onChange={(event) => { setUnitFilter(event.target.value); void load(query, roleFilter, event.target.value) }}><option value="">Todas</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><button type="button" onClick={() => void load()}>Buscar</button></div></div>
      {role === 'TENANT_ADMIN' && <form className="phase10-form" onSubmit={(event) => void createAccess(event)}>
        <h3>{accessForm.role === 'OPERATOR' ? 'Criar acesso de operador' : 'Criar acesso de gerente'}</h3>
        <p className="platform-form-note">Informe o login e uma senha provisória. Entregue os dados diretamente à pessoa; ela deverá definir uma nova senha no primeiro acesso.</p>
        <label>Nome<input required minLength={2} maxLength={120} value={accessForm.displayName} onChange={(event) => setAccessForm({ ...accessForm, displayName: event.target.value })} /></label>
        <label>Login (e-mail)<input required type="email" autoComplete="email" value={accessForm.email} onChange={(event) => setAccessForm({ ...accessForm, email: event.target.value })} /></label>
        <label>Papel<select value={accessForm.role} onChange={(event) => setAccessForm({ ...accessForm, role: event.target.value, password: '', confirmPassword: '' })}><option value="OPERATOR">Operador</option><option value="UNIT_MANAGER">Gerente de unidade</option></select></label>
        <label>Senha provisória<input required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={accessForm.password} onChange={(event) => setAccessForm({ ...accessForm, password: event.target.value })} /><small>Mínimo de 8 caracteres. Será exibida uma vez após o cadastro.</small></label><label>Confirmar senha provisória<input required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={accessForm.confirmPassword} onChange={(event) => setAccessForm({ ...accessForm, confirmPassword: event.target.value })} /></label>
        <fieldset><legend>Unidades permitidas</legend>{units.map((unit) => <label className="phase10-check" key={unit.id}><input type="checkbox" checked={accessForm.unitIds.includes(unit.id)} onChange={(event) => setAccessForm((current) => ({ ...current, unitIds: event.target.checked ? [...current.unitIds, unit.id] : current.unitIds.filter((id) => id !== unit.id) }))} />{unit.name}</label>)}</fieldset>
        <button className="primary" disabled={busy || !accessForm.unitIds.length || !accessForm.password || !accessForm.confirmPassword}> {accessForm.role === 'OPERATOR' ? 'Criar acesso' : 'Criar acesso'}</button>
      </form>}
      {credentials && <div className="phase10-secret" role="status"><strong>Acesso de {credentials.displayName} — entregue diretamente e em canal privado</strong><span>Login</span><code>{credentials.email}</code><span>Senha provisória</span><code>{credentials.password}</code><small>Esta senha será exibida apenas agora. A pessoa deverá escolher uma nova senha no primeiro acesso.</small><button type="button" onClick={() => void copyCredentials()}>Copiar login e senha</button><button type="button" onClick={() => setCredentials(null)}>Ocultar senha</button></div>}
      <div className="phase10-table-wrap" role="region" aria-label="Tabela de funcionários. Em telas pequenas, deslize horizontalmente para consultar as colunas de unidades, status e ações." tabIndex={0}><table><thead><tr><th>Funcionário</th><th>Papel</th><th>Unidades</th><th>Status</th><th>Ações</th></tr></thead><tbody>{users.map((member) => <tr key={member.id}><td><strong>{member.user.displayName}</strong><small>{member.user.email}</small></td><td><select aria-label={`Papel de ${member.user.displayName}`} value={member.role} disabled={busy || role !== 'TENANT_ADMIN'} onChange={(event) => void update(member, { role: event.target.value })}><option value="TENANT_ADMIN">Administrador</option><option value="UNIT_MANAGER">Gerente</option><option value="OPERATOR">Operador</option></select></td><td>{member.unitScopes.map(({ unitId }) => units.find((unit) => unit.id === unitId)?.name ?? 'Unidade restrita').join(', ') || 'Sem unidade'}</td><td>{member.status === 'ACTIVE' ? 'Ativo' : 'Revogado'}</td><td className="phase10-actions">{member.status === 'ACTIVE' ? <><button type="button" onClick={() => { if (window.confirm(`Revogar o acesso de ${member.user.displayName}?`)) void update(member, { status: 'DISABLED' }) }} disabled={busy}>Revogar</button><button type="button" onClick={() => void request(`/users/${member.id}/revoke-sessions`, { method: 'POST' }).then(() => setNotice('Sessões revogadas.')).catch((error) => setNotice((error as Error).message))} disabled={busy}>Revogar sessões</button></> : <button type="button" onClick={() => void update(member, { status: 'ACTIVE' })} disabled={busy}>Reativar</button>} <button type="button" onClick={() => setUnitDrafts((current) => ({ ...current, [member.id]: current[member.id] ?? member.unitScopes.map(({ unitId }) => unitId) }))}>Unidades</button><button type="button" onClick={() => void loadHistory(member)}>Histórico</button>{role === 'TENANT_ADMIN' && member.user.id !== userId && member.role !== 'PLATFORM_SUPERADMIN' && member.status === 'ACTIVE' && <details className="phase10-password-reset"><summary>Redefinir senha</summary><form className="phase10-form" onSubmit={(event) => void resetMemberPassword(event, member)}><label>Nova senha<input name="password" required type="password" minLength={8} maxLength={72} autoComplete="new-password" /></label><label>Confirmar senha<input name="confirmPassword" required type="password" minLength={8} maxLength={72} autoComplete="new-password" /></label><button className="primary" disabled={busy}>Salvar nova senha</button></form></details>}</td></tr>)}</tbody></table>{users.map((member) => unitDrafts[member.id] && <details open className="phase10-unit-editor" key={`units-${member.id}`}><summary>Unidades de {member.user.displayName}</summary><fieldset><legend>Unidades permitidas</legend>{units.map((unit) => <label key={unit.id}><input type="checkbox" checked={unitDrafts[member.id]!.includes(unit.id)} onChange={(event) => setUnitDrafts((current) => ({ ...current, [member.id]: event.target.checked ? [...current[member.id]!, unit.id] : current[member.id]!.filter((id) => id !== unit.id) }))} />{unit.name}</label>)}</fieldset><button type="button" disabled={busy || !unitDrafts[member.id]!.length} onClick={() => { void update(member, { unitIds: unitDrafts[member.id] }).then(() => setUnitDrafts((current) => { const next = { ...current }; delete next[member.id]; return next })) }}>Salvar unidades</button></details>)}{users.map((member) => history[member.id] && <details className="phase10-history" key={`history-${member.id}`}><summary>Histórico de {member.user.displayName}</summary>{history[member.id]!.length ? <ol>{history[member.id]!.map((event: any) => <li key={event.id}>{event.action} · {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.occurredAt))}</li>)}</ol> : <p>Sem eventos registrados.</p>}</details>)}{!users.length && !busy && <p className="phase10-empty">Nenhum usuário encontrado com esse filtro.</p>}</div>
      {invitations.filter((item) => item.role === 'UNIT_MANAGER').length > 0 && <section className="phase10-invitations"><h3>Convites pendentes de gerente</h3>{invitations.filter((item) => item.role === 'UNIT_MANAGER').map((item) => <p key={item.id}><strong>{item.displayName}</strong> · {item.email} · expira {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.expiresAt))}</p>)}</section>}
    </section>
  </div>
}
