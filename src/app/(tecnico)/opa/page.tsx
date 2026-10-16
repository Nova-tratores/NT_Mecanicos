'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase, authHeaders } from '@/lib/supabase'
import { colors, shadow } from '@/lib/ui'
import { PageSpinner } from '@/components/ui'
import {
  AlertCircle, Plus, X, Check, Camera, Image as ImageIcon, Film, Clock, CheckCircle2,
  WifiOff, RefreshCw,
} from 'lucide-react'

const CARREGAR_TIMEOUT = 10000
function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([Promise.resolve(p), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), CARREGAR_TIMEOUT))])
}

interface OpaAnexo { id: string; opa_id: string; url: string; tipo: string | null }
interface Opa {
  id: string
  titulo: string
  descricao: string | null
  origem: string
  status: string
  criado_por: string | null
  resolvido_por_nome: string | null
  resolvido_at: string | null
  created_at: string
  anexos?: OpaAnexo[]
}

function fmtData(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function OpaTecnicoPage() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const [opas, setOpas] = useState<Opa[]>([])
  const [loading, setLoading] = useState(true)
  const [erroCarga, setErroCarga] = useState(false)
  const [aba, setAba] = useState<'abertos' | 'meus'>('abertos')
  const [showModal, setShowModal] = useState(false)
  const [resolvendo, setResolvendo] = useState<string | null>(null)
  const [detalheOpa, setDetalheOpa] = useState<Opa | null>(null)

  // Form
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [erroForm, setErroForm] = useState('')
  const enviandoRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Previews memoizadas: createObjectURL no render recriava (e vazava) um blob a cada tecla
  const previews = useMemo(() => arquivos.map(f => URL.createObjectURL(f)), [arquivos])
  useEffect(() => () => { previews.forEach(u => URL.revokeObjectURL(u)) }, [previews])

  useEffect(() => {
    if (showModal) {
      const t = setTimeout(() => fileRef.current?.click(), 400)
      return () => clearTimeout(t)
    }
  }, [showModal])

  const carregar = useCallback(async () => {
    // Falha de rede NÃO pode virar "Nenhum Opa aberto — tudo certo!"
    try {
      const { data: lista, error } = await withTimeout(supabase
        .from('portal_opas')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200))
      if (error || !lista) throw error || new Error('sem dados')
      const ids = lista.map((o: Opa) => o.id)
      let anexos: OpaAnexo[] = []
      if (ids.length) {
        const { data: anx } = await withTimeout(supabase.from('portal_opas_anexos').select('id, opa_id, url, tipo').in('opa_id', ids))
        anexos = anx || []
      }
      setOpas((lista as Opa[]).map(o => ({ ...o, anexos: anexos.filter(a => a.opa_id === o.id) })))
      setErroCarga(false)
    } catch {
      setErroCarga(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // Voltou a rede → recarrega sozinho
  useEffect(() => {
    const onOnline = () => carregar()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [carregar])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    const ch = supabase.channel('opa_tec_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_opas' }, () => carregar())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [carregar])

  const criarOpa = async () => {
    if (enviandoRef.current || !titulo.trim() || !user) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErroForm('Sem conexão. Seu Opa continua aqui — publique quando o sinal voltar.')
      return
    }
    enviandoRef.current = true
    setEnviando(true)
    setErroForm('')
    try {
    const { data: opa, error } = await supabase.from('portal_opas').insert({
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      criado_por: user.id,
      criado_por_nome: nome || 'Técnico',
      origem: 'mecanico',
    }).select().single()

    if (error || !opa) {
      console.error('[opa] erro ao criar:', error)
      setErroForm('Não foi possível publicar o Opa. Tente novamente.')
      return
    }

    let falhas = 0
    for (const file of arquivos) {
      const ext = file.name.split('.').pop()
      // Storage rejeita espaços/acentos no nome ("Invalid key") — sanitiza
      const nomeSeguro = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `opas/${opa.id}/${Date.now()}_${nomeSeguro}`
      const { error: upErr } = await supabase.storage.from('requisicoes').upload(path, file, { upsert: true })
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('requisicoes').getPublicUrl(path)
        await supabase.from('portal_opas_anexos').insert({
          opa_id: opa.id,
          nome_arquivo: file.name,
          url: urlData.publicUrl,
          tipo: file.type || `application/${ext}`,
          tamanho: file.size,
        })
      } else {
        falhas++
      }
    }

    fetch('/api/push/send-all', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: `Opa: ${titulo.trim()}`,
        descricao: descricao.trim() || 'Novo Opa registrado',
        link: '/opa',
      }),
    }).catch(() => {})

    const tituloNotif = `OPA: ${titulo.trim()}`
    const descNotif = descricao.trim() || 'Novo OPA registrado'
    Promise.resolve(supabase.from('mecanico_usuarios').select('tecnico_nome').eq('ativo', true)).then(async ({ data: tecs }) => {
      if (tecs?.length) {
        await supabase.from('mecanico_notificacoes').insert(
          tecs.map(t => ({
            tecnico_nome: t.tecnico_nome,
            tipo: 'opa',
            titulo: tituloNotif,
            descricao: descNotif,
            link: '/opa',
            lida: false,
          }))
        )
      }
    }).catch(() => {})

    setTitulo(''); setDescricao(''); setArquivos([]); setShowModal(false)
    if (falhas > 0) alert(`Opa publicado, mas ${falhas} anexo(s) não foram enviados. Verifique a conexão.`)
    carregar()
    } catch (err) {
      console.error('[opa] erro ao publicar:', err)
      setErroForm('Não foi possível publicar o Opa. Verifique a conexão e tente novamente.')
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  const resolver = async (opa: Opa) => {
    if (!user || resolvendo) return
    setResolvendo(opa.id)
    try {
      const { error } = await supabase.rpc('resolver_opa', {
        p_opa_id: opa.id, p_user_id: user.id, p_user_nome: nome || 'Técnico', p_user_tipo: 'tecnico',
      })
      if (error) throw error
    } catch (err) {
      console.error('[opa] erro ao resolver:', err)
      alert('Não foi possível marcar como resolvido. Verifique a conexão e tente novamente.')
    } finally {
      setResolvendo(null)
    }
    carregar()
  }

  if (loading) return <PageSpinner />

  // Erro de carga sem nada em memória: dizer a verdade (não "tudo certo")
  if (erroCarga && opas.length === 0) {
    return (
      <div style={{ background: colors.surface, borderRadius: 18, padding: 32, textAlign: 'center', border: `1px solid ${colors.border}` }}>
        <WifiOff size={34} color={colors.textSubtle} style={{ margin: '0 auto 12px', display: 'block' }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 6 }}>Não consegui carregar os Opas</div>
        <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.6, marginBottom: 16 }}>
          Verifique a conexão e tente de novo.
        </div>
        <button onClick={() => { setLoading(true); carregar() }} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px',
          borderRadius: 12, border: 'none', background: colors.primary, color: '#fff',
          fontSize: 14, fontWeight: 700,
        }}>
          <RefreshCw size={16} /> Tentar de novo
        </button>
      </div>
    )
  }

  const abertos = opas.filter(o => o.status === 'aberto')
  const meus = opas.filter(o => o.resolvido_por_nome === nome || o.criado_por === user?.id)
  const lista = aba === 'abertos' ? abertos : meus

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: colors.dangerBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertCircle size={24} color={colors.danger} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Opa</div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>Ocorrências e coisas fora do lugar</div>
          </div>
        </div>
        <button onClick={() => { setErroForm(''); setShowModal(true) }} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 12, flexShrink: 0, minHeight: 44,
          background: colors.danger, color: '#fff', border: 'none', fontSize: 14, fontWeight: 700,
        }}>
          <Plus size={16} /> Novo
        </button>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 6, background: colors.surfaceAlt, borderRadius: 12, padding: 4 }}>
        {([
          { k: 'abertos' as const, label: 'Abertos', n: abertos.length },
          { k: 'meus' as const, label: 'Meus', n: meus.length },
        ]).map(t => (
          <button key={t.k} onClick={() => setAba(t.k)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '9px', borderRadius: 9, border: 'none',
            background: aba === t.k ? colors.danger : 'transparent', color: aba === t.k ? '#fff' : colors.textMuted,
            fontSize: 14, fontWeight: 700,
          }}>
            {t.label}
            <span style={{ fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 8, background: aba === t.k ? 'rgba(255,255,255,0.25)' : colors.surface, color: aba === t.k ? '#fff' : colors.textSubtle }}>{t.n}</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      {lista.length === 0 ? (
        <div style={{ background: colors.surface, borderRadius: 18, padding: 40, textAlign: 'center', border: `1px solid ${colors.border}` }}>
          {aba === 'abertos'
            ? <CheckCircle2 size={36} color={colors.success} style={{ margin: '0 auto 12px', display: 'block' }} />
            : <AlertCircle size={36} color={colors.border} style={{ margin: '0 auto 12px', display: 'block' }} />}
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.textMuted }}>
            {aba === 'abertos' ? 'Nenhum Opa aberto — tudo certo!' : 'Você ainda não criou nem resolveu Opas'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lista.map(opa => {
            const resolvido = opa.status === 'resolvido'
            return (
              <div key={opa.id} onClick={() => setDetalheOpa(opa)} style={{
                background: colors.surface, borderRadius: 16, overflow: 'hidden',
                border: `1px solid ${resolvido ? colors.successBorder : colors.dangerBorder}`, boxShadow: shadow.sm,
                cursor: 'pointer',
              }}>
                <div style={{ height: 3, background: resolvido ? colors.success : colors.danger }} />
                <div style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: colors.text, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{opa.titulo}</span>
                    {resolvido
                      ? <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: colors.successBg, color: colors.success, display: 'flex', alignItems: 'center', gap: 4 }}><Check size={11} /> Resolvido</span>
                      : <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: colors.dangerBg, color: colors.danger }}>Aberto</span>}
                  </div>

                  {opa.descricao && (
                    <div style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{opa.descricao}</div>
                  )}

                  {opa.anexos && opa.anexos.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                      {opa.anexos.map(a => {
                        const isVideo = a.tipo?.startsWith('video')
                        return (
                          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: 88, height: 88, borderRadius: 10, overflow: 'hidden', border: `1px solid ${colors.border}`, background: '#000', display: 'block' }}>
                            {isVideo ? <video src={a.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            <span style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,0.6)', borderRadius: 5, padding: 3, display: 'flex' }}>
                              {isVideo ? <Film size={11} color="#fff" /> : <ImageIcon size={11} color="#fff" />}
                            </span>
                          </a>
                        )
                      })}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: colors.textSubtle, marginBottom: resolvido ? 0 : 12 }}>
                    <Clock size={11} /> {fmtData(opa.created_at)}
                    {resolvido && opa.resolvido_por_nome && (
                      <span style={{ color: colors.success, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        · <CheckCircle2 size={11} /> {opa.resolvido_por_nome}
                      </span>
                    )}
                  </div>

                  {!resolvido && (
                    <button disabled={resolvendo === opa.id} onClick={(e) => { e.stopPropagation(); resolver(opa) }} style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      padding: 12, borderRadius: 12, border: 'none', background: colors.success, color: '#fff',
                      fontSize: 14, fontWeight: 700, opacity: resolvendo === opa.id ? 0.6 : 1,
                    }}>
                      <Check size={16} /> {resolvendo === opa.id ? 'Resolvendo...' : 'Marcar como Resolvido'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Detalhe OPA */}
      {detalheOpa && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 10000 }}
          onClick={() => setDetalheOpa(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480,
            maxHeight: '92vh', overflow: 'auto', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))',
            overscrollBehavior: 'contain',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertCircle size={20} color={detalheOpa.status === 'resolvido' ? colors.success : colors.danger} />
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                  background: detalheOpa.status === 'resolvido' ? colors.successBg : colors.dangerBg,
                  color: detalheOpa.status === 'resolvido' ? colors.success : colors.danger,
                }}>
                  {detalheOpa.status === 'resolvido' ? 'Resolvido' : 'Aberto'}
                </span>
              </div>
              <button onClick={() => setDetalheOpa(null)} aria-label="Fechar" style={{
                background: colors.surfaceAlt, border: 'none', width: 40, height: 40, borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={16} color={colors.textMuted} />
              </button>
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 800, color: colors.text, margin: '0 0 8px', overflowWrap: 'anywhere' }}>{detalheOpa.titulo}</h2>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: colors.textSubtle, marginBottom: 16, flexWrap: 'wrap' }}>
              <Clock size={12} /> {fmtData(detalheOpa.created_at)}
              {detalheOpa.resolvido_por_nome && (
                <span style={{ color: colors.success, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  · <CheckCircle2 size={12} /> {detalheOpa.resolvido_por_nome}
                </span>
              )}
            </div>

            {detalheOpa.descricao && (
              <div style={{
                fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap',
                background: '#F9FAFB', borderRadius: 12, padding: '14px 16px',
                border: '1px solid #F3F4F6', marginBottom: 16,
              }}>
                {detalheOpa.descricao}
              </div>
            )}

            {detalheOpa.anexos && detalheOpa.anexos.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                {detalheOpa.anexos.map(a => {
                  const isVideo = a.tipo?.startsWith('video')
                  return (
                    <div key={a.id} style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${colors.border}`, background: '#000' }}>
                      {isVideo
                        ? <video src={a.url} controls playsInline style={{ width: '100%', maxHeight: 400, objectFit: 'contain', display: 'block' }} />
                        : <img src={a.url} alt="" style={{ width: '100%', maxHeight: 400, objectFit: 'contain', display: 'block' }} />}
                    </div>
                  )
                })}
              </div>
            )}

            {detalheOpa.status !== 'resolvido' && (
              <button
                disabled={resolvendo === detalheOpa.id}
                onClick={() => { resolver(detalheOpa); setDetalheOpa(null) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: 14, borderRadius: 14, border: 'none', background: colors.success, color: '#fff',
                  fontSize: 15, fontWeight: 700, opacity: resolvendo === detalheOpa.id ? 0.6 : 1,
                }}>
                <Check size={18} /> Marcar como Resolvido
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal Novo Opa */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 10000 }}>
          <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '92vh', overflow: 'auto', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))', overscrollBehavior: 'contain' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: colors.text, margin: 0 }}>Novo Opa</h2>
              <button onClick={() => setShowModal(false)} disabled={enviando} aria-label="Fechar" style={{ background: colors.surfaceAlt, border: 'none', width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} color={colors.textMuted} />
              </button>
            </div>

            {/* Instrução câmera */}
            {arquivos.length === 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', marginBottom: 14,
                background: '#FEF3C7', borderRadius: 12, border: '1px solid #FDE68A',
              }}>
                <Camera size={20} color="#D97706" />
                <div style={{ fontSize: 12, color: '#92400E', fontWeight: 600, lineHeight: 1.5 }}>
                  Tire uma <strong>foto ou grave um vídeo</strong> do problema primeiro, depois preencha os detalhes.
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>Fotos / Vídeos</div>
              <input ref={fileRef} type="file" accept="image/*,video/*" capture="environment" multiple
                onChange={e => { setArquivos(prev => [...prev, ...Array.from(e.target.files || [])]); if (fileRef.current) fileRef.current.value = '' }}
                style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 16,
                borderRadius: 12, border: arquivos.length === 0 ? `2px solid ${colors.danger}` : '2px dashed #D1D5DB',
                background: arquivos.length === 0 ? '#FEF2F2' : '#FAFAFA',
                fontSize: 14, fontWeight: 700,
                color: arquivos.length === 0 ? colors.danger : '#9CA3AF',
              }}>
                <Camera size={20} /> {arquivos.length === 0 ? 'Abrir câmera' : 'Adicionar mais'}
              </button>
              {arquivos.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {arquivos.map((f, i) => {
                    const isVideo = f.type.startsWith('video')
                    const url = previews[i]
                    return (
                      <div key={i} style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: `1px solid ${colors.border}`, background: '#000' }}>
                        {isVideo ? <video src={url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <button aria-label="Remover anexo" disabled={enviando} onClick={() => setArquivos(prev => prev.filter((_, idx) => idx !== i))} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', border: 'none', width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <X size={12} color="#fff" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>Título</div>
              <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="O que está fora do lugar?"
                style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.border}`, fontSize: 16, boxSizing: 'border-box', background: '#FAFAFA' }} />
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>Descrição</div>
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descreva (opcional)..." rows={3}
                style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.border}`, fontSize: 16, boxSizing: 'border-box', background: '#FAFAFA', resize: 'vertical', fontFamily: 'inherit' }} />
            </div>

            {erroForm && (
              <div style={{ fontSize: 12, color: colors.danger, fontWeight: 600, marginBottom: 12 }}>{erroForm}</div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowModal(false)} disabled={enviando} style={{ flex: 1, padding: 13, borderRadius: 12, fontSize: 14, fontWeight: 700, background: colors.surfaceAlt, color: colors.textMuted, border: 'none' }}>Cancelar</button>
              <button onClick={criarOpa} disabled={enviando || !titulo.trim()} style={{
                flex: 1, padding: 13, borderRadius: 12, fontSize: 14, fontWeight: 700, background: colors.danger, color: '#fff', border: 'none',
                opacity: (enviando || !titulo.trim()) ? 0.5 : 1,
              }}>
                {enviando ? 'Publicando...' : 'Publicar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
