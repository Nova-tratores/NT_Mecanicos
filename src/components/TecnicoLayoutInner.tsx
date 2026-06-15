'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useNotificacoes } from '@/hooks/useNotificacoes'
import { supabase } from '@/lib/supabase'
import HeaderMobile from '@/components/HeaderMobile'
// BottomNav removido — navegação agora via dashboard
import OfflineSync from '@/components/OfflineSync'
import { prefetchAll, hasPrefetchedBefore } from '@/lib/prefetch'
import dynamic from 'next/dynamic'
const CheckinDiario = dynamic(() => import('@/components/CheckinDiario'), { ssr: false })
import { Megaphone, WifiOff, Download, AlertCircle, Film, Image as ImageIcon } from 'lucide-react'

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
  id: string; titulo: string; descricao: string | null; criado_por_nome: string | null
  created_at: string; anexos: { id: string; url: string; tipo: string | null }[]
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
  const { user, loading } = useCurrentUser()
  const { notificacoes, naoLidas, marcarComoLida, marcarTodasComoLidas, limparTodas } = useNotificacoes(user?.tecnico_nome ?? '')
  const [avisosPendentes, setAvisosPendentes] = useState<{ id: number; titulo: string; mensagem: string; prioridade: string }[]>([])
  const [confirmando, setConfirmando] = useState(false)
  const [checkinFeito, setCheckinFeito] = useState<boolean | null>(true) // temporario: desativado para debug

  // ── OPA popup state ──
  const [opasPendentes, setOpasPendentes] = useState<OpaPopup[]>([])
  const [opaConfirmando, setOpaConfirmando] = useState(false)

  // ── Prefetch state ──
  const [prefetchStatus, setPrefetchStatus] = useState<'idle' | 'loading' | 'done' | 'need-internet'>('idle')
  const [prefetchMsg, setPrefetchMsg] = useState('')

  const carregarAvisosPendentes = useCallback(async () => {
    if (!user?.tecnico_nome) return
    if (!navigator.onLine) return
    try {
    const hoje = new Date().toISOString().split('T')[0]
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
        .select('id, titulo, descricao, criado_por_nome, created_at')
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

  // Verificar check-in diario (fail-open: se erro, libera o app)
  const verificarCheckin = useCallback(async () => {
    if (!user?.tecnico_nome) return
    if (!navigator.onLine) { setCheckinFeito(true); return }
    try {
      const hoje = new Date().toISOString().split('T')[0]
      const { data, error } = await withTimeout(supabase
        .from('checkin_diario')
        .select('id')
        .eq('tecnico_nome', user.tecnico_nome)
        .eq('data', hoje)
        .limit(1))
      if (error) { setCheckinFeito(true); return }
      setCheckinFeito((data && data.length > 0) ? true : false)
    } catch {
      setCheckinFeito(true)
    }
  }, [user?.tecnico_nome])

  useEffect(() => {
    verificarCheckin()
  }, [verificarCheckin])

  // Prefetch de dados para offline (nunca bloqueia navegação)
  useEffect(() => {
    if (!user?.tecnico_nome) return
    const nome = user.nome_pos || user.tecnico_nome

    // Se offline e nunca fez prefetch, agenda para quando voltar online (sem bloquear)
    if (!navigator.onLine && !hasPrefetchedBefore()) {
      setPrefetchStatus('idle')
      const handleOnline = async () => {
        setPrefetchStatus('loading')
        const ok = await prefetchAll(nome, user.tecnico_nome, setPrefetchMsg)
        setPrefetchStatus(ok ? 'done' : 'idle')
      }
      window.addEventListener('online', handleOnline)
      return () => window.removeEventListener('online', handleOnline)
    }

    if (navigator.onLine) {
      setPrefetchStatus('loading')
      prefetchAll(nome, user.tecnico_nome, setPrefetchMsg).then(ok => {
        setPrefetchStatus(ok ? 'done' : 'idle')
      })
    }

    const handleOnline = () => {
      prefetchAll(nome, user.tecnico_nome, setPrefetchMsg)
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [user?.tecnico_nome, user?.nome_pos])

  // ── Interceptor de navegação offline ──
  // SEMPRE usa MPA navigation (window.location.href) para links internos.
  // O SW serve do cache quando offline. Confiabilidade > velocidade de transição.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) return
      if (href === window.location.pathname) return

      e.preventDefault()
      e.stopPropagation()
      window.location.href = href
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [])

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

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return null

  // Check-in diario bloqueante (antes de tudo)
  if (checkinFeito === false) {
    return (
      <CheckinDiario
        tecnicoNome={user.tecnico_nome}
        nomeBusca={user.nome_pos || user.tecnico_nome}
        onComplete={() => setCheckinFeito(true)}
      />
    )
  }

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 24 }}>
      <OfflineSync />

      {/* Banner de prefetch em andamento */}
      {prefetchStatus === 'loading' && prefetchMsg && (
        <div style={{
          position: 'fixed', bottom: 20, left: 16, right: 16, zIndex: 9998,
          background: '#1E3A5F', color: '#fff', padding: '12px 18px',
          borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          <Download size={16} className="spinner" />
          {prefetchMsg}
        </div>
      )}

      <HeaderMobile
        notificacoes={notificacoes}
        naoLidas={naoLidas}
        onMarcarLida={marcarComoLida}
        onMarcarTodasLidas={marcarTodasComoLidas}
        onLimparTodas={limparTodas}
        avatarUrl={user.avatar_url}
        userName={user.tecnico_nome}
      />
      <main style={{ padding: 16 }}>
        {children}
      </main>

      {/* Popup bloqueante de aviso */}
      {avisosPendentes.length > 0 && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
          padding: 16,
        }}>
          {(() => {
            const aviso = avisosPendentes[0]
            const isUrgente = aviso.prioridade === 'urgente'
            return (
              <div style={{
                background: '#fff', borderRadius: 20, width: '100%', maxWidth: 400,
                overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
              }}>
                <div style={{ height: 5, background: isUrgente ? '#DC2626' : '#1E3A5F' }} />
                <div style={{ padding: '24px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 14,
                      background: isUrgente ? '#FEE2E2' : '#DBEAFE',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <Megaphone size={24} color={isUrgente ? '#DC2626' : '#1E3A5F'} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, textTransform: 'uppercase' }}>
                        Aviso Importante {avisosPendentes.length > 1 ? `(1 de ${avisosPendentes.length})` : ''}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>{aviso.titulo}</div>
                    </div>
                  </div>
                  <div style={{
                    fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap',
                    maxHeight: 250, overflow: 'auto',
                    background: '#F9FAFB', borderRadius: 12, padding: '14px 16px',
                    border: '1px solid #F3F4F6',
                  }}>
                    {aviso.mensagem}
                  </div>
                  <button onClick={confirmarAviso} disabled={confirmando} style={{
                    width: '100%', marginTop: 20, padding: 15, borderRadius: 14,
                    background: isUrgente ? '#DC2626' : '#1E3A5F', color: '#fff', border: 'none',
                    fontSize: 16, fontWeight: 800, cursor: confirmando ? 'not-allowed' : 'pointer',
                    opacity: confirmando ? 0.7 : 1,
                  }}>
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
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
          padding: 16,
        }}>
          {(() => {
            const opa = opasPendentes[0]
            return (
              <div style={{
                background: '#fff', borderRadius: 20, width: '100%', maxWidth: 400,
                overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
              }}>
                <div style={{ height: 5, background: '#DC2626' }} />
                <div style={{ padding: '24px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 14, background: '#FEE2E2',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <AlertCircle size={24} color="#DC2626" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, textTransform: 'uppercase' }}>
                        Opa! {opasPendentes.length > 1 ? `(1 de ${opasPendentes.length})` : ''}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>{opa.titulo}</div>
                    </div>
                  </div>

                  {opa.descricao && (
                    <div style={{
                      fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap',
                      maxHeight: 120, overflow: 'auto',
                      background: '#F9FAFB', borderRadius: 12, padding: '14px 16px',
                      border: '1px solid #F3F4F6', marginBottom: 14,
                    }}>
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
                            overflow: 'hidden', border: '1px solid #E5E7EB', background: '#000',
                          }}>
                            {isVideo
                              ? <video src={a.url} controls playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            <span style={{
                              position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,0.6)',
                              borderRadius: 5, padding: 3, display: 'flex',
                            }}>
                              {isVideo ? <Film size={11} color="#fff" /> : <ImageIcon size={11} color="#fff" />}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {opa.criado_por_nome && (
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>
                      Criado por <strong>{opa.criado_por_nome}</strong> · {new Date(opa.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}

                  <button onClick={confirmarOpa} disabled={opaConfirmando} style={{
                    width: '100%', padding: 15, borderRadius: 14,
                    background: '#DC2626', color: '#fff', border: 'none',
                    fontSize: 16, fontWeight: 800, cursor: opaConfirmando ? 'not-allowed' : 'pointer',
                    opacity: opaConfirmando ? 0.7 : 1,
                  }}>
                    {opaConfirmando ? 'Confirmando...' : 'Li e Entendi'}
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
