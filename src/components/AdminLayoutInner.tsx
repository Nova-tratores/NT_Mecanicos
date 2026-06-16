'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAdmin } from '@/hooks/useAdmin'
import { supabase } from '@/lib/supabase'
import HeaderAdmin from '@/components/HeaderAdmin'
import { AlertCircle, Film, Image as ImageIcon } from 'lucide-react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
function urlBase64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

const OPA_VIEWS_KEY = 'nt-opa-views-admin'
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

const LAYOUT_TIMEOUT = 8000
function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), LAYOUT_TIMEOUT))])
}

export default function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const { admin, loading, logout } = useAdmin()
  const [opasPendentes, setOpasPendentes] = useState<OpaPopup[]>([])
  const [opaConfirmando, setOpaConfirmando] = useState(false)
  const osNotificadasRef = useRef<Set<number>>(new Set())

  // ── Push subscription para admin ──
  useEffect(() => {
    if (!admin?.tecnico_nome || !VAPID_PUBLIC_KEY) return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready.then(async (reg) => {
      try {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') return
        let sub = await reg.pushManager.getSubscription()
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          })
        }
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tecnico_nome: admin.tecnico_nome, subscription: sub.toJSON() }),
        })
      } catch {}
    })
  }, [admin?.tecnico_nome])

  // ── Listener de novas OS → notifica técnico ──
  useEffect(() => {
    const ch = supabase.channel('os_nova_admin')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'Ordem_Servico',
      }, (payload) => {
        const os = payload.new as any
        if (!os?.Id_Ordem) return
        if (osNotificadasRef.current.has(os.Id_Ordem)) return
        osNotificadasRef.current.add(os.Id_Ordem)
        const tecnicos = [os.Os_Tecnico, os.Os_Tecnico2].filter(Boolean)
        const cliente = os.Os_Cliente || 'Cliente'
        for (const tec of tecnicos) {
          fetch('/api/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tecnico_nome: tec,
              titulo: `Nova OS #${os.Id_Ordem}`,
              descricao: `Cliente: ${cliente}`,
              link: `/os/${os.Id_Ordem}`,
            }),
          }).catch(() => {})
          supabase.from('mecanico_notificacoes').insert({
            tecnico_nome: tec,
            tipo: 'nova_os',
            titulo: `Nova OS #${os.Id_Ordem}`,
            descricao: `Cliente: ${cliente}`,
            link: `/os/${os.Id_Ordem}`,
            lida: false,
          }).then(() => {})
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const carregarOpasPendentes = useCallback(async () => {
    if (!admin?.id) return
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
        .eq('user_id', admin.id)
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
  }, [admin?.id])

  useEffect(() => {
    fetch('/api/opa/escalar', { method: 'POST' }).catch(() => {})
    fetch('/api/os/check-notify', { method: 'POST' }).catch(() => {})
  }, [])

  useEffect(() => {
    carregarOpasPendentes()
    const ch = supabase.channel('opa_popup_admin')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'portal_opas' }, () => carregarOpasPendentes())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [carregarOpasPendentes])

  const confirmarOpa = async () => {
    if (!admin?.id || opasPendentes.length === 0) return
    setOpaConfirmando(true)
    const opa = opasPendentes[0]
    addOpaViewLocal(opa.id)
    setOpasPendentes(prev => prev.filter(o => o.id !== opa.id))
    try {
      await supabase.from('portal_opas_views').upsert({
        opa_id: opa.id, user_id: admin.id,
        user_nome: admin.tecnico_nome || 'Admin',
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

  if (!admin) return null

  return (
    <div style={{ minHeight: '100vh' }}>
      <HeaderAdmin adminNome={admin.tecnico_nome} onLogout={logout} />
      <main style={{ padding: 16 }}>
        {children}
      </main>

      {/* Popup bloqueante de OPA */}
      {opasPendentes.length > 0 && (
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
