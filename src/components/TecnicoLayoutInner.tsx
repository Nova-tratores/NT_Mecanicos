'use client'
import { hojeBR } from '@/lib/hoje'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useNotificacoes } from '@/hooks/useNotificacoes'
import { supabase } from '@/lib/supabase'
import HeaderMobile from '@/components/HeaderMobile'
import PushPermissionBanner from '@/components/PushPermissionBanner'
import OfflineSync from '@/components/OfflineSync'
import { prefetchAll, hasPrefetchedBefore } from '@/lib/prefetch'
import { instalarAuthFetch } from '@/lib/apiFetch'

// token do login em todo fetch para /api do app (José, 23/10/2026)
instalarAuthFetch()
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Megaphone, WifiOff, AlertCircle, AlertTriangle, Film, Image as ImageIcon, ChevronRight, Car, ClipboardCheck } from 'lucide-react'

// ── Avisos confirmados: cache local para nunca mostrar de novo ──
const AVISOS_CONFIRMADOS_KEY = 'nt-avisos-confirmados'

// ── OPA vistas: cache local ──
const OPA_VIEWS_KEY = 'nt-opa-views'
function getOpaViewsLocal(): Set<string> {
  try {
    const raw = localStorage.getItem(OPA_VIEWS_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}
function addOpaViewLocal(id: string) {
  const set = getOpaViewsLocal()
  set.add(id)
  localStorage.setItem(OPA_VIEWS_KEY, JSON.stringify([...set]))
}

interface OpaPopup {
  id: string; titulo: string; descricao: string | null
  created_at: string; anexos: { id: string; url: string; tipo: string | null }[]
}

interface OcorrenciaPopup {
  id: number; tipo: string; descricao: string; pontos: number; created_at: string
}

const OCORRENCIA_VIEWS_KEY = 'nt-ocorrencia-views'
function getOcorrenciaViewsLocal(): Set<number> {
  try {
    const raw = localStorage.getItem(OCORRENCIA_VIEWS_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}
function addOcorrenciaViewLocal(id: number) {
  const set = getOcorrenciaViewsLocal()
  set.add(id)
  localStorage.setItem(OCORRENCIA_VIEWS_KEY, JSON.stringify([...set]))
}

function getAvisosConfirmadosLocal(): Set<number> {
  try {
    const raw = localStorage.getItem(AVISOS_CONFIRMADOS_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

function addAvisoConfirmadoLocal(id: number) {
  const set = getAvisosConfirmadosLocal()
  set.add(id)
  localStorage.setItem(AVISOS_CONFIRMADOS_KEY, JSON.stringify([...set]))
}

const LAYOUT_TIMEOUT = 8000
function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), LAYOUT_TIMEOUT))])
}

export default function TecnicoLayoutInner({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useCurrentUser()
  const pathname = usePathname()
  // dois nomes: o do perfil do portal E o do POS — as notificações chegam com
  // qualquer um dos dois, em qualquer caixa ("DANILO DE SOUZA" vs "Danilo de Souza")
  const { notificacoes, naoLidas, historico, historicoAberto, marcarTodasComoLidas, limparTodas, carregarHistorico, fecharHistorico } = useNotificacoes(user?.tecnico_nome ?? '', user?.nome_pos)
  const [avisosPendentes, setAvisosPendentes] = useState<{ id: number; titulo: string; mensagem: string; prioridade: string }[]>([])
  const [confirmando, setConfirmando] = useState(false)

  // ── Checklist veículo: bloqueio global ──
  const [checklistPendente, setChecklistPendente] = useState(false)

  // ── OPA popup state ──
  const [opasPendentes, setOpasPendentes] = useState<OpaPopup[]>([])
  const [opaConfirmando, setOpaConfirmando] = useState(false)

  // ── Ocorrências OPA state ──
  const [ocorrenciasPendentes, setOcorrenciasPendentes] = useState<OcorrenciaPopup[]>([])
  const [ocorrenciaConfirmando, setOcorrenciaConfirmando] = useState(false)

  // ── Ocorrências disciplinares (tecnico_ocorrencias) sem justificativa ──
  const [ocDisciplinares, setOcDisciplinares] = useState(0)

  // ── Interceptor global: offline → MPA navigation (evita RSC 503 loop) ──
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (navigator.onLine) return
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) return
      e.preventDefault()
      e.stopPropagation()
      window.location.href = href
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])


  const carregarAvisosPendentes = useCallback(async () => {
    if (!user?.tecnico_nome) return
    if (!navigator.onLine) return
    try {
    const hoje = hojeBR()
    const { data: avisos } = await withTimeout(supabase
      .from('avisos_gerais')
      .select('id, titulo, mensagem, prioridade')
      .eq('ativo', true)
      .or(`expira_em.is.null,expira_em.gte.${hoje}`)
      .order('created_at', { ascending: true }))
    if (!avisos || avisos.length === 0) { setAvisosPendentes([]); return }

    const ids = avisos.map(a => a.id)
    const { data: confirmados } = await withTimeout(supabase
      .from('avisos_gerais_confirmados')
      .select('aviso_id')
      .eq('tecnico_nome', user.tecnico_nome)
      .in('aviso_id', ids))
    const confirmSet = new Set((confirmados || []).map((c: any) => c.aviso_id))

    // Também filtrar por confirmados localmente (proteção contra re-exibição)
    const localSet = getAvisosConfirmadosLocal()

    setAvisosPendentes(avisos.filter(a => !confirmSet.has(a.id) && !localSet.has(a.id)))
    } catch { /* rede indisponível, ignorar */ }
  }, [user?.tecnico_nome])

  const carregarOpasPendentes = useCallback(async () => {
    if (!user?.id) return
    if (!navigator.onLine) return
    try {
      const { data: opas } = await withTimeout(supabase
        .from('portal_opas')
        .select('id, titulo, descricao, created_at')
        .eq('status', 'aberto')
        .order('created_at', { ascending: true }))
      if (!opas || opas.length === 0) { setOpasPendentes([]); return }

      const ids = opas.map(o => o.id)
      const { data: views } = await withTimeout(supabase
        .from('portal_opas_views')
        .select('opa_id')
        .eq('user_id', user.id)
        .in('opa_id', ids))
      const viewSet = new Set((views || []).map((v: any) => v.opa_id))
      const localSet = getOpaViewsLocal()

      const pendentes = opas.filter(o => !viewSet.has(o.id) && !localSet.has(o.id))
      if (pendentes.length === 0) { setOpasPendentes([]); return }

      const pendIds = pendentes.map(o => o.id)
      const { data: anexos } = await withTimeout(supabase
        .from('portal_opas_anexos')
        .select('id, opa_id, url, tipo')
        .in('opa_id', pendIds))

      setOpasPendentes(pendentes.map(o => ({
        ...o,
        anexos: (anexos || []).filter((a: any) => a.opa_id === o.id),
      })))
    } catch {}
  }, [user?.id])


  // Prefetch de dados para offline (nunca bloqueia navegação)
  useEffect(() => {
    if (!user?.tecnico_nome) return
    const nome = user.nome_pos || user.tecnico_nome

    if (!navigator.onLine && !hasPrefetchedBefore()) {
      const handleOnline = () => { prefetchAll(nome, user.tecnico_nome) }
      window.addEventListener('online', handleOnline)
      return () => window.removeEventListener('online', handleOnline)
    }

    // Adia o prefetch para não competir com o carregamento da tela (deixa a UI
    // responder primeiro; o prefetch é background para offline).
    let timer: ReturnType<typeof setTimeout> | undefined
    if (navigator.onLine) {
      timer = setTimeout(() => prefetchAll(nome, user.tecnico_nome), 3000)
    }

    const handleOnline = () => { prefetchAll(nome, user.tecnico_nome) }
    window.addEventListener('online', handleOnline)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('online', handleOnline)
    }
  }, [user?.tecnico_nome, user?.nome_pos])

  // Navegação: usamos a navegação SPA do Next tanto online quanto offline.
  // O service worker serve os payloads RSC do cache (guardados pela rota),
  // entao offline tambem funciona sem forçar recarga total — que antes fazia
  // a pagina "voltar" para outra tela.

  useEffect(() => {
    carregarAvisosPendentes()
    const ch = supabase.channel('aviso_popup_tec')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'avisos_gerais' }, () => carregarAvisosPendentes())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [carregarAvisosPendentes])

  useEffect(() => {
    carregarOpasPendentes()
    const ch = supabase.channel('opa_popup_tec')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'portal_opas' }, () => carregarOpasPendentes())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [carregarOpasPendentes])

  const carregarOcorrenciasPendentes = useCallback(async () => {
    if (!user?.tecnico_nome) return
    if (!navigator.onLine) return
    try {
      // as ocorrências do Opa (−3/−5) agora nascem no servidor (instrumentation.ts) — José, 23/10/2026
      const { data } = await withTimeout(supabase
        .from('mecanico_ocorrencias')
        .select('id, tipo, descricao, pontos, created_at')
        .eq('tecnico_nome', user.tecnico_nome)
        .in('tipo', ['opa_dia1', 'opa_dia2'])
        .order('created_at', { ascending: true }))
      if (!data?.length) { setOcorrenciasPendentes([]); return }
      const localSet = getOcorrenciaViewsLocal()
      setOcorrenciasPendentes(data.filter(o => !localSet.has(o.id)))
    } catch {}
  }, [user?.tecnico_nome])

  useEffect(() => { carregarOcorrenciasPendentes() }, [carregarOcorrenciasPendentes])

  // Ocorrências do Painel dos Mecânicos ainda sem defesa → banner vermelho
  const carregarOcDisciplinares = useCallback(async () => {
    if (!user?.tecnico_nome) return
    if (!navigator.onLine) return
    try {
      const nomes = [user.tecnico_nome, user.nome_pos]
        .filter((n): n is string => !!n?.trim())
        .filter((n, i, arr) => arr.findIndex(x => x.toLowerCase() === n.toLowerCase()) === i)
      if (nomes.length === 0) return
      const { data } = await withTimeout(supabase
        .from('tecnico_ocorrencias')
        .select('id, tecnico_justificativas(id)')
        .or(nomes.map(n => `tecnico_nome.ilike.${n}`).join(','))
        .order('created_at', { ascending: false })
        .limit(50))
      setOcDisciplinares((data || []).filter((o: any) => !(o.tecnico_justificativas || []).length).length)
    } catch {}
  }, [user?.tecnico_nome, user?.nome_pos])

  useEffect(() => {
    carregarOcDisciplinares()
    const chs = [
      supabase.channel('oc_disc_banner')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_ocorrencias' }, () => carregarOcDisciplinares())
        .subscribe(),
      supabase.channel('oc_disc_banner_just')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_justificativas' }, () => carregarOcDisciplinares())
        .subscribe(),
    ]
    return () => { chs.forEach(c => supabase.removeChannel(c)) }
  }, [carregarOcDisciplinares])

  // Voltou do segundo plano: o iOS derruba o websocket do realtime — recarrega avisos/Opa/ocorrências (José, 23/10/2026)
  useEffect(() => {
    const onVisivel = () => {
      if (document.visibilityState !== 'visible') return
      carregarAvisosPendentes(); carregarOpasPendentes(); carregarOcDisciplinares(); carregarOcorrenciasPendentes()
    }
    document.addEventListener('visibilitychange', onVisivel)
    return () => document.removeEventListener('visibilitychange', onVisivel)
  }, [carregarAvisosPendentes, carregarOpasPendentes, carregarOcDisciplinares, carregarOcorrenciasPendentes])

  // ── Checklist veículo: verificar se está pendente ──
  const verificarChecklist = useCallback(async () => {
    if (!user?.tecnico_nome || !navigator.onLine) return
    try {
      const nome = user.nome_pos || user.tecnico_nome
      const res = await withTimeout(fetch('/api/checklist-veiculo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verificar', tecnico_nome: nome }),
      }))
      if (res.ok) {
        const { pendente } = await res.json()
        setChecklistPendente(pendente)
      }
    } catch {}
  }, [user?.tecnico_nome, user?.nome_pos])

  useEffect(() => {
    verificarChecklist()
  }, [verificarChecklist])

  // Re-verifica quando o técnico volta para a tela (pode ter concluído o checklist)
  useEffect(() => {
    const onFocus = () => verificarChecklist()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [verificarChecklist])

  // Re-verifica ao mudar de rota (técnico pode ter concluído e voltou)
  useEffect(() => {
    verificarChecklist()
  }, [pathname, verificarChecklist])

  const confirmarAviso = async () => {
    if (!user?.tecnico_nome || avisosPendentes.length === 0) return
    setConfirmando(true)
    const aviso = avisosPendentes[0]

    // Salvar localmente ANTES do upsert — garante que nunca re-aparece
    addAvisoConfirmadoLocal(aviso.id)
    setAvisosPendentes(prev => prev.filter(a => a.id !== aviso.id))

    // Persistir no servidor (fire-and-forget se offline)
    try {
      await supabase.from('avisos_gerais_confirmados').upsert({
        aviso_id: aviso.id,
        tecnico_nome: user.tecnico_nome,
      }, { onConflict: 'aviso_id,tecnico_nome' })
    } catch {
      // Se falhar, o cache local já protege
    }
    setConfirmando(false)
  }

  const confirmarOpa = async () => {
    if (!user?.id || opasPendentes.length === 0) return
    setOpaConfirmando(true)
    const opa = opasPendentes[0]
    addOpaViewLocal(opa.id)
    setOpasPendentes(prev => prev.filter(o => o.id !== opa.id))
    try {
      await supabase.from('portal_opas_views').upsert({
        opa_id: opa.id, user_id: user.id,
        user_nome: user.nome_pos || user.tecnico_nome || 'Técnico',
        visto_at: new Date().toISOString(),
      }, { onConflict: 'opa_id,user_id' })
    } catch {}
    setOpaConfirmando(false)
  }

  const confirmarOcorrencia = async () => {
    if (ocorrenciasPendentes.length === 0) return
    setOcorrenciaConfirmando(true)
    const oc = ocorrenciasPendentes[0]
    addOcorrenciaViewLocal(oc.id)
    setOcorrenciasPendentes(prev => prev.filter(o => o.id !== oc.id))
    setOcorrenciaConfirmando(false)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return null


  // Estilo POS NewPortal (22/10/2026): popups em cartão branco com faixa colorida no TOPO (com o nome do tipo),
  // ícone em quadradinho de cor cheia, botão de cantos 12 e sem degradê. Lógica igual.
  const fundoPopup: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
    padding: 16,
  }
  const cartaoPopup: React.CSSProperties = {
    background: '#FEFEFE', borderRadius: 16, width: '100%', maxWidth: 400,
    overflow: 'hidden', border: '1px solid #E2E8F0', boxShadow: '0 24px 48px -24px rgba(15,23,42,0.5)',
    maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
  }
  const faixaTopo = (cor: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 16px', background: cor, color: '#FEFEFE',
    fontSize: 13, fontWeight: 500,
  })
  const quadradinho = (cor: string): React.CSSProperties => ({
    width: 44, height: 44, borderRadius: 11, background: cor,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  })
  const caixaTexto: React.CSSProperties = {
    fontSize: 14.5, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    background: '#EEF2F6', borderRadius: 12, padding: '12px 14px',
    border: '1px solid #E2E8F0',
  }
  const botaoPopup = (cor: string, ocupado: boolean): React.CSSProperties => ({
    width: '100%', height: 48, borderRadius: 12,
    background: cor, color: '#fff', border: 'none',
    fontSize: 15.5, fontWeight: 500, cursor: ocupado ? 'not-allowed' : 'pointer',
    opacity: ocupado ? 0.7 : 1,
  })

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 24, background: '#EEF2F6' }}>
      <OfflineSync />


      <HeaderMobile
        notificacoes={notificacoes}
        naoLidas={naoLidas}
        onMarcarTodasLidas={marcarTodasComoLidas}
        onLimparTodas={limparTodas}
        historico={historico}
        historicoAberto={historicoAberto}
        onAbrirHistorico={carregarHistorico}
        onFecharHistorico={fecharHistorico}
        avatarUrl={user.avatar_url}
        userName={user.tecnico_nome}
      />
      <PushPermissionBanner tecnicoNome={user.nome_pos || user.tecnico_nome} />
      {/* Banner fixo: ocorrência disciplinar sem justificativa */}
      {ocDisciplinares > 0 && (
        <Link href="/ocorrencias" style={{
          // top:64 = altura do HeaderMobile (também sticky) — top:0 cobriria
          // o header e o toque no sino cairia neste Link
          position: 'sticky', top: 'calc(64px + env(safe-area-inset-top, 0px))', zIndex: 30,
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#DC2626', color: '#fff', textDecoration: 'none',
          padding: '9px 16px',
        }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertTriangle size={17} color="#fff" />
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, lineHeight: 1.35 }}>
            Você tem {ocDisciplinares} ocorrência{ocDisciplinares > 1 ? 's' : ''} sem justificativa — toque para justificar
          </span>
          <ChevronRight size={18} color="#fff" style={{ flexShrink: 0 }} />
        </Link>
      )}
      <main style={{ padding: 16 }}>
        {checklistPendente && !pathname.startsWith('/checklist-veiculo') ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh',
          }}>
            <div style={{ ...cartaoPopup, boxShadow: 'none', maxHeight: 'none', textAlign: 'center' }}>
              <div style={faixaTopo('#D97706')}>Checklist do mês</div>
              <div style={{ padding: '22px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ ...quadradinho('#D97706'), width: 56, height: 56, borderRadius: 16 }}>
                  <Car size={28} color="#fff" />
                </div>
                <div>
                  <div style={{ fontSize: 19, fontWeight: 500, color: '#0F172A', marginBottom: 6 }}>
                    Checklist do veículo pendente
                  </div>
                  <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, maxWidth: 300 }}>
                    Você precisa completar a inspeção mensal do seu veículo antes de usar o aplicativo.
                  </div>
                </div>
                <Link href="/checklist-veiculo" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%',
                  height: 48, padding: '0 20px', borderRadius: 12,
                  background: '#0369A1',
                  color: '#fff', textDecoration: 'none',
                  fontSize: 15.5, fontWeight: 500,
                }}>
                  <ClipboardCheck size={19} />
                  Fazer checklist agora
                </Link>
              </div>
            </div>
          </div>
        ) : children}
      </main>

      {/* Popup bloqueante de aviso */}
      {avisosPendentes.length > 0 && (
        <div style={fundoPopup}>
          {(() => {
            const aviso = avisosPendentes[0]
            const isUrgente = aviso.prioridade === 'urgente'
            const cor = isUrgente ? '#DC2626' : '#0369A1'
            return (
              <div style={cartaoPopup}>
                <div style={faixaTopo(cor)}>
                  <span>{isUrgente ? 'Aviso urgente' : 'Aviso importante'}</span>
                  {avisosPendentes.length > 1 && <span style={{ fontSize: 12, opacity: 0.9 }}>1 de {avisosPendentes.length}</span>}
                </div>
                <div style={{ padding: '18px 16px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={quadradinho(cor)}>
                      <Megaphone size={21} color="#fff" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 500, color: '#0F172A', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{aviso.titulo}</div>
                  </div>
                  <div style={{ ...caixaTexto, maxHeight: 250, overflow: 'auto' }}>
                    {aviso.mensagem}
                  </div>
                  <button onClick={confirmarAviso} disabled={confirmando} style={{ ...botaoPopup('#0369A1', confirmando), marginTop: 16 }}>
                    {confirmando ? 'Confirmando...' : 'Confirmado'}
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Popup bloqueante de OPA */}
      {opasPendentes.length > 0 && avisosPendentes.length === 0 && (
        <div style={fundoPopup}>
          {(() => {
            const opa = opasPendentes[0]
            return (
              <div style={cartaoPopup}>
                <div style={faixaTopo('#DC2626')}>
                  <span>Opa!</span>
                  {opasPendentes.length > 1 && <span style={{ fontSize: 12, opacity: 0.9 }}>1 de {opasPendentes.length}</span>}
                </div>
                <div style={{ padding: '18px 16px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={quadradinho('#DC2626')}>
                      <AlertCircle size={22} color="#fff" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 500, color: '#0F172A', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{opa.titulo}</div>
                  </div>

                  {opa.descricao && (
                    <div style={{ ...caixaTexto, maxHeight: 120, overflow: 'auto', marginBottom: 14 }}>
                      {opa.descricao}
                    </div>
                  )}

                  {opa.anexos.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {opa.anexos.map(a => {
                        const isVideo = a.tipo?.startsWith('video')
                        return (
                          <div key={a.id} style={{
                            position: 'relative', width: 100, height: 100, borderRadius: 12,
                            overflow: 'hidden', border: '1px solid #E2E8F0', background: '#0F172A',
                          }}>
                            {isVideo
                              ? <video src={a.url} controls playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            <span style={{
                              position: 'absolute', top: 5, right: 5, background: 'rgba(15,23,42,0.6)',
                              borderRadius: 6, padding: 3, display: 'flex',
                            }}>
                              {isVideo ? <Film size={11} color="#fff" /> : <ImageIcon size={11} color="#fff" />}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <button onClick={confirmarOpa} disabled={opaConfirmando} style={botaoPopup('#0369A1', opaConfirmando)}>
                    {opaConfirmando ? 'Confirmando...' : 'Li e entendi'}
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Popup bloqueante de ocorrência OPA */}
      {ocorrenciasPendentes.length > 0 && avisosPendentes.length === 0 && opasPendentes.length === 0 && (
        <div style={{ ...fundoPopup, background: 'rgba(15,23,42,0.65)' }}>
          {(() => {
            const oc = ocorrenciasPendentes[0]
            const dias = oc.tipo === 'opa_dia2' ? 2 : 1
            return (
              <div style={cartaoPopup}>
                <div style={faixaTopo('#DC2626')}>
                  <span>Ocorrência</span>
                  {ocorrenciasPendentes.length > 1 && <span style={{ fontSize: 12, opacity: 0.9 }}>1 de {ocorrenciasPendentes.length}</span>}
                </div>
                <div style={{ padding: '18px 16px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={quadradinho('#DC2626')}>
                      <AlertTriangle size={22} color="#fff" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 500, color: '#0F172A' }}>Você levou uma ocorrência</div>
                  </div>

                  <div style={{
                    background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12,
                    padding: '12px 14px', marginBottom: 12,
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#991B1B', marginBottom: 4 }}>
                      OPA não resolvida há {dias} dia(s)
                    </div>
                    <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {oc.descricao}
                    </div>
                  </div>

                  <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8,
                    padding: '8px 10px', background: '#FEFEFE', border: '1px solid #FECACA', borderRadius: 12, marginBottom: 10,
                  }}>
                    <span style={{ fontSize: 24, fontWeight: 500, color: '#DC2626' }}>{oc.pontos}</span>
                    <span style={{ fontSize: 13, color: '#991B1B' }}>pontos</span>
                  </div>

                  <div style={{ fontSize: 12.5, color: '#64748B', marginBottom: 14, textAlign: 'center' }}>
                    {new Date(oc.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>

                  <button onClick={confirmarOcorrencia} disabled={ocorrenciaConfirmando} style={botaoPopup('#0369A1', ocorrenciaConfirmando)}>
                    {ocorrenciaConfirmando ? 'Confirmando...' : 'Li e entendi'}
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
