import { useState } from 'react'
import './clinic-sidebar.css'

type Props = {
  pages: string[]
  activePage: string
  identity: string
  unitName: string
  integration: { unoStatus: string; activeSource: string } | null
  onNavigate: (page: string) => void
  onLogout: () => void
}

const groups = [
  { title: 'OPERAÇÃO', pages: ['Visão geral', 'Agenda', 'Pacientes', 'Inbox', 'Tarefas', 'Campanhas', 'Relatórios'] },
  { title: 'GESTÃO CLÍNICA', pages: ['Equipe', 'Recursos', 'Automações', 'Canais', 'Uno', 'IA', 'Plano', 'Configurações', 'Privacidade'] },
]
const descriptions: Record<string, string> = {
  'Visão geral': 'Resumo da clínica', Agenda: 'Atendimentos e horários', Pacientes: 'Cadastro e histórico', Inbox: 'Conversas do WhatsApp',
  Tarefas: 'Pendências da equipe', Campanhas: 'Mensagens para pacientes', Relatórios: 'Resultados e NPS', Equipe: 'Usuários e permissões',
  Recursos: 'Profissionais e salas', Automações: 'Fluxos, procedimentos e indicações', Indicações: 'Programa de indicações', Canais: 'WhatsApp e conexões',
  Uno: 'Integração da agenda', IA: 'Rascunhos assistidos', Plano: 'Plano e consumo', Configurações: 'Dados e preferências', Privacidade: 'Solicitações e registros', 'Minha conta': 'Acesso e senha',
}
const iconPaths: Record<string, string> = {
  'Visão geral': 'M3 3h7v7H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 14h7v7H3z',
  Agenda: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16', Pacientes: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M23 11h-6',
  Inbox: 'M4 4h16v13h-5l-3 3-3-3H4z', Tarefas: 'M9 11l2 2 4-4 M5 4h14v16H5z', Campanhas: 'M3 11v2h4l5 4V7l-5 4z M7 13l2 7h3 M16 9a4 4 0 0 1 0 6 M18 6a8 8 0 0 1 0 12',
  Relatórios: 'M4 19V5 M4 19h17 M8 15v-4 M13 15V7 M18 15V3', Equipe: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M16 3.2a4 4 0 0 1 0 7.6 M20 15a4 4 0 0 1 2 4v2',
  Recursos: 'M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-6h6v6 M9 9h.01 M15 9h.01', Automações: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M18.4 5.6l-2.1 2.1 M7.7 16.3l-2.1 2.1 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  Indicações: 'M20 12v8H4v-8 M2 7h20v5H2z M12 22V7 M12 7H7.5a2.5 2.5 0 1 1 2.4-3.2L12 7z M12 7h4.5a2.5 2.5 0 1 0-2.4-3.2L12 7z',
  Canais: 'M4 4h16v12H8l-4 4z', Uno: 'M4 7h16v13H4z M8 7V4h8v3 M8 12h8 M8 16h5', IA: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 15l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z',
  Plano: 'M3 6h18v14H3z M3 10h18 M7 15h4', Configurações: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.9.3l-.1.1h-3.4l-.1-.2a1.7 1.7 0 0 0-1.6-1l-.2.1-2.9-1.7.1-.2a1.7 1.7 0 0 0-.3-1.9l-.1-.1v-3.4l.2-.1a1.7 1.7 0 0 0 1-1.6l-.1-.2 1.7-2.9.2.1a1.7 1.7 0 0 0 1.9-.3l.1-.1h3.4l.1.2a1.7 1.7 0 0 0 1.6 1l.2-.1 2.9 1.7-.1.2a1.7 1.7 0 0 0 .3 1.9l.1.1v3.4z', Privacidade: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z M9 12l2 2 4-4', 'Minha conta': 'M20 21a8 8 0 0 0-16 0 M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10',
}

function Icon({ page }: { page: string }) { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[page] ?? iconPaths['Visão geral']} /></svg> }
function Link({ page, activePage, onNavigate }: { page: string; activePage: string; onNavigate: (page: string) => void }) {
  return <button type="button" className={`clinic-nav-link${page === activePage ? ' is-active' : ''}`} aria-label={page} aria-current={page === activePage ? 'page' : undefined} onClick={() => onNavigate(page)}><Icon page={page} /><span className="clinic-nav-copy"><b>{page}</b><small>{descriptions[page]}</small></span></button>
}

export default function ClinicSidebar({ pages, activePage, identity, unitName, integration, onNavigate, onLogout }: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const available = new Set(pages)
  const source = integration?.activeSource === 'UNO' ? 'Agenda Uno · somente leitura' : integration?.activeSource === 'NATIVE' ? 'Agenda nativa' : 'Fonte da agenda não verificada'
  const uno = integration ? integration.unoStatus === 'CONNECTED' ? 'Uno conectada' : 'Uno desconectada' : 'Verificando integração Uno'
  const operation = groups[0]!.pages.filter(page => available.has(page))
  const management = groups[1]!.pages.filter(page => available.has(page))
  return <aside className="clinic-sidebar">
    <button type="button" className="clinic-sidebar-brand" onClick={() => available.has('Visão geral') && onNavigate('Visão geral')} aria-label="Essencial Clínicas — visão geral"><b>e</b><span><strong>essencial</strong><small>CLÍNICAS</small></span></button>
    <div className="clinic-sidebar-status" aria-live="polite"><span className={`clinic-status-indicator${integration?.unoStatus === 'CONNECTED' ? ' is-online' : ''}`} /><span><b>{source}</b><small>{uno}{unitName ? ` · ${unitName}` : ''}</small></span></div>
    <nav className="clinic-sidebar-nav" aria-label="Navegação principal">
      {operation.length > 0 && <section><h2>{groups[0]!.title}</h2>{operation.map(page => <Link key={page} page={page} activePage={activePage} onNavigate={onNavigate} />)}</section>}
      {management.length > 0 && <section className={`clinic-management-nav${moreOpen ? ' is-open' : ''}`}><h2>{groups[1]!.title}</h2><button type="button" className="clinic-management-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen(open => !open)}>Mais módulos</button>{management.map(page => <Link key={page} page={page} activePage={activePage} onNavigate={onNavigate} />)}</section>}
    </nav>
    <div className="clinic-sidebar-account">{available.has('Minha conta') && <Link page="Minha conta" activePage={activePage} onNavigate={onNavigate} />}<div className="clinic-sidebar-user"><b>{identity.slice(0, 2).toUpperCase() || 'EC'}</b><span><strong>{identity || 'Conta clínica'}</strong><small>Conta autenticada</small></span></div><button type="button" className="clinic-sidebar-logout" onClick={onLogout}>Sair</button></div>
  </aside>
}
