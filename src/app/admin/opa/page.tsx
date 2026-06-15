'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAdmin } from '@/hooks/useAdmin'
import { supabase } from '@/lib/supabase'
import { colors, shadow } from '@/lib/ui'
import {
  AlertCircle, Plus, X, Check, CheckCircle2, Camera, Clock,
  Image as ImageIcon, Film, Eye, Trash2, ChevronDown, ChevronUp, User,
} from 'lucide-react'

interface OpaAnexo { id: string; opa_id: string; nome_arquivo: string; url: string; tipo: string | null; tamanho: number | null }
interface OpaView { nome: string; quando: string }
interface Opa {
  id: string
  titulo: string
  descricao: string | null
  criado_por: string | null
  criado_por_nome: string | null
  origem: string
  status: string
  resolvido_por_nome: string | null
  resolvido_por_tipo: string | null
  resolvido_at: string | null
  created_at: string
  anexos?: OpaAnexo[]
  views?: OpaView[]
}

type Aba = 'abertos' | 'concluidos'

function fmtData(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function AdminOpaPage() {
  const { admin } = useAdmin()
  const nome = admin?.tecnico_nome || ''

  const [opas, setOpas] = useState<Opa[]>([])
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<Aba>('abertos')
  const [showModal, setShowModal] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [resolvendo, setResolvendo] = useState<string | null>(null)

  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showModal) {
      const t = setTimeout(() => fileRef.current?.click(), 400)
      return () => clearTimeout(t)
    }
  }, [showModal])

  const carregar = useCallback(async () => {
    const { data: lista } = await supabase.from('portal_opas').select('*').order('created_at', { ascending: false })
    if (!lista) { setLoading(false); return }

    const ids = lista.map(o => o.id)
    const [{ data: anexosData }, { data: viewsData }] = await Promise.all([
      ids.length ? supabase.from('portal_opas_anexos').select('*').in('opa_id', ids) : { data: [] },
      ids.length ? supabase.from('portal_opas_views').select('opa_id, user_nome, visto_at').in('opa_id', ids) : { data: [] },
    ])

    const anexosMap: Record<string, OpaAnexo[]> = {}
    ;(anexosData || []).forEach((a: any) => { (anexosMap[a.opa_id] ||= []).push(a) })
    const viewsMap: Record<string, OpaView[]> = {}
    ;(viewsData || []).forEach((v: any) => { (viewsMap[v.opa_id] ||= []).push({ nome: v.user_nome || 'Usuário', quando: v.visto_at }) })

    setOpas(lista.map(o => ({
      ...o,
      anexos: anexosMap[o.id] || [],
      views: (viewsMap[o.id] || []).sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime()),
    })))
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    const ch = supabase.channel('opa_admin_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_opas' }, () => carregar())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [carregar])

  const registrarView = async (opa: Opa) => {
    if (!admin) return
    if (opa.views?.some(v => v.nome === nome)) return
    await supabase.from('portal_opas_views').upsert({
      opa_id: opa.id, user_id: admin.id, user_nome: nome || 'Admin', visto_at: new Date().toISOString(),
    }, { onConflict: 'opa_id,user_id' })
    carregar()
  }

  const toggleExpandido = (opa: Opa) => {
    if (expandido === opa.id) { setExpandido(null); return }
    setExpandido(opa.id)
    registrarView(opa)
  }

  const criarOpa = async () => {
    if (!titulo.trim() || !admin) return
    setEnviando(true)
    const { data: opa, error } = await supabase.from('portal_opas').insert({
      titulo: titulo.trim(), descricao: descricao.trim() || null,
      criado_por: admin.id, criado_por_nome: nome || 'Admin', origem: 'portal',
    }).select().single()

    if (error || !opa) { setEnviando(false); return }

    for (const file of arquivos) {
      const ext = file.name.split('.').pop()
      const path = `opas/${opa.id}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('anexos').upload(path, file)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('anexos').getPublicUrl(path)
        await supabase.from('portal_opas_anexos').insert({
          opa_id: opa.id, nome_arquivo: file.name, url: urlData.publicUrl,
          tipo: file.type || `application/${ext}`, tamanho: file.size,
        })
      }
    }

    fetch('/api/push/send-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: `Opa: ${titulo.trim()}`,
        descricao: descricao.trim() || 'Novo Opa registrado',
        link: '/opa',
      }),
    }).catch(() => {})

    setTitulo(''); setDescricao(''); setArquivos([]); setShowModal(false); setEnviando(false)
    carregar()
  }

  const resolver = async (opa: Opa) => {
    if (!admin) return
    setResolvendo(opa.id)
    await supabase.rpc('resolver_opa', {
      p_opa_id: opa.id, p_user_id: admin.id, p_user_nome: nome || 'Admin', p_user_tipo: 'portal',
    })
    setResolvendo(null)
    carregar()
  }

  const excluirOpa = async (id: string) => {
    if (!confirm('Excluir este Opa?')) return
    await supabase.from('portal_opas').delete().eq('id', id)
    carregar()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const abertos = opas.filter(o => o.status === 'aberto')
  const concluidos = opas.filter(o => o.status === 'resolvido')
  const lista = aba === 'abertos' ? abertos : concluidos

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: colors.dangerBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertCircle size={24} color={colors.danger} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Opa</div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>Ocorrências — todos veem até resolver</div>
          </div>
        </div>
        <button onClick={() => setShowModal(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 12,
          background: colors.danger, color: '#fff', border: 'none', fontSize: 14, fontWeight: 700,
        }}>
          <Plus size={16} /> Novo
        </button>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 6, background: colors.surfaceAlt, borderRadius: 12, padding: 4 }}>
        {([
          { k: 'abertos' as Aba, label: 'Abertos', n: abertos.length },
          { k: 'concluidos' as Aba, label: 'Concluídos', n: concluidos.length },
        ]).map(t => (
          <button key={t.k} onClick={() => setAba(t.k)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: 9, borderRadius: 9, border: 'none',
            background: aba === t.k ? colors.danger : 'transparent',
            color: aba === t.k ? '#fff' : colors.textMuted,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>
            {t.label}
            <span style={{
              fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 8,
              background: aba === t.k ? 'rgba(255,255,255,0.25)' : colors.surface,
              color: aba === t.k ? '#fff' : colors.textSubtle,
            }}>{t.n}</span>
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
            {aba === 'abertos' ? 'Nenhum Opa aberto — tudo certo!' : 'Nenhum Opa concluído ainda'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lista.map(opa => {
            const isExpanded = expandido === opa.id
            const resolvido = opa.status === 'resolvido'
            return (
              <div key={opa.id} style={{
                background: colors.surface, borderRadius: 16, overflow: 'hidden',
                border: `1px solid ${resolvido ? colors.successBorder : colors.dangerBorder}`, boxShadow: shadow.sm,
              }}>
                <div style={{ height: 3, background: resolvido ? colors.success : colors.danger }} />
                <div onClick={() => toggleExpandido(opa)} style={{ padding: 16, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: colors.text, flex: 1 }}>{opa.titulo}</span>
                    {resolvido
                      ? <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: colors.successBg, color: colors.success, display: 'flex', alignItems: 'center', gap: 3 }}><Check size={10} /> Resolvido</span>
                      : <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: colors.dangerBg, color: colors.danger }}>Aberto</span>}
                    {opa.origem === 'mecanico' && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: '#FEF3C7', color: '#92400E' }}>MECÂNICO</span>
                    )}
                    {isExpanded ? <ChevronUp size={16} color="#999" /> : <ChevronDown size={16} color="#999" />}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: colors.textSubtle, flexWrap: 'wrap' }}>
                    {opa.criado_por_nome && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><User size={10} /> {opa.criado_por_nome}</span>}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={10} /> {fmtData(opa.created_at)}</span>
                    {(opa.anexos?.length || 0) > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><ImageIcon size={10} /> {opa.anexos!.length}</span>}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Eye size={10} /> {opa.views?.length || 0}</span>
                    {resolvido && opa.resolvido_por_nome && (
                      <span style={{ color: colors.success, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <CheckCircle2 size={10} /> {opa.resolvido_por_nome}{opa.resolvido_por_tipo === 'tecnico' ? ' (técnico)' : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Expandido */}
                {isExpanded && (
                  <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${colors.border}` }}>
                    {opa.descricao && (
                      <div style={{ padding: '14px 0', fontSize: 14, lineHeight: 1.7, color: colors.textMuted, whiteSpace: 'pre-wrap' }}>{opa.descricao}</div>
                    )}

                    {/* Anexos */}
                    {opa.anexos && opa.anexos.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: opa.descricao ? 0 : 14 }}>
                        {opa.anexos.map(a => {
                          const isVideo = a.tipo?.startsWith('video')
                          return (
                            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" style={{
                              display: 'block', width: 88, height: 88, borderRadius: 10, overflow: 'hidden',
                              border: `1px solid ${colors.border}`, position: 'relative', background: '#000',
                            }}>
                              {isVideo
                                ? <video src={a.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                              <span style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', borderRadius: 5, padding: 3, display: 'flex' }}>
                                {isVideo ? <Film size={10} color="#fff" /> : <ImageIcon size={10} color="#fff" />}
                              </span>
                            </a>
                          )
                        })}
                      </div>
                    )}

                    {/* Quem visualizou */}
                    {opa.views && opa.views.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Eye size={12} /> {opa.views.length} {opa.views.length > 1 ? 'viram' : 'viu'}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {opa.views.map((v, i) => (
                            <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: colors.surfaceAlt, color: colors.textMuted }}>
                              {v.nome.split(' ').slice(0, 2).join(' ')}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Ações */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
                      {!resolvido && (
                        <button disabled={resolvendo === opa.id} onClick={e => { e.stopPropagation(); resolver(opa) }} style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: 12, borderRadius: 12, border: 'none', background: colors.success, color: '#fff',
                          fontSize: 14, fontWeight: 700, opacity: resolvendo === opa.id ? 0.6 : 1,
                        }}>
                          <Check size={16} /> {resolvendo === opa.id ? 'Resolvendo...' : 'Resolvido'}
                        </button>
                      )}
                      {resolvido && opa.resolvido_at && (
                        <span style={{ fontSize: 12, color: colors.success, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <CheckCircle2 size={14} /> Resolvido em {fmtData(opa.resolvido_at)}
                        </span>
                      )}
                      <div style={{ flex: resolvido ? 1 : 0 }} />
                      <button onClick={e => { e.stopPropagation(); excluirOpa(opa.id) }} style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '10px 14px', borderRadius: 10,
                        border: `1px solid ${colors.dangerBorder}`, background: colors.surface,
                        fontSize: 12, fontWeight: 600, cursor: 'pointer', color: colors.danger,
                      }}>
                        <Trash2 size={13} /> Excluir
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Novo Opa */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50000 }}>
          <div style={{
            background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 540,
            maxHeight: '92vh', overflow: 'auto', padding: '24px 20px env(safe-area-inset-bottom, 20px)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: colors.text, margin: 0 }}>Novo Opa</h2>
              <button onClick={() => setShowModal(false)} style={{
                background: colors.surfaceAlt, border: 'none', width: 32, height: 32, borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
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
                    const url = URL.createObjectURL(f)
                    return (
                      <div key={i} style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: `1px solid ${colors.border}`, background: '#000' }}>
                        {isVideo ? <video src={url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <button onClick={() => setArquivos(prev => prev.filter((_, idx) => idx !== i))} style={{
                          position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.6)', border: 'none',
                          width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
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
                style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.borderStrong}`, fontSize: 14, boxSizing: 'border-box', background: '#FAFAFA' }} />
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>Descrição</div>
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descreva (opcional)..." rows={3}
                style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.borderStrong}`, fontSize: 14, boxSizing: 'border-box', background: '#FAFAFA', resize: 'vertical', fontFamily: 'inherit' }} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowModal(false)} style={{
                flex: 1, padding: 13, borderRadius: 12, fontSize: 14, fontWeight: 700,
                background: colors.surfaceAlt, color: colors.textMuted, border: 'none',
              }}>Cancelar</button>
              <button onClick={criarOpa} disabled={enviando || !titulo.trim()} style={{
                flex: 1, padding: 13, borderRadius: 12, fontSize: 14, fontWeight: 700,
                background: colors.danger, color: '#fff', border: 'none',
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
