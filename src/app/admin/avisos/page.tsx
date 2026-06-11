'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAdmin } from '@/hooks/useAdmin'
import { colors, shadow } from '@/lib/ui'
import {
  Megaphone, Plus, X, Send, Trash2, Eye, EyeOff,
  ChevronDown, ChevronUp, CheckCircle2, Clock, AlertTriangle,
  Paperclip, FileText, Download,
} from 'lucide-react'

interface ConfirmacaoInfo { nome: string; quando: string }
interface Anexo { id: string; aviso_id: string; nome_arquivo: string; url: string; tipo: string | null; tamanho: number | null }
interface Aviso {
  id: string
  titulo: string
  conteudo: string
  prioridade: string
  criado_por: string
  criado_por_nome: string
  ativo: boolean
  created_at: string
  anexos?: Anexo[]
  lidos_count?: number
  confirmacoes?: ConfirmacaoInfo[]
}

const PRIORIDADE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  baixa:   { label: 'Baixa',   color: '#065F46', bg: '#D1FAE5', border: '#A7F3D0' },
  normal:  { label: 'Normal',  color: '#1E40AF', bg: '#DBEAFE', border: '#93C5FD' },
  alta:    { label: 'Alta',    color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
  urgente: { label: 'Urgente', color: '#DC2626', bg: '#FEE2E2', border: '#FECACA' },
}

