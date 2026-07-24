'use client'
// Ocorrências disciplinares do Painel dos Mecânicos (tecnico_ocorrencias) —
// NÃO confundir com o "Opa" (portal_opas) nem com mecanico_ocorrencias (OPA
// escalada). Aqui o técnico vê as ocorrências que TOMOU, os pontos e pode se
// justificar com texto + fotos/vídeos direto pelo card vermelho.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { colors, shadow } from '@/lib/ui'
import { PageSpinner } from '@/components/ui'
import {
  AlertTriangle, X, Camera, Image as ImageIcon, Film, Clock, CheckCircle2,
  MapPin, ShieldQuestion, Hourglass, XCircle, WifiOff, RefreshCw,
} from 'lucide-react'

const CARREGAR_TIMEOUT = 8000
function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), CARREGAR_TIMEOUT))])
}

interface Justificativa {
  id: number
  id_ocorrencia: number
  justificativa: string
  status: 'pendente' | 'aprovada' | 'recusada'
  descontar_comissao: boolean | null
  avaliado_por: string | null
  data_avaliacao: string | null
  anexos: Anexo[] | null
  created_at: string
}

interface Anexo { url: string; tipo: 'imagem' | 'video'; nome: string; tamanho: number }

interface Ocorrencia {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  tipo: string
  descricao: string
  data: string | null
  pontos_descontados: number
  categoria: string | null
  subcategoria: string | null
  origem: string | null
  anexos: Anexo[] | null
  detalhes: { maps_url?: string } | null
  created_at: string
  tecnico_justificativas: Justificativa[]
}

// ── Catálogo: fallback local (espelho do Portal) + override remoto cacheado ──
const CATEGORIA_INFO: Record<string, { label: string; cor: string }> = {
  os: { label: 'OS', cor: '#0c63e4' },
  pv: { label: 'PV', cor: '#7c3aed' },
  rh: { label: 'RH', cor: '#d97706' },
  frota: { label: 'Frota', cor: '#0d9488' },
  legado: { label: 'Painel', cor: '#71717A' },
}
const SUB_LABEL: Record<string, string> = {
  retorno_servico: 'Retorno de serviço', falta_informacao_os: 'Falta de informação',
  reclamacao_cliente: 'Reclamação de cliente', saida_sem_os: 'Saída sem OS',
  alimentacao_sem_troco: 'Alimentação sem troco', entregue_os_fisica: 'Entregue OS física',
  atraso_ordem: 'Atraso de ordem', apontamento_horas_incorreto: 'Apontamento de horas incorreto',
  falta_informacao_pv: 'Falta de informação', extravio_peca: 'Extravio de peça',
  peca_danificada: 'Peça danificada',
  pandora_cuidados: 'Cuidados com a Pandora/oficina', atraso_sem_justificativa: 'Atraso +5min s/ justificativa',
  falta_sem_justificativa: 'Falta no dia s/ justificativa', atos_subversivos: 'Atos subversivos / agitador',
  falta_epi: 'Falta de EPI', organizacao: 'Organização individual/coletiva',
  tomou_opa: 'Tomou OPA', saida_antecipada: 'Embora mais cedo sem aviso',
  ferramenta_danificada_perdida: 'Ferramenta danificada/perdida', uniforme_apresentacao: 'Uniforme/apresentação',
  checklist_carro: 'Checklist do carro', carro_sujo: 'Carro sujo',
  multa_autuacao: 'Multa/autuação', quebra_acidente: 'Quebra/acidente de carro',
  deslocamento_desnecessario: 'Deslocamento desnecessário', pilotagem_perigosa: 'Pilotagem indevida/perigosa',
  excesso_velocidade: 'Excesso de velocidade', consumo_anormal: 'Consumo de combustível anormal',
  requisicao_abastecimento: 'Requisição p/ abastecimento',
}
const LEGADO_LABEL: Record<string, string> = {
  atraso: 'Atraso', erro: 'Erro', retrabalho: 'Retrabalho',
  falta_material: 'Falta Material', outros: 'Outros',
}

