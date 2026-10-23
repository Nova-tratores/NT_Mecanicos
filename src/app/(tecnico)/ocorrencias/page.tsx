'use client'
import { hojeBR } from '@/lib/hoje'
// Ocorrências disciplinares do Painel dos Mecânicos (tecnico_ocorrencias) —
// NÃO confundir com o "Opa" (portal_opas) nem com mecanico_ocorrencias (OPA
// escalada). Aqui o técnico vê as ocorrências que TOMOU, os pontos e pode se
// justificar com texto + fotos/vídeos direto pelo card vermelho.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import { supabase } from '@/lib/supabase'
import { comprimirImagem } from '@/lib/imagem'
import { colors } from '@/lib/ui'
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
  sem_requisicao: 'Não pediu requisição',
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
  const enviandoRef = useRef(false)

  // Rascunho por ocorrência (José, 23/10/2026): fechar o quadro ou sair da tela não perde o texto.
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({})
  const getRascunho = useCallback(() => ({ rascunhos }), [rascunhos])
  const setRascunho = useCallback((d: Record<string, unknown>) => {
    if (d.rascunhos && typeof d.rascunhos === 'object') setRascunhos(d.rascunhos as Record<string, string>)
  }, [])
  const { restore: restoreRascunho } = useFormBackup('ocorrencias-justificativa', getRascunho, setRascunho)
  useEffect(() => { restoreRascunho() }, [restoreRascunho])
  const mudarTexto = (id: number, t: string) => {
    setJustTexto(t)
    setRascunhos(prev => {
      const n = { ...prev }
      if (t.trim()) n[id] = t
      else delete n[id]
      return n
    })
  }

  // Anexos: soma ao que já tem; passou do limite avisa (antes cortava calado)
  const adicionarArquivos = (input: HTMLInputElement) => {
    const novos = Array.from(input.files || [])
    input.value = ''
    if (!novos.length) return
    setJustArquivos(prev => {
      const todos = [...prev, ...novos]
      if (todos.length > MAX_ANEXOS) {
        setJustErro(`Máximo de ${MAX_ANEXOS} anexos — ${todos.length - MAX_ANEXOS} ficaram de fora.`)
        return todos.slice(0, MAX_ANEXOS)
      }
      setJustErro('')
      return todos
    })
  }

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

  // Realtime: nova ocorrência ou avaliação da defesa atualiza a tela.
  // Só as do técnico (antes escutava a tabela inteira e recarregava a cada ocorrência de qualquer um).
  const nomesRt = nomes.flatMap(n => [n, n.toUpperCase()]).filter((n, i, a) => a.indexOf(n) === i).join('|')
  useEffect(() => {
    if (!nomesRt) return
    const lista = nomesRt.split('|')
    const ch = supabase.channel(`oc_rt_${Date.now()}`)
    for (const n of lista) {
      const filter = `tecnico_nome=eq.${n}`
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_ocorrencias', filter }, () => carregar())
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_justificativas', filter }, () => carregar())
    }
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [carregar, nomesRt])

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
    if (enviandoRef.current) return
    if (!navigator.onLine) { setJustErro('Sem internet. Seu texto fica guardado aqui — envie quando tiver sinal.'); return }
    enviandoRef.current = true
    setJustEnviando(true)
    setJustErro('')
    try {
      // Upload dos anexos — mesmo bucket/pasta do Portal. Foto sai comprimida.
      // Se algum falhar, não envia a defesa pela metade: avisa quais e apaga os que subiram.
      const anexos: Anexo[] = []
      const subidos: string[] = []
      const falharam: string[] = []
      for (const f of justArquivos) {
        try {
          const video = f.type.startsWith('video')
          const arq = video ? f : await comprimirImagem(f)
          const pasta = `ocorrencias/justificativas/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          let nomeArq = f.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'anexo'
          if (!video && arq.type === 'image/jpeg') nomeArq = nomeArq.replace(/\.[^.]+$/, '') + '.jpg'
          const { error: upErr } = await supabase.storage.from('anexos').upload(`${pasta}/${nomeArq}`, arq, { contentType: arq.type || f.type || undefined })
          if (upErr) { falharam.push(f.name); continue }
          subidos.push(`${pasta}/${nomeArq}`)
          const { data: urlData } = supabase.storage.from('anexos').getPublicUrl(`${pasta}/${nomeArq}`)
          anexos.push({
            url: urlData.publicUrl,
            tipo: video ? 'video' : 'imagem',
            nome: f.name,
            tamanho: arq.size,
          })
        } catch {
          falharam.push(f.name)
        }
      }
      if (falharam.length > 0) {
        if (subidos.length) await supabase.storage.from('anexos').remove(subidos).catch(() => {})
        setJustErro(`${navigator.onLine ? '' : 'Sem internet. '}Não subiu: ${falharam.join(', ')}. Nada foi enviado — tente de novo.`)
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
      if (error) {
        if (subidos.length) await supabase.storage.from('anexos').remove(subidos).catch(() => {})
        setJustErro(`Não foi enviada: ${error.message}. Seu texto continua aqui.`)
        return
      }

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
      setRascunhos(prev => { const n = { ...prev }; delete n[o.id]; return n })
      carregar()
    } finally {
      enviandoRef.current = false
      setJustEnviando(false)
    }
  }


  // Estilo POS NewPortal (22/10/2026): vermelho só para ocorrência a justificar e pontos perdidos;
  // categoria em pílula clarinha na cor do catálogo; sem faixa lateral.
  const clarinho = (cor: string, pct = 10) => `color-mix(in srgb, ${cor} ${pct}%, #FEFEFE)`
  const cabecalho = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 44, height: 44, borderRadius: 11, background: colors.warning, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <AlertTriangle size={22} color="#fff" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 500, color: colors.text }}>Ocorrências</div>
        <div style={{ fontSize: 13, color: colors.textMuted }}>Pontos e justificativas</div>
      </div>
    </div>
  )
  const pilulaCat = (cor: string, txt: string) => (
    <span style={{ fontSize: 12, fontWeight: 500, padding: '1px 9px', borderRadius: 999, background: clarinho(cor), color: cor, border: `1px solid ${clarinho(cor, 25)}`, whiteSpace: 'nowrap' }}>{txt}</span>
  )
  const pilulaAuto = (
    <span style={{ fontSize: 12, padding: '1px 9px', borderRadius: 999, background: colors.accentBg, color: colors.textMuted, border: `1px solid ${colors.border}` }}>Automática</span>
  )

  if (loading) return <PageSpinner />

  // Erro de carga sem nada em memória: dizer a verdade (não "zero ocorrências")
  if (erroCarga && ocorrencias.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {cabecalho}
        <div style={{ background: colors.surface, borderRadius: 16, padding: '28px 20px', textAlign: 'center', border: `1px solid ${colors.border}` }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: colors.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <WifiOff size={21} color={colors.textSubtle} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, color: colors.text, marginBottom: 6 }}>
            Não consegui carregar as suas ocorrências
          </div>
          <div style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.5, marginBottom: 16 }}>
            Verifique a conexão e tente de novo — a lista só aparece com internet.
          </div>
          <button onClick={() => { setLoading(true); carregar() }} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 22px', height: 46,
            borderRadius: 12, border: 'none', background: colors.primary, color: '#fff',
            fontSize: 15, fontWeight: 500,
          }}>
            <RefreshCw size={16} /> Tentar de novo
          </button>
        </div>
      </div>
    )
  }

  const pendentes = ocorrencias.filter(o => (o.tecnico_justificativas || []).length === 0)
  const historico = ocorrencias.filter(o => (o.tecnico_justificativas || []).length > 0)
  const mesAtual = hojeBR().slice(0, 7)
  const pontosMes = ocorrencias
    .filter(o => aindaVale(o) && (o.data || o.created_at || '').slice(0, 7) === mesAtual)
    .reduce((s, o) => s + (o.pontos_descontados || 0), 0)

  const thumbAnexo = (a: Anexo, i: number) => (
    <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" style={{
      position: 'relative', width: 80, height: 80, borderRadius: 12, overflow: 'hidden',
      border: `1px solid ${colors.border}`, background: '#0F172A', display: 'block', flexShrink: 0,
    }}>
      {a.tipo === 'video'
        ? <video src={a.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      <span style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(15,23,42,0.6)', borderRadius: 6, padding: 3, display: 'flex' }}>
        {a.tipo === 'video' ? <Film size={11} color="#fff" /> : <ImageIcon size={11} color="#fff" />}
      </span>
    </a>
  )

  const badgeDefesa = (j: Justificativa) => {
    const cfg = j.status === 'aprovada'
      ? { bg: colors.successBg, cor: colors.success, Icone: CheckCircle2, label: 'Defesa aprovada' }
      : j.status === 'recusada'
        ? { bg: colors.dangerBg, cor: colors.danger, Icone: XCircle, label: 'Defesa recusada' }
        : { bg: '#F5F3FF', cor: '#7C3AED', Icone: Hourglass, label: 'Defesa em análise' }
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500,
        padding: '2px 9px', borderRadius: 999, background: cfg.bg, color: cfg.cor,
      }}>
        <cfg.Icone size={12} /> {cfg.label}{j.avaliado_por ? ` · ${j.avaliado_por}` : ''}
      </span>
    )
  }

  const numero = (rot: string, valor: number, cor: string, dica: string) => (
    <div style={{ flex: 1, minWidth: 0, background: clarinho(cor, 7), borderRadius: 16, padding: '10px 12px', border: `1px solid ${clarinho(cor, 22)}` }}>
      <div style={{ fontSize: 12.5, color: colors.textMuted, lineHeight: 1.2 }}>{rot}</div>
      <div style={{ fontSize: 26, fontWeight: 500, color: cor, lineHeight: 1.1, marginTop: 4 }}>{valor}</div>
      <div style={{ fontSize: 12, color: colors.textSubtle }}>{dica}</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {cabecalho}

      {/* Resumo de pontos */}
      <div style={{ display: 'flex', gap: 8 }}>
        {numero('Pontos no mês', Math.max(0, 100 - pontosMes), pontosMes > 0 ? colors.danger : colors.success, 'de 100')}
        {numero('A justificar', pendentes.length, pendentes.length > 0 ? colors.danger : colors.success, pendentes.length > 0 ? 'sem defesa' : 'tudo certo')}
        {numero('Total', ocorrencias.length, '#475569', 'ocorrências')}
      </div>

      {ocorrencias.length === 0 && (
        <div style={{ background: colors.surface, borderRadius: 16, padding: '30px 20px', textAlign: 'center', border: `1px dashed ${colors.borderStrong}` }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: colors.successBg, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <CheckCircle2 size={22} color={colors.success} />
          </div>
          <div style={{ fontSize: 14, color: colors.textMuted }}>
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
            background: clarinho(colors.danger, 5), borderRadius: 16, overflow: 'hidden',
            border: `1px solid ${colors.dangerBorder}`, minWidth: 0,
          }}>
            {/* faixa no topo com o aviso */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: colors.danger, color: '#fff', fontSize: 13, fontWeight: 500 }}>
              <AlertTriangle size={14} /> Você recebeu uma ocorrência
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
                    {pilulaCat(r.cor, r.catLabel)}
                    {o.origem === 'auto' && pilulaAuto}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: colors.text, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{r.label}</div>
                </div>
                <span style={{ fontSize: 15, fontWeight: 500, padding: '3px 10px', borderRadius: 999, background: colors.danger, color: '#fff', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  −{o.pontos_descontados} pts
                </span>
              </div>

              <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 10, background: colors.surface, borderRadius: 10, padding: '9px 11px' }}>{o.descricao}</div>

              {(o.anexos || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {(o.anexos || []).map(thumbAnexo)}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: colors.textMuted, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 999, background: colors.surface, border: `1px solid ${colors.border}` }}><Clock size={12} /> {fmtData(o.data || o.created_at)}</span>
                {o.id_ordem && <span style={{ padding: '2px 9px', borderRadius: 999, background: colors.surface, border: `1px solid ${colors.border}` }}>OS {o.id_ordem}</span>}
                {o.detalhes?.maps_url && (
                  <a href={o.detalhes.maps_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: colors.primary, textDecoration: 'none', padding: '2px 9px', borderRadius: 999, background: colors.surface, border: `1px solid ${colors.border}` }}>
                    <MapPin size={12} /> Ver no mapa
                  </a>
                )}
              </div>

              {!aberta ? (
                <button onClick={() => { setJustAberta(o.id); setJustTexto(rascunhos[o.id] || ''); setJustArquivos([]); setJustErro('') }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  height: 46, borderRadius: 12, border: 'none', background: colors.primary, color: '#fff',
                  fontSize: 15, fontWeight: 500,
                }}>
                  <ShieldQuestion size={17} /> Justificar ocorrência
                </button>
              ) : (
                <div style={{ background: colors.surface, borderRadius: 12, padding: 14, border: `1px solid ${colors.border}` }}>
                  <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 6 }}>Sua justificativa <span style={{ color: colors.danger }}>*</span></div>
                  <textarea
                    value={justTexto}
                    onChange={e => mudarTexto(o.id, e.target.value)}
                    placeholder="Explique o que aconteceu..."
                    rows={3}
                    onFocus={e => { e.currentTarget.style.borderColor = '#38BDF8' }}
                    onBlur={e => { e.currentTarget.style.borderColor = colors.border }}
                    style={{ width: '100%', padding: '11px 14px', borderRadius: 12, border: `1px solid ${colors.border}`, fontSize: 15, boxSizing: 'border-box', background: colors.surface, color: colors.text, outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                  />
                  <input
                    ref={fileRef} type="file" accept="image/*,video/*" multiple
                    onChange={e => adicionarArquivos(e.target)}
                    style={{ display: 'none' }}
                  />
                  <button onClick={() => fileRef.current?.click()} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 46, marginTop: 10,
                    borderRadius: 12, border: `1px dashed ${colors.borderStrong}`, background: colors.surface, fontSize: 14, color: colors.textMuted,
                  }}>
                    <Camera size={17} /> Fotos / vídeos ({justArquivos.length}/{MAX_ANEXOS})
                  </button>
                  {justArquivos.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      {justArquivos.map((f, i) => {
                        const isVideo = f.type.startsWith('video')
                        const url = previews[i]
                        return (
                          <div key={i} style={{ position: 'relative', width: 72, height: 72, borderRadius: 10, overflow: 'hidden', border: `1px solid ${colors.border}`, background: '#0F172A' }}>
                            {isVideo ? <video src={url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            <button onClick={() => setJustArquivos(prev => prev.filter((_, idx) => idx !== i))} aria-label="tirar" style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(15,23,42,0.65)', border: 'none', width: 22, height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <X size={12} color="#fff" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {justErro && <div style={{ fontSize: 13, color: colors.danger, marginTop: 8 }}>{justErro}</div>}
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button onClick={() => setJustAberta(null)} style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 15, fontWeight: 500, background: colors.surface, color: colors.text, border: `1px solid ${colors.border}` }}>Cancelar</button>
                    <button onClick={() => enviarJustificativa(o)} disabled={justEnviando || !justTexto.trim()} style={{
                      flex: 2, height: 46, borderRadius: 12, fontSize: 15, fontWeight: 500, background: colors.primary, color: '#fff', border: 'none',
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
        <div style={{ fontSize: 16, fontWeight: 500, color: colors.text, marginTop: 4, padding: '0 2px' }}>
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
            border: `1px solid ${colors.border}`, opacity: vale ? 1 : 0.7, minWidth: 0,
          }}>
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
                    {pilulaCat(r.cor, r.catLabel)}
                    {o.origem === 'auto' && pilulaAuto}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: colors.text, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{r.label}</div>
                </div>
                <span style={{
                  fontSize: 14, fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap',
                  color: vale ? colors.danger : colors.textSubtle,
                  textDecoration: vale ? 'none' : 'line-through',
                }}>
                  −{o.pontos_descontados} pts
                </span>
              </div>
              <div style={{ fontSize: 13.5, color: colors.textMuted, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 8 }}>{o.descricao}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: colors.textSubtle, flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> {fmtData(o.data || o.created_at)}</span>
                {o.id_ordem && <span>OS {o.id_ordem}</span>}
                {o.detalhes?.maps_url && (
                  <a href={o.detalhes.maps_url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.primary, textDecoration: 'none' }}>
                    <MapPin size={12} /> Mapa
                  </a>
                )}
                {j && badgeDefesa(j)}
              </div>
              {j?.justificativa && (
                <div style={{ marginTop: 10, fontSize: 13.5, color: colors.textMuted, background: colors.surfaceAlt, borderRadius: 12, padding: '10px 12px', overflowWrap: 'anywhere' }}>
                  <span style={{ color: colors.text, fontWeight: 500 }}>Sua defesa:</span> {j.justificativa}
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

      <div style={{ fontSize: 12.5, color: colors.textSubtle, textAlign: 'center', lineHeight: 1.5, padding: '4px 12px 12px' }}>
        Cada funcionário começa o mês com 100 pontos. A ocorrência só deixa de
        descontar se a sua justificativa for aprovada pelo gestor.
      </div>
    </div>
  )
}