function fmtData(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function fmtDataCurta(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export default function AvisosPage() {
  const { admin } = useAdmin()
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [showInativos, setShowInativos] = useState(false)

  // Modal criar
  const [showModal, setShowModal] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [conteudo, setConteudo] = useState('')
  const [prioridade, setPrioridade] = useState('normal')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    if (!admin) return
    setLoading(true)

    const { data: avisosData } = await supabase.from('portal_avisos').select('*').order('created_at', { ascending: false })
    if (!avisosData) { setLoading(false); return }

    const ids = avisosData.map(a => a.id)

    const [{ data: anexosData }, { data: lidosData }] = await Promise.all([
      ids.length ? supabase.from('portal_avisos_anexos').select('*').in('aviso_id', ids) : { data: [] },
      ids.length ? supabase.from('portal_avisos_lidos').select('aviso_id, user_id, lido_at').in('aviso_id', ids) : { data: [] },
    ])

    // Nomes dos users que confirmaram
    const userIds = [...new Set((lidosData || []).map((l: any) => l.user_id))]
    const { data: usersData } = userIds.length
      ? await supabase.from('financeiro_usu').select('id, nome').in('id', userIds)
      : { data: [] }
    const userNomeMap: Record<string, string> = {}
    ;(usersData || []).forEach((u: any) => { userNomeMap[u.id] = u.nome })

    // Confirmações dos mecânicos
    const { data: mecConfData } = await supabase
      .from('avisos_gerais_confirmados').select('aviso_id, tecnico_nome, confirmado_at').order('confirmado_at')

    // Mapear portal_avisos -> avisos_gerais pelo titulo
    const { data: avisosGeraisData } = await supabase.from('avisos_gerais').select('id, titulo').eq('ativo', true)
    const tituloToGeralIds: Record<string, number[]> = {}
    ;(avisosGeraisData || []).forEach((ag: any) => {
      ;(tituloToGeralIds[ag.titulo] ||= []).push(ag.id)
    })

    const anexosMap: Record<string, Anexo[]> = {}
    ;(anexosData || []).forEach((a: any) => { (anexosMap[a.aviso_id] ||= []).push(a) })

    const confirmMap: Record<string, ConfirmacaoInfo[]> = {}
    ;(lidosData || []).forEach((l: any) => {
      const nome = userNomeMap[l.user_id] || 'Usuário'
      ;(confirmMap[l.aviso_id] ||= []).push({ nome, quando: l.lido_at })
    })

    const mecConfMap: Record<number, ConfirmacaoInfo[]> = {}
    ;(mecConfData || []).forEach((c: any) => { (mecConfMap[c.aviso_id] ||= []).push({ nome: c.tecnico_nome, quando: c.confirmado_at }) })

    setAvisos(avisosData.map(a => {
      const confs = [...(confirmMap[a.id] || [])]
      const geralIds = tituloToGeralIds[a.titulo] || []
      geralIds.forEach(gid => { (mecConfMap[gid] || []).forEach(mc => confs.push(mc)) })
      confs.sort((x, y) => new Date(x.quando).getTime() - new Date(y.quando).getTime())
      return { ...a, anexos: anexosMap[a.id] || [], lidos_count: confs.length, confirmacoes: confs }
    }))
    setLoading(false)
  }, [admin])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    const ch = supabase.channel('avisos_admin_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_avisos' }, () => carregar())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [carregar])

  const enviarAviso = async () => {
    if (!titulo.trim() || !conteudo.trim() || !admin) return
    setEnviando(true)

    const { data: aviso, error } = await supabase.from('portal_avisos').insert({
      titulo: titulo.trim(), conteudo: conteudo.trim(), prioridade,
      criado_por: admin.id, criado_por_nome: admin.tecnico_nome || 'Admin',
    }).select().single()

    if (error || !aviso) { setEnviando(false); return }

    for (const file of arquivos) {
      const path = `avisos/${aviso.id}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('anexos').upload(path, file)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('anexos').getPublicUrl(path)
        await supabase.from('portal_avisos_anexos').insert({
          aviso_id: aviso.id, nome_arquivo: file.name, url: urlData.publicUrl,
          tipo: file.type || 'application/octet-stream', tamanho: file.size,
        })
      }
    }

    // Notificar portal users
    const { data: usuarios } = await supabase.from('portal_permissoes').select('user_id')
    if (usuarios?.length) {
      const uids = [...new Set(usuarios.map((u: any) => u.user_id))].filter(uid => uid !== admin.id)
      if (uids.length) {
        await supabase.from('portal_notificacoes').insert(
          uids.map(uid => ({ user_id: uid, tipo: 'sistema', titulo: `Novo aviso: ${titulo.trim()}`, descricao: conteudo.trim().slice(0, 120), link: '/avisos' }))
        )
      }
    }

    // Inserir em avisos_gerais (app mecânicos)
    await supabase.from('avisos_gerais').insert({
      titulo: titulo.trim(), mensagem: conteudo.trim(),
      prioridade: prioridade === 'urgente' ? 'urgente' : 'normal',
      ativo: true, expira_em: null, criado_por: admin.tecnico_nome || 'Admin',
    })

    // Notificar mecânicos
    const { data: tecs } = await supabase.from('portal_permissoes')
      .select('mecanico_tecnico_nome').not('mecanico_tecnico_nome', 'is', null)
    if (tecs?.length) {
      const nomes = [...new Set(tecs.map((t: any) => t.mecanico_tecnico_nome).filter(Boolean))]
      await supabase.from('mecanico_notificacoes').insert(
        nomes.map(n => ({ tecnico_nome: n, tipo: 'aviso', titulo: `Aviso: ${titulo.trim()}`, descricao: conteudo.trim().slice(0, 200), link: '/', lida: false }))
      )
    }

    setTitulo(''); setConteudo(''); setPrioridade('normal'); setArquivos([]); setShowModal(false); setEnviando(false)
    carregar()
  }

  const toggleAtivo = async (aviso: Aviso) => {
    await supabase.from('portal_avisos').update({ ativo: !aviso.ativo, updated_at: new Date().toISOString() }).eq('id', aviso.id)
    carregar()
  }

  const excluirAviso = async (id: string) => {
    if (!confirm('Excluir este aviso?')) return
    await supabase.from('portal_avisos').delete().eq('id', id)
    carregar()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const avisosFiltrados = showInativos ? avisos : avisos.filter(a => a.ativo)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#F3E8FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Megaphone size={22} color="#8B5CF6" />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Avisos</div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>Comunicados para toda a equipe</div>
          </div>
        </div>
        <button onClick={() => setShowModal(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 12,
          background: '#1E3A5F', color: '#fff', border: 'none', fontSize: 14, fontWeight: 700,
        }}>
          <Plus size={16} /> Novo
        </button>
      </div>

      {/* Filtro inativos */}
      <button onClick={() => setShowInativos(!showInativos)} style={{
        alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5,
        padding: '6px 12px', borderRadius: 8, border: `1px solid ${colors.borderStrong}`,
        background: showInativos ? colors.surfaceAlt : colors.surface,
        fontSize: 12, fontWeight: 600, color: colors.textMuted, cursor: 'pointer',
      }}>
        {showInativos ? <EyeOff size={13} /> : <Eye size={13} />}
        {showInativos ? 'Ocultar inativos' : 'Ver inativos'}
      </button>

      {/* Lista */}
      {avisosFiltrados.length === 0 ? (
        <div style={{ background: colors.surface, borderRadius: 18, padding: 40, textAlign: 'center', border: `1px solid ${colors.border}` }}>
          <Megaphone size={36} color={colors.borderStrong} style={{ margin: '0 auto 12px', display: 'block' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.textMuted }}>Nenhum aviso publicado</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {avisosFiltrados.map(aviso => {
            const prio = PRIORIDADE_CONFIG[aviso.prioridade] || PRIORIDADE_CONFIG.normal
            const isExpanded = expandido === aviso.id

            return (
              <div key={aviso.id} style={{
                background: colors.surface, borderRadius: 16, overflow: 'hidden',
                border: `1px solid ${aviso.ativo ? prio.border : colors.border}`,
                boxShadow: shadow.sm, opacity: aviso.ativo ? 1 : 0.6,
              }}>
                <div style={{ height: 3, background: aviso.ativo ? prio.color : colors.borderStrong }} />

                {/* Card header (clicável) */}
                <div onClick={() => setExpandido(isExpanded ? null : aviso.id)} style={{ padding: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>{aviso.titulo}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: prio.bg, color: prio.color }}>{prio.label}</span>
                      {!aviso.ativo && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: colors.surfaceAlt, color: colors.textSubtle }}>Inativo</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: colors.textSubtle, flexWrap: 'wrap' }}>
                      <span>{aviso.criado_por_nome}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={10} /> {fmtData(aviso.created_at)}</span>
                      {(aviso.anexos?.length || 0) > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Paperclip size={10} /> {aviso.anexos!.length}</span>}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><CheckCircle2 size={10} /> {aviso.lidos_count} confirmaram</span>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={16} color="#999" /> : <ChevronDown size={16} color="#999" />}
                </div>

                {/* Conteúdo expandido */}
                {isExpanded && (
                  <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${colors.border}` }}>
                    {/* Texto */}
                    <div style={{ padding: '14px 0', fontSize: 14, lineHeight: 1.7, color: colors.textMuted, whiteSpace: 'pre-wrap' }}>
                      {aviso.conteudo}
                    </div>

                    {/* Anexos */}
                    {aviso.anexos && aviso.anexos.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, marginBottom: 6 }}>Anexos</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {aviso.anexos.map(a => (
                            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" style={{
                              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                              borderRadius: 10, background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
                              textDecoration: 'none', color: colors.text,
                            }}>
                              <FileText size={15} color="#8B5CF6" />
                              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome_arquivo}</span>
                              {a.tamanho && <span style={{ fontSize: 11, color: colors.textSubtle }}>{formatBytes(a.tamanho)}</span>}
                              <Download size={13} color={colors.textSubtle} />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Confirmações */}
                    {aviso.confirmacoes && aviso.confirmacoes.length > 0 ? (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <CheckCircle2 size={12} color={colors.success} />
                          {aviso.confirmacoes.length} pessoa{aviso.confirmacoes.length > 1 ? 's' : ''} confirmaram
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {aviso.confirmacoes.map((c, i) => (
                            <span key={i} style={{
                              fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 7,
                              background: colors.successBg, color: colors.success, border: `1px solid ${colors.successBorder}`,
                              display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                              <CheckCircle2 size={10} />
                              {c.nome.split(' ').slice(0, 2).join(' ')}
                              <span style={{ fontSize: 9, color: '#059669', fontWeight: 500 }}>{fmtDataCurta(c.quando)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginBottom: 12, fontSize: 12, color: colors.danger, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <AlertTriangle size={12} /> Ninguém confirmou ainda
                      </div>
                    )}

                    {/* Ações */}
                    <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
                      <button onClick={e => { e.stopPropagation(); toggleAtivo(aviso) }} style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '9px 14px', borderRadius: 10,
                        border: `1px solid ${colors.borderStrong}`, background: colors.surface,
                        fontSize: 12, fontWeight: 600, cursor: 'pointer', color: colors.textMuted,
                      }}>
                        {aviso.ativo ? <EyeOff size={13} /> : <Eye size={13} />}
                        {aviso.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                      <div style={{ flex: 1 }} />
                      <button onClick={e => { e.stopPropagation(); excluirAviso(aviso.id) }} style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '9px 14px', borderRadius: 10,
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

      {/* ════ Modal Novo Aviso ════ */}
      {showModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50000,
        }}>
          <div style={{
            background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 540,
            maxHeight: '92vh', overflow: 'auto', padding: '24px 20px env(safe-area-inset-bottom, 20px)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: colors.text, margin: 0 }}>Novo Aviso</h2>
              <button onClick={() => setShowModal(false)} style={{
                background: colors.surfaceAlt, border: 'none', width: 32, height: 32, borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={16} color={colors.textMuted} />
              </button>
            </div>

            {/* Titulo */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>Título</div>
              <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Título do aviso..."
                style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.borderStrong}`, fontSize: 14, boxSizing: 'border-box', background: '#FAFAFA' }} />
            </div>

            {/* Conteudo */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>Conteúdo</div>
              <textarea value={conteudo} onChange={e => setConteudo(e.target.value)} placeholder="Escreva o aviso..."
                rows={5} style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.borderStrong}`, fontSize: 14, boxSizing: 'border-box', background: '#FAFAFA', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
            </div>

            {/* Prioridade */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>Prioridade</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {Object.entries(PRIORIDADE_CONFIG).map(([key, cfg]) => (
                  <button key={key} onClick={() => setPrioridade(key)} style={{
                    padding: '9px 0', borderRadius: 9, fontSize: 12, fontWeight: 700,
                    border: prioridade === key ? `2px solid ${cfg.color}` : `1px solid ${colors.borderStrong}`,
                    background: prioridade === key ? cfg.bg : '#fff',
                    color: prioridade === key ? cfg.color : colors.textSubtle, cursor: 'pointer',
                  }}>
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Anexos */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>Anexos</div>
              <input ref={fileRef} type="file" multiple onChange={e => {
                setArquivos(prev => [...prev, ...Array.from(e.target.files || [])])
                if (fileRef.current) fileRef.current.value = ''
              }} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 14,
                borderRadius: 10, border: '2px dashed #D1D5DB', background: '#FAFAFA', fontSize: 13, fontWeight: 600, color: '#9CA3AF',
              }}>
                <Paperclip size={16} /> Adicionar arquivos
              </button>
              {arquivos.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                  {arquivos.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: colors.surfaceAlt, border: `1px solid ${colors.border}` }}>
                      <FileText size={14} color="#8B5CF6" />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <span style={{ fontSize: 11, color: colors.textSubtle }}>{formatBytes(f.size)}</span>
                      <button onClick={() => setArquivos(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', padding: 2, display: 'flex', cursor: 'pointer' }}>
                        <X size={14} color={colors.textSubtle} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Aviso de envio */}
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle size={16} color="#D97706" />
              <span style={{ fontSize: 12, color: '#92400E', fontWeight: 500 }}>
                Será enviado para <strong>todos</strong> do portal e do app.
              </span>
            </div>

            {/* Botões */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowModal(false)} style={{
                flex: 1, padding: 13, borderRadius: 12, fontSize: 14, fontWeight: 700,
                background: colors.surfaceAlt, color: colors.textMuted, border: 'none',
              }}>Cancelar</button>
              <button onClick={enviarAviso} disabled={enviando || !titulo.trim() || !conteudo.trim()} style={{
                flex: 1, padding: 13, borderRadius: 12, fontSize: 14, fontWeight: 700,
                background: (!titulo.trim() || !conteudo.trim() || enviando) ? '#94a3b8' : '#1E3A5F',
                color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Send size={14} /> {enviando ? 'Enviando...' : 'Publicar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