const CATALOGO_CACHE_KEY = 'nt-catalogo-ocorrencias-v2'
interface CatalogoRemoto {
  catalogo: Record<string, { label: string; cor: string; subcategorias: { slug: string; label: string; pontos: number }[] }>
}

// Limites de anexo da defesa (mesmos do Portal)
const MAX_ANEXOS = 5
const MAX_IMG = 10 * 1024 * 1024
const MAX_VIDEO = 50 * 1024 * 1024

function fmtData(iso: string | null) {
  if (!iso) return '—'
  const d = iso.length <= 10 ? new Date(iso + 'T12:00:00') : new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Ocorrência ainda desconta pontos? (só defesa APROVADA sem desconto anula) */
function aindaVale(o: Ocorrencia): boolean {
  return !(o.tecnico_justificativas || []).some(
    j => j.status === 'aprovada' && j.descontar_comissao === false,
  )
}

export default function OcorrenciasTecnicoPage() {
  const { user } = useCurrentUser()
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([])
  const [loading, setLoading] = useState(true)
  const [erroCarga, setErroCarga] = useState(false)
  const [catRemoto, setCatRemoto] = useState<CatalogoRemoto | null>(null)

  // Form de justificativa (um card por vez)
  const [justAberta, setJustAberta] = useState<number | null>(null)
  const [justTexto, setJustTexto] = useState('')
  const [justArquivos, setJustArquivos] = useState<File[]>([])
  const [justEnviando, setJustEnviando] = useState(false)
  const [justErro, setJustErro] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // URLs de preview memoizadas: criar no render faria o <video> recarregar a
  // cada tecla no textarea, e blob URLs nunca revogadas acumulam no PWA.
  const previews = useMemo(() => justArquivos.map(f => URL.createObjectURL(f)), [justArquivos])
  useEffect(() => () => { previews.forEach(u => URL.revokeObjectURL(u)) }, [previews])

  // Nomes candidatos: perfil do portal E nome do POS (caixa pode divergir)
  const nomes = [user?.tecnico_nome, user?.nome_pos]
    .filter((n): n is string => !!n?.trim())
    .filter((n, i, arr) => arr.findIndex(x => x.toLowerCase() === n.toLowerCase()) === i)

  const filtroNomes = nomes.map(n => `tecnico_nome.ilike.${n}`).join(',')

  const carregar = useCallback(async () => {
    if (!filtroNomes) return
    // Erro NÃO pode virar "nenhuma ocorrência" — num sistema disciplinar um
    // falso "tudo certo" contradiz o banner vermelho. Timeout de 8s (padrão
    // do app) pra rede pendurada não prender o spinner.
    try {
      const { data, error } = await withTimeout(supabase
        .from('tecnico_ocorrencias')
        .select('*, tecnico_justificativas(id, id_ocorrencia, justificativa, status, descontar_comissao, avaliado_por, data_avaliacao, anexos, created_at)')
        .or(filtroNomes)
        .order('created_at', { ascending: false })
        .limit(100))
      if (error) throw error
      setOcorrencias((data as Ocorrencia[]) || [])
      setErroCarga(false)
    } catch {
      setErroCarga(true)
    } finally {
      setLoading(false)
    }
  }, [filtroNomes])

  useEffect(() => { carregar() }, [carregar])

  // Voltou a rede → recarrega sozinho
  useEffect(() => {
    const onOnline = () => carregar()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [carregar])

  // Realtime: nova ocorrência ou avaliação da defesa atualiza a tela
  useEffect(() => {
    const chs = [
      supabase.channel('oc_tec_rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_ocorrencias' }, () => carregar())
        .subscribe(),
      supabase.channel('oc_just_rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_justificativas' }, () => carregar())
        .subscribe(),
    ]
    return () => { chs.forEach(c => supabase.removeChannel(c)) }
  }, [carregar])

  // Catálogo remoto (labels/pontos vivos do Portal), com cache local
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CATALOGO_CACHE_KEY)
      if (raw) setCatRemoto(JSON.parse(raw))
    } catch {}
    const base = process.env.NEXT_PUBLIC_PORTAL_URL
    if (!base) return
    fetch(`${base.replace(/\/$/, '')}/api/ocorrencias/catalogo`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j?.catalogo) {
          setCatRemoto(j)
          localStorage.setItem(CATALOGO_CACHE_KEY, JSON.stringify(j))
        }
      })
      .catch(() => {})
  }, [])

  const rotulo = (o: Ocorrencia): { label: string; catLabel: string; cor: string } => {
    const cat = o.categoria && o.categoria !== 'legado' ? o.categoria : null
    if (cat) {
      const rc = catRemoto?.catalogo?.[cat]
      const info = CATEGORIA_INFO[cat] || CATEGORIA_INFO.legado
      const sub = rc?.subcategorias?.find(s => s.slug === o.subcategoria)
      return {
        label: sub?.label || SUB_LABEL[o.subcategoria || ''] || o.subcategoria || o.tipo,
        catLabel: rc?.label || info.label,
        cor: rc?.cor || info.cor,
      }
    }
    return { label: LEGADO_LABEL[o.tipo] || o.tipo, catLabel: 'Painel', cor: CATEGORIA_INFO.legado.cor }
  }

  const validarArquivos = (files: File[]): string | null => {
    if (files.length > MAX_ANEXOS) return `Máximo de ${MAX_ANEXOS} anexos.`
    for (const f of files) {
      const video = f.type.startsWith('video')
      if (video && f.size > MAX_VIDEO) return `Vídeo "${f.name}" passa de 50MB.`
      if (!video && f.size > MAX_IMG) return `Imagem "${f.name}" passa de 10MB.`
    }
    return null
  }

  const enviarJustificativa = async (o: Ocorrencia) => {
    if (!justTexto.trim()) { setJustErro('Escreva a sua justificativa.'); return }
    const errArq = validarArquivos(justArquivos)
    if (errArq) { setJustErro(errArq); return }
    setJustEnviando(true)
    setJustErro('')
    try {
      // Upload dos anexos — mesmo bucket/pasta do Portal
      const anexos: Anexo[] = []
      for (const f of justArquivos) {
        const pasta = `ocorrencias/justificativas/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const nomeArq = f.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const { error: upErr } = await supabase.storage.from('anexos').upload(`${pasta}/${nomeArq}`, f)
        if (upErr) continue
        const { data: urlData } = supabase.storage.from('anexos').getPublicUrl(`${pasta}/${nomeArq}`)
        anexos.push({
          url: urlData.publicUrl,
          tipo: f.type.startsWith('video') ? 'video' : 'imagem',
          nome: f.name,
          tamanho: f.size,
        })
      }
      if (justArquivos.length > 0 && anexos.length === 0) {
        setJustErro('Falha ao enviar os anexos. Tente de novo.')
        setJustEnviando(false)
        return
      }

      const { error } = await supabase.from('tecnico_justificativas').insert({
        tecnico_nome: o.tecnico_nome, // nome exato da ocorrência (casa com o painel)
        id_ordem: o.id_ordem || null,
        id_ocorrencia: o.id,
        justificativa: justTexto.trim(),
        status: 'pendente',
        anexos,
      })
      if (error) { setJustErro(error.message); setJustEnviando(false); return }

      // Avisa os admins do painel (respeitando módulos silenciados)
      try {
        const { data: admins } = await supabase
          .from('portal_permissoes')
          .select('user_id, notif_silenciado')
          .eq('is_admin', true)
        const ids = (admins || [])
          .filter(a => a.user_id && !(a.notif_silenciado || []).includes('pos'))
          .map(a => a.user_id)
        if (ids.length > 0) {
          await supabase.from('portal_notificacoes').insert(
            ids.map(user_id => ({
              user_id,
              tipo: 'pos',
              titulo: `Nova justificativa - ${o.tecnico_nome}`,
              descricao: `${justTexto.trim().slice(0, 100)}${o.id_ordem ? ` (OS: ${o.id_ordem})` : ''}${anexos.length ? ` · ${anexos.length} anexo(s)` : ''}`,
              link: '/painel-mecanicos',
            })),
          )
        }
      } catch {}

      setJustTexto(''); setJustArquivos([]); setJustAberta(null)
      carregar()
    } finally {
      setJustEnviando(false)
    }
  }

  if (loading) return <PageSpinner />

  // Erro de carga sem nada em memória: dizer a verdade (não "zero ocorrências")
  if (erroCarga && ocorrencias.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: colors.dangerBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={24} color={colors.danger} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Ocorrências</div>
        </div>
        <div style={{ background: colors.surface, borderRadius: 18, padding: 32, textAlign: 'center', border: `1px solid ${colors.border}` }}>
          <WifiOff size={34} color={colors.textSubtle} style={{ margin: '0 auto 12px', display: 'block' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 6 }}>
            Não consegui carregar as suas ocorrências
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.6, marginBottom: 16 }}>
            Verifique a conexão e tente de novo — a lista só aparece com internet.
          </div>
          <button onClick={() => { setLoading(true); carregar() }} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px',
            borderRadius: 12, border: 'none', background: colors.primary, color: '#fff',
            fontSize: 14, fontWeight: 700,
          }}>
            <RefreshCw size={16} /> Tentar de novo
          </button>
        </div>
      </div>
    )
  }

  const pendentes = ocorrencias.filter(o => (o.tecnico_justificativas || []).length === 0)
  const historico = ocorrencias.filter(o => (o.tecnico_justificativas || []).length > 0)
  const mesAtual = new Date().toISOString().slice(0, 7)
  const pontosMes = ocorrencias
    .filter(o => aindaVale(o) && (o.data || o.created_at || '').slice(0, 7) === mesAtual)
    .reduce((s, o) => s + (o.pontos_descontados || 0), 0)

  const thumbAnexo = (a: Anexo, i: number) => (
    <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" style={{
      position: 'relative', width: 80, height: 80, borderRadius: 10, overflow: 'hidden',
      border: `1px solid ${colors.border}`, background: '#000', display: 'block', flexShrink: 0,
    }}>
      {a.tipo === 'video'
        ? <video src={a.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      <span style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,0.6)', borderRadius: 5, padding: 3, display: 'flex' }}>
        {a.tipo === 'video' ? <Film size={11} color="#fff" /> : <ImageIcon size={11} color="#fff" />}
      </span>
    </a>
  )

  const badgeDefesa = (j: Justificativa) => {
    const cfg = j.status === 'aprovada'
      ? { bg: colors.successBg, cor: colors.success, Icone: CheckCircle2, label: 'Defesa aprovada' }
      : j.status === 'recusada'
        ? { bg: colors.dangerBg, cor: colors.danger, Icone: XCircle, label: 'Defesa recusada' }
        : { bg: '#FEF3C7', cor: '#D97706', Icone: Hourglass, label: 'Defesa em análise' }
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700,
        padding: '3px 8px', borderRadius: 6, background: cfg.bg, color: cfg.cor,
      }}>
        <cfg.Icone size={11} /> {cfg.label}{j.avaliado_por ? ` · ${j.avaliado_por}` : ''}
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: colors.dangerBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AlertTriangle size={24} color={colors.danger} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Ocorrências</div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>Pontos e justificativas</div>
        </div>
      </div>

      {/* Resumo de pontos */}
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1, background: colors.surface, borderRadius: 16, padding: 14, border: `1px solid ${colors.border}`, boxShadow: shadow.sm, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: pontosMes > 0 ? colors.danger : colors.success }}>
            {Math.max(0, 100 - pontosMes)}
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4 }}>Pontos no mês</div>
        </div>
        <div style={{ flex: 1, background: colors.surface, borderRadius: 16, padding: 14, border: `1px solid ${colors.border}`, boxShadow: shadow.sm, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: pendentes.length > 0 ? colors.danger : colors.text }}>{pendentes.length}</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4 }}>Sem justificativa</div>
        </div>
        <div style={{ flex: 1, background: colors.surface, borderRadius: 16, padding: 14, border: `1px solid ${colors.border}`, boxShadow: shadow.sm, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: colors.text }}>{ocorrencias.length}</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4 }}>Total</div>
        </div>
      </div>

      {ocorrencias.length === 0 && (
        <div style={{ background: colors.surface, borderRadius: 18, padding: 40, textAlign: 'center', border: `1px solid ${colors.border}` }}>
          <CheckCircle2 size={36} color={colors.success} style={{ margin: '0 auto 12px', display: 'block' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.textMuted }}>
            Nenhuma ocorrência — continue assim! 💪
          </div>
        </div>
      )}

      {/* ═══ PENDENTES (vermelho, justificar aqui) ═══ */}
      {pendentes.map(o => {
        const r = rotulo(o)
        const aberta = justAberta === o.id
        return (
          <div key={o.id} style={{
            background: '#FEF2F2', borderRadius: 16, overflow: 'hidden',
            border: '2px solid #FECACA', boxShadow: shadow.sm,
          }}>
            <div style={{ height: 4, background: '#DC2626' }} />
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#DC2626', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                ⚠ Você recebeu uma ocorrência
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: r.cor, color: '#fff' }}>{r.catLabel}</span>
                {o.origem === 'auto' && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: '#111', color: '#fff' }}>AUTO</span>
                )}
                <span style={{ fontSize: 15, fontWeight: 800, color: '#7F1D1D', flex: 1 }}>{r.label}</span>
                <span style={{ fontSize: 14, fontWeight: 900, padding: '4px 10px', borderRadius: 8, background: '#DC2626', color: '#fff', flexShrink: 0 }}>
                  −{o.pontos_descontados} pts
                </span>
              </div>

              <div style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 10 }}>{o.descricao}</div>

              {(o.anexos || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {(o.anexos || []).map(thumbAnexo)}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#991B1B', marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> {fmtData(o.data || o.created_at)}</span>
                {o.id_ordem && <span>OS {o.id_ordem}</span>}
                {o.detalhes?.maps_url && (
                  <a href={o.detalhes.maps_url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#0c63e4', fontWeight: 700 }}>
                    <MapPin size={11} /> Ver no mapa
                  </a>
                )}
              </div>

              {!aberta ? (
                <button onClick={() => { setJustAberta(o.id); setJustTexto(''); setJustArquivos([]); setJustErro('') }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: 13, borderRadius: 12, border: 'none', background: '#DC2626', color: '#fff',
                  fontSize: 14, fontWeight: 700,
                }}>
                  <ShieldQuestion size={17} /> Justificar ocorrência
                </button>
              ) : (
                <div style={{ background: '#fff', borderRadius: 12, padding: 14, border: '1px solid #FECACA' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>Sua justificativa *</div>
                  <textarea
                    value={justTexto}
                    onChange={e => setJustTexto(e.target.value)}
                    placeholder="Explique o que aconteceu..."
                    rows={3}
                    style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.border}`, fontSize: 14, boxSizing: 'border-box', background: '#FAFAFA', resize: 'vertical', fontFamily: 'inherit' }}
                  />
                  <input
                    ref={fileRef} type="file" accept="image/*,video/*" multiple
                    onChange={e => { setJustArquivos(prev => [...prev, ...Array.from(e.target.files || [])].slice(0, MAX_ANEXOS)); if (fileRef.current) fileRef.current.value = '' }}
                    style={{ display: 'none' }}
                  />
                  <button onClick={() => fileRef.current?.click()} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 12, marginTop: 10,
                    borderRadius: 10, border: '2px dashed #D1D5DB', background: '#FAFAFA', fontSize: 13, fontWeight: 700, color: '#6B7280',
                  }}>
                    <Camera size={17} /> Fotos / vídeos ({justArquivos.length}/{MAX_ANEXOS})
                  </button>
                  {justArquivos.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      {justArquivos.map((f, i) => {
                        const isVideo = f.type.startsWith('video')
                        const url = previews[i]
                        return (
                          <div key={i} style={{ position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: `1px solid ${colors.border}`, background: '#000' }}>
                            {isVideo ? <video src={url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            <button onClick={() => setJustArquivos(prev => prev.filter((_, idx) => idx !== i))} style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.6)', border: 'none', width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <X size={12} color="#fff" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {justErro && <div style={{ fontSize: 12, color: colors.danger, fontWeight: 600, marginTop: 8 }}>{justErro}</div>}
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button onClick={() => setJustAberta(null)} style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, background: colors.surfaceAlt, color: colors.textMuted, border: 'none' }}>Cancelar</button>
                    <button onClick={() => enviarJustificativa(o)} disabled={justEnviando || !justTexto.trim()} style={{
                      flex: 2, padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, background: '#DC2626', color: '#fff', border: 'none',
                      opacity: (justEnviando || !justTexto.trim()) ? 0.5 : 1,
                    }}>
                      {justEnviando ? 'Enviando...' : 'Enviar justificativa'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* ═══ HISTÓRICO (já justificadas) ═══ */}
      {historico.length > 0 && (
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 }}>
          Histórico
        </div>
      )}
      {historico.map(o => {
        const r = rotulo(o)
        const j = (o.tecnico_justificativas || [])[0]
        const vale = aindaVale(o)
        return (
          <div key={o.id} style={{
            background: colors.surface, borderRadius: 16, overflow: 'hidden',
            border: `1px solid ${colors.border}`, boxShadow: shadow.sm, opacity: vale ? 1 : 0.65,
          }}>
            <div style={{ height: 3, background: r.cor }} />
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: r.cor, color: '#fff' }}>{r.catLabel}</span>
                {o.origem === 'auto' && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: '#111', color: '#fff' }}>AUTO</span>
                )}
                <span style={{ fontSize: 14, fontWeight: 700, color: colors.text, flex: 1 }}>{r.label}</span>
                <span style={{
                  fontSize: 13, fontWeight: 900, flexShrink: 0,
                  color: vale ? colors.danger : colors.textSubtle,
                  textDecoration: vale ? 'none' : 'line-through',
                }}>
                  −{o.pontos_descontados} pts
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: colors.textMuted, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{o.descricao}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: colors.textSubtle, flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> {fmtData(o.data || o.created_at)}</span>
                {o.id_ordem && <span>OS {o.id_ordem}</span>}
                {o.detalhes?.maps_url && (
                  <a href={o.detalhes.maps_url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#0c63e4', fontWeight: 700 }}>
                    <MapPin size={11} /> Mapa
                  </a>
                )}
                {j && badgeDefesa(j)}
              </div>
              {j?.justificativa && (
                <div style={{ marginTop: 8, fontSize: 12, color: colors.textMuted, background: colors.surfaceAlt, borderRadius: 10, padding: '10px 12px' }}>
                  <strong>Sua defesa:</strong> {j.justificativa}
                  {(j.anexos || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                      {(j.anexos || []).map(thumbAnexo)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div style={{ fontSize: 11, color: colors.textSubtle, textAlign: 'center', lineHeight: 1.6, padding: '4px 12px 12px' }}>
        Cada funcionário começa o mês com 100 pontos. A ocorrência só deixa de
        descontar se a sua justificativa for aprovada pelo gestor.
      </div>
    </div>
  )
}
