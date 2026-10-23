'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { comprimirImagem } from '@/lib/imagem'
import { colors } from '@/lib/ui'
import { PageSpinner } from '@/components/ui'
import {
  AlertCircle, Plus, X, Check, Camera, Image as ImageIcon, Film, Clock, CheckCircle2,
} from 'lucide-react'

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
  const [aba, setAba] = useState<'abertos' | 'meus'>('abertos')
  const [showModal, setShowModal] = useState(false)
  const [resolvendo, setResolvendo] = useState<string | null>(null)
  const [detalheOpa, setDetalheOpa] = useState<Opa | null>(null)

  // Form
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState('')
  const enviandoRef = useRef(false)
  // Botões explícitos (José, 23/10/2026): o clique automático na câmera não abria no iPhone.
  const cameraRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)

  // Prévias criadas uma vez por lista (antes criava no render e nunca liberava a memória)
  const previas = useMemo(() => arquivos.map(f => URL.createObjectURL(f)), [arquivos])
  useEffect(() => () => { previas.forEach(u => URL.revokeObjectURL(u)) }, [previas])
  const adicionar = (input: HTMLInputElement) => {
    const novos = Array.from(input.files || [])
    input.value = ''
    if (novos.length) setArquivos(prev => [...prev, ...novos])
  }

  const carregar = useCallback(async () => {
    const { data: lista } = await supabase
      .from('portal_opas')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (!lista) { setLoading(false); return }
    const ids = lista.map((o: Opa) => o.id)
    let anexos: OpaAnexo[] = []
    if (ids.length) {
      const { data: anx } = await supabase.from('portal_opas_anexos').select('id, opa_id, url, tipo').in('opa_id', ids)
      anexos = anx || []
    }
    setOpas((lista as Opa[]).map(o => ({ ...o, anexos: anexos.filter(a => a.opa_id === o.id) })))
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    const ch = supabase.channel('opa_tec_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_opas' }, () => carregar())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [carregar])

  const criarOpa = async () => {
    if (!titulo.trim() || !user || enviandoRef.current) return
    if (!navigator.onLine) { setErroEnvio('Sem internet. O Opa fica aqui na tela — publique quando tiver sinal.'); return }
    enviandoRef.current = true
    setEnviando(true)
    setErroEnvio('')
    try {
      // 1) Sobe as fotos/vídeos ANTES de criar o Opa: se alguma falhar, avisa quais e não publica pela metade.
      const pasta = `opas/novo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const subidos: { path: string; url: string; nome: string; tipo: string; tamanho: number }[] = []
      const falharam: string[] = []
      for (const file of arquivos) {
        try {
          const video = file.type.startsWith('video')
          const arq = video ? file : await comprimirImagem(file)
          const tipo = arq.type || file.type || 'application/octet-stream'
          let nomeArq = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'anexo'
          if (!video && tipo === 'image/jpeg') nomeArq = nomeArq.replace(/\.[^.]+$/, '') + '.jpg'
          const path = `${pasta}/${Date.now()}_${nomeArq}`
          const { error: upErr } = await supabase.storage.from('requisicoes').upload(path, arq, { upsert: true, contentType: tipo })
          if (upErr) { falharam.push(file.name); continue }
          const { data: urlData } = supabase.storage.from('requisicoes').getPublicUrl(path)
          subidos.push({ path, url: urlData.publicUrl, nome: file.name, tipo, tamanho: arq.size })
        } catch {
          falharam.push(file.name)
        }
      }
      if (falharam.length > 0) {
        if (subidos.length) await supabase.storage.from('requisicoes').remove(subidos.map(s => s.path)).catch(() => {})
        setErroEnvio(`Não subiu: ${falharam.join(', ')}. O Opa não foi publicado — tente de novo.`)
        return
      }

      // 2) Cria o Opa
      const { data: opa, error } = await supabase.from('portal_opas').insert({
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        criado_por: user.id,
        criado_por_nome: nome || 'Técnico',
        origem: 'mecanico',
      }).select().single()
      if (error || !opa) {
        if (subidos.length) await supabase.storage.from('requisicoes').remove(subidos.map(s => s.path)).catch(() => {})
        setErroEnvio(`O Opa não foi publicado${error ? `: ${error.message}` : ''}. Tente de novo.`)
        return
      }

      // 3) Liga os anexos ao Opa
      if (subidos.length > 0) {
        const { error: anErr } = await supabase.from('portal_opas_anexos').insert(subidos.map(s => ({
          opa_id: opa.id,
          nome_arquivo: s.nome,
          url: s.url,
          tipo: s.tipo,
          tamanho: s.tamanho,
        })))
        if (anErr) alert(`O Opa foi publicado, mas as fotos não foram ligadas a ele (${anErr.message}). Avise o escritório.`)
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

    supabase.from('mecanico_usuarios').select('tecnico_nome').eq('ativo', true).then(({ data: tecs }) => {
      if (tecs?.length) {
        supabase.from('mecanico_notificacoes').insert(
          tecs.map(t => ({
            tecnico_nome: t.tecnico_nome,
            tipo: 'opa',
            titulo: `OPA: ${titulo.trim()}`,
            descricao: descricao.trim() || 'Novo OPA registrado',
            link: '/opa',
            lida: false,
          }))
        )
      }
    })

      setTitulo(''); setDescricao(''); setArquivos([]); setShowModal(false)
      carregar()
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  const resolver = async (opa: Opa) => {
    if (!user) return
    setResolvendo(opa.id)
    await supabase.rpc('resolver_opa', {
      p_opa_id: opa.id, p_user_id: user.id, p_user_nome: nome || 'Técnico', p_user_tipo: 'tecnico',
    })
    setResolvendo(null)
    carregar()
  }

  if (loading) return <PageSpinner />

  const abertos = opas.filter(o => o.status === 'aberto')
  const meus = opas.filter(o => o.resolvido_por_nome === nome || o.criado_por === user?.id)
  const lista = aba === 'abertos' ? abertos : meus

  // Estilo POS NewPortal (22/10/2026): aberto = laranja (pendente), resolvido = verde; ação principal azul do portal
  const campo: React.CSSProperties = {
    width: '100%', minHeight: 46, padding: '11px 14px', borderRadius: 12, border: `1px solid ${colors.border}`,
    fontSize: 15, boxSizing: 'border-box', background: colors.surface, color: colors.text, outline: 'none', fontFamily: 'inherit',
  }
  const foco = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { e.currentTarget.style.borderColor = '#38BDF8' }
  const semFoco = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { e.currentTarget.style.borderColor = colors.border }
  const rotulo: React.CSSProperties = { fontSize: 13, color: colors.textMuted, marginBottom: 6 }
  const fechar: React.CSSProperties = {
    background: colors.surface, border: `1px solid ${colors.border}`, width: 36, height: 36, borderRadius: 11,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  }
  const pilula = (resolvido: boolean): React.CSSProperties => ({
    fontSize: 12, fontWeight: 500, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
    background: resolvido ? colors.successBg : colors.warningBg,
    color: resolvido ? colors.success : colors.warning,
    display: 'inline-flex', alignItems: 'center', gap: 4,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: colors.danger, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertCircle size={22} color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 500, color: colors.text }}>Opa</div>
            <div style={{ fontSize: 13, color: colors.textMuted }}>Ocorrências e coisas fora do lugar</div>
          </div>
        </div>
        <button onClick={() => { setErroEnvio(''); setShowModal(true) }} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', height: 44, borderRadius: 12, flexShrink: 0,
          background: colors.primary, color: '#fff', border: 'none', fontSize: 15, fontWeight: 500,
        }}>
          <Plus size={17} /> Novo
        </button>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 4, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 4 }}>
        {([
          { k: 'abertos' as const, label: 'Abertos', n: abertos.length },
          { k: 'meus' as const, label: 'Meus', n: meus.length },
        ]).map(t => (
          <button key={t.k} onClick={() => setAba(t.k)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px', borderRadius: 12, border: 'none',
            background: aba === t.k ? colors.primaryBg : 'transparent', color: aba === t.k ? colors.primary : colors.textSubtle,
            fontSize: 14, fontWeight: aba === t.k ? 500 : 400,
          }}>
            {t.label}
            <span style={{ fontSize: 12, padding: '0 8px', borderRadius: 999, background: aba === t.k ? colors.surface : colors.accentBg, color: aba === t.k ? colors.primary : colors.textSubtle }}>{t.n}</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      {lista.length === 0 ? (
        <div style={{ background: colors.surface, borderRadius: 16, padding: '30px 20px', textAlign: 'center', border: `1px dashed ${colors.borderStrong}` }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11, margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: aba === 'abertos' ? colors.successBg : colors.accentBg,
          }}>
            {aba === 'abertos'
              ? <CheckCircle2 size={22} color={colors.success} />
              : <AlertCircle size={22} color={colors.textSubtle} />}
          </div>
          <div style={{ fontSize: 14, color: colors.textMuted }}>
            {aba === 'abertos' ? 'Nenhum Opa aberto — tudo certo!' : 'Você ainda não criou nem resolveu Opas'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lista.map(opa => {
            const resolvido = opa.status === 'resolvido'
            const cor = resolvido ? colors.success : colors.warning
            return (
              <div key={opa.id} onClick={() => setDetalheOpa(opa)} style={{
                background: colors.surface, borderRadius: 16, overflow: 'hidden',
                border: `1px solid ${colors.border}`, cursor: 'pointer', minWidth: 0,
              }}>
                <div style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 8 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: resolvido ? colors.successBg : colors.warningBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {resolvido ? <CheckCircle2 size={19} color={cor} /> : <AlertCircle size={19} color={cor} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 500, color: colors.text, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{opa.titulo}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: colors.textSubtle, marginTop: 3, flexWrap: 'wrap' }}>
                        <Clock size={12} /> {fmtData(opa.created_at)}
                        {resolvido && opa.resolvido_por_nome && (
                          <span style={{ color: colors.success, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            · <CheckCircle2 size={12} /> {opa.resolvido_por_nome}
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={pilula(resolvido)}>{resolvido ? <><Check size={12} /> Resolvido</> : 'Aberto'}</span>
                  </div>

                  {opa.descricao && (
                    <div style={{ fontSize: 14, color: colors.textMuted, lineHeight: 1.5, marginBottom: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{opa.descricao}</div>
                  )}

                  {opa.anexos && opa.anexos.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: resolvido ? 0 : 10 }}>
                      {opa.anexos.map(a => {
                        const isVideo = a.tipo?.startsWith('video')
                        return (
                          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" style={{ position: 'relative', width: 84, height: 84, borderRadius: 12, overflow: 'hidden', border: `1px solid ${colors.border}`, background: '#0F172A', display: 'block' }}>
                            {isVideo ? <video src={a.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            <span style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(15,23,42,0.6)', borderRadius: 6, padding: 3, display: 'flex' }}>
                              {isVideo ? <Film size={11} color="#fff" /> : <ImageIcon size={11} color="#fff" />}
                            </span>
                          </a>
                        )
                      })}
                    </div>
                  )}

                  {!resolvido && (
                    <button disabled={resolvendo === opa.id} onClick={() => resolver(opa)} style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      height: 46, borderRadius: 12, border: `1px solid ${colors.successBorder}`, background: colors.successBg, color: colors.success,
                      fontSize: 15, fontWeight: 500, opacity: resolvendo === opa.id ? 0.6 : 1,
                    }}>
                      <Check size={17} /> {resolvendo === opa.id ? 'Resolvendo...' : 'Marcar como resolvido'}
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 10000 }}
          onClick={() => setDetalheOpa(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: colors.surface, borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480,
            maxHeight: '92vh', overflow: 'auto', padding: 18,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: detalheOpa.status === 'resolvido' ? colors.success : colors.warning,
                }}>
                  <AlertCircle size={19} color="#fff" />
                </div>
                <span style={pilula(detalheOpa.status === 'resolvido')}>
                  {detalheOpa.status === 'resolvido' ? 'Resolvido' : 'Aberto'}
                </span>
              </div>
              <button onClick={() => setDetalheOpa(null)} aria-label="fechar" style={fechar}>
                <X size={17} color={colors.textMuted} />
              </button>
            </div>

            <h2 style={{ fontSize: 19, fontWeight: 500, color: colors.text, margin: '0 0 6px', overflowWrap: 'anywhere' }}>{detalheOpa.titulo}</h2>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: colors.textSubtle, marginBottom: 14, flexWrap: 'wrap' }}>
              <Clock size={13} /> {fmtData(detalheOpa.created_at)}
              {detalheOpa.resolvido_por_nome && (
                <span style={{ color: colors.success, display: 'flex', alignItems: 'center', gap: 4 }}>
                  · <CheckCircle2 size={13} /> {detalheOpa.resolvido_por_nome}
                </span>
              )}
            </div>

            {detalheOpa.descricao && (
              <div style={{
                fontSize: 14.5, color: colors.text, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                background: colors.surfaceAlt, borderRadius: 12, padding: '12px 14px',
                border: `1px solid ${colors.border}`, marginBottom: 14,
              }}>
                {detalheOpa.descricao}
              </div>
            )}

            {detalheOpa.anexos && detalheOpa.anexos.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                {detalheOpa.anexos.map(a => {
                  const isVideo = a.tipo?.startsWith('video')
                  return (
                    <div key={a.id} style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${colors.border}`, background: '#0F172A' }}>
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
                  height: 48, borderRadius: 12, border: 'none', background: colors.success, color: '#fff',
                  fontSize: 15, fontWeight: 500, opacity: resolvendo === detalheOpa.id ? 0.6 : 1,
                }}>
                <Check size={18} /> Marcar como resolvido
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal Novo Opa */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 10000 }}>
          <div style={{ background: colors.surface, borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '92vh', overflow: 'auto', padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 19, fontWeight: 500, color: colors.text, margin: 0 }}>Novo Opa</h2>
              <button onClick={() => setShowModal(false)} aria-label="fechar" style={fechar}>
                <X size={17} color={colors.textMuted} />
              </button>
            </div>

            {/* Instrução câmera */}
            {arquivos.length === 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', marginBottom: 14,
                background: colors.warningBg, borderRadius: 12, border: `1px solid ${colors.warningBorder}`,
              }}>
                <div style={{ width: 36, height: 36, borderRadius: 11, background: colors.warning, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Camera size={18} color="#fff" />
                </div>
                <div style={{ fontSize: 13.5, color: '#92400E', lineHeight: 1.45 }}>
                  Tire uma foto ou grave um vídeo do problema primeiro, depois preencha os detalhes.
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={rotulo}>Fotos / vídeos</div>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment"
                onChange={e => adicionar(e.target)}
                style={{ display: 'none' }} />
              <input ref={galeriaRef} type="file" accept="image/*,video/*" multiple
                onChange={e => adicionar(e.target)}
                style={{ display: 'none' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => cameraRef.current?.click()} style={{
                  flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52,
                  borderRadius: 12, border: arquivos.length === 0 ? 'none' : `1px dashed ${colors.borderStrong}`,
                  background: arquivos.length === 0 ? colors.primary : colors.surface,
                  fontSize: 15, fontWeight: 500,
                  color: arquivos.length === 0 ? '#fff' : colors.textMuted,
                }}>
                  <Camera size={19} /> {arquivos.length === 0 ? 'Tirar foto' : 'Mais uma foto'}
                </button>
                <button type="button" onClick={() => galeriaRef.current?.click()} style={{
                  flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52,
                  borderRadius: 12, border: `1px dashed ${colors.borderStrong}`, background: colors.surface,
                  fontSize: 15, fontWeight: 500, color: colors.textMuted,
                }}>
                  <ImageIcon size={19} /> Galeria / vídeo
                </button>
              </div>
              {arquivos.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {arquivos.map((f, i) => {
                    const isVideo = f.type.startsWith('video')
                    const url = previas[i]
                    return (
                      <div key={i} style={{ position: 'relative', width: 80, height: 80, borderRadius: 12, overflow: 'hidden', border: `1px solid ${colors.border}`, background: '#0F172A' }}>
                        {isVideo ? <video src={url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <button onClick={() => setArquivos(prev => prev.filter((_, idx) => idx !== i))} aria-label="tirar" style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(15,23,42,0.65)', border: 'none', width: 22, height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <X size={13} color="#fff" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={rotulo}>Título</div>
              <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="O que está fora do lugar?"
                onFocus={foco} onBlur={semFoco} style={campo} />
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={rotulo}>Descrição</div>
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descreva (opcional)..." rows={3}
                onFocus={foco} onBlur={semFoco} style={{ ...campo, resize: 'vertical', lineHeight: 1.5 }} />
            </div>

            {erroEnvio && (
              <div role="alert" style={{ fontSize: 13.5, color: colors.danger, lineHeight: 1.45, marginBottom: 12 }}>{erroEnvio}</div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 15, fontWeight: 500, background: colors.surface, color: colors.text, border: `1px solid ${colors.border}` }}>Cancelar</button>
              <button onClick={criarOpa} disabled={enviando || !titulo.trim()} style={{
                flex: 1, height: 46, borderRadius: 12, fontSize: 15, fontWeight: 500, background: colors.primary, color: '#fff', border: 'none',
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
