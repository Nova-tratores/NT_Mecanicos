'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ShieldCheck, Factory, Clock, AlertTriangle, CheckCircle2, XCircle,
  Send, Camera, X, Loader2, MapPin, FileText, Download, WifiOff, RefreshCw,
} from 'lucide-react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { usePersistedState } from '@/hooks/usePersistedState'
import { offlineGet, offlineSet } from '@/lib/offlineCache'
import { getCachedGarantias } from '@/lib/prefetch'
import { PageHeader, EmptyState, PageSpinner, Card } from '@/components/ui'
import { colors, radius } from '@/lib/ui'
import type { GarantiaResumo } from '@/lib/garantias/types'
import { STATUS_LABEL, STATUS_COR, STATUS_BG } from '@/lib/garantias/constants'
import { tempoDecorrido, diasEntre, fmtMoeda } from '@/lib/garantias/format'
import { listarMinhasGarantias, responderPendencia } from '@/lib/garantias/client'

// Com sinal fraco a consulta pode ficar pendurada — corta e cai no cache.
const LISTA_TIMEOUT = 12000

function comTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms) }),
  ]).finally(() => clearTimeout(timer))
}

export default function GarantiasPage() {
  const { user, loading: loadingUser } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const [lista, setLista] = useState<GarantiaResumo[]>([])
  const [loading, setLoading] = useState(true)
  const [aviso, setAviso] = useState<'' | 'offline' | 'erro'>('')
  const reqIdRef = useRef(0)

  const carregar = useCallback(async () => {
    if (!nome) {
      setLoading(false)
      return
    }
    // Ignora respostas de cargas antigas (ex.: troca de usuário / refresh duplo)
    const reqId = ++reqIdRef.current
    const cacheKey = `garantias:lista:${nome}`
    setLoading(true)
    try {
      const dados = await comTimeout(listarMinhasGarantias(nome), LISTA_TIMEOUT)
      if (reqId !== reqIdRef.current) return
      setLista(dados)
      setAviso('')
      offlineSet(cacheKey, dados).catch(() => {})
    } catch {
      // Offline / sinal fraco: usa a última lista salva ou o prefetch
      let salvo: GarantiaResumo[] | null = null
      try {
        salvo = (await offlineGet<GarantiaResumo[]>(cacheKey))
          || ((await getCachedGarantias()) as unknown as GarantiaResumo[] | null)
      } catch { /* sem cache */ }
      if (reqId !== reqIdRef.current) return
      if (salvo && salvo.length > 0) {
        const fallback = salvo
        setLista((prev) => (prev.length > 0 ? prev : fallback))
        setAviso('offline')
      } else {
        setAviso('erro')
      }
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [nome])

  useEffect(() => {
    if (!loadingUser) carregar()
  }, [loadingUser, carregar])

  if (loadingUser) return <PageSpinner />

  const totalAlerta = lista.filter((g) => g.status === 'bo_tecnico' || g.status === 'info_pendente').length

  return (
    <div style={{ padding: '16px 16px 90px', maxWidth: 600, margin: '0 auto' }}>
      <PageHeader
        title="Garantias"
        subtitle={
          totalAlerta > 0
            ? `${totalAlerta} pendente(s) sua resposta`
            : 'Solicite garantia ao preencher uma OS marcada como Garantia.'
        }
      />

      {aviso && !loading && (
        <div
          role="status"
          style={{
            marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '10px 12px', borderRadius: radius.md,
            background: aviso === 'offline' ? colors.warningBg : colors.dangerBg,
            color: aviso === 'offline' ? '#92400E' : colors.danger,
            fontSize: 13, fontWeight: 600,
          }}
        >
          <WifiOff size={15} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            {aviso === 'offline'
              ? 'Sem conexão — mostrando as garantias salvas no aparelho.'
              : 'Não foi possível carregar as garantias. Verifique o sinal.'}
          </span>
          <button
            type="button"
            onClick={carregar}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, minHeight: 40,
              padding: '0 12px', borderRadius: radius.md, border: 'none',
              background: '#fff', color: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} /> Tentar de novo
          </button>
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && lista.length === 0 ? (
          <PageSpinner />
        ) : lista.length === 0 ? (
          aviso === 'erro' ? null : (
          <EmptyState
            icon={ShieldCheck}
            title="Nenhuma garantia ainda"
            subtitle="Ao preencher uma OS como Garantia, marque as peças solicitadas — a requisição aparece aqui."
          />
          )
        ) : (
          lista.map((g) => (
            <GarantiaCard key={g.id} g={g} tecnicoNome={nome} onChange={carregar} />
          ))
        )}
      </div>
    </div>
  )
}

/* ─── Card de uma garantia ─── */

function GarantiaCard({ g, tecnicoNome, onChange }: { g: GarantiaResumo; tecnicoNome: string; onChange: () => void }) {
  const [expandido, setExpandido] = useState(false)
  // Texto da resposta sobrevive a minimizar o app / recarregar a página
  const [respostaTexto, setRespostaTexto, limparRespostaSalva] = usePersistedState(`garantia-resp-${g.id}`, '')
  const [imagens, setImagens] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const enviandoRef = useRef(false)
  const [erro, setErro] = useState('')

  const pendAberta = g.pendencias?.find((p) => p.status === 'aberta')
  const precisaAcao = !!pendAberta
  const naFabrica = g.status === 'enviada' || g.status === 'info_pendente' || g.status === 'ressarcimento_fabrica'

  async function enviar() {
    if (!pendAberta || enviandoRef.current) return
    if (!respostaTexto.trim() && imagens.length === 0) {
      setErro('Escreva uma resposta ou anexe ao menos uma imagem.')
      return
    }
    // Guarda síncrona contra toque duplo (o disabled só vale após o re-render)
    enviandoRef.current = true
    setEnviando(true)
    setErro('')
    try {
      const res = await responderPendencia({
        garantiaId: g.id,
        pendenciaId: pendAberta.id,
        texto: respostaTexto,
        imagens,
        tecnicoNome,
      })
      if (!res.ok) {
        // Tira da seleção o que já subiu, para não duplicar no reenvio
        const enviados = res.enviados || []
        if (enviados.length > 0) setImagens((prev) => prev.filter((f) => !enviados.includes(f)))
        setErro(res.erro || 'Falha ao enviar. Tente de novo.')
        return
      }
      setExpandido(false)
      setRespostaTexto('')
      limparRespostaSalva()
      setImagens([])
      onChange()
    } catch (err) {
      console.error('[garantias] enviar resposta:', err)
      setErro('Falha ao enviar. Verifique o sinal e tente de novo.')
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  return (
    <Card
      tone={precisaAcao ? 'warning' : 'default'}
      style={{ borderLeft: `4px solid ${STATUS_COR[g.status]}`, padding: 14 }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: colors.text }}>{g.numero}</span>
        <span
          style={{
            fontSize: 10, textAlign: 'right', maxWidth: '100%',
            fontWeight: 700,
            textTransform: 'uppercase',
            color: STATUS_COR[g.status],
            background: STATUS_BG[g.status],
            padding: '3px 8px',
            borderRadius: 6,
          }}
        >
          {STATUS_LABEL[g.status]}
        </span>
      </div>

      <div style={{ fontSize: 13, color: colors.text, marginTop: 4, fontWeight: 600, overflowWrap: 'anywhere' }}>
        OS {g.id_ordem} · {g.cliente || 'Cliente'}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        {g.montadora && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: colors.textMuted }}>
            <Factory size={11} /> {g.montadora.nome}
          </span>
        )}
        {g.chassis && (
          <span style={{ fontSize: 11, color: colors.textMuted }}>Chassi {g.chassis}</span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: colors.textSubtle }}>
          <Clock size={11} />
          {naFabrica && g.enviada_fabrica_em
            ? `${diasEntre(g.enviada_fabrica_em)}d na fábrica`
            : `Aberta ${tempoDecorrido(g.created_at)}`}
        </span>
      </div>

      {/* Arquivos da fábrica (SG enviado + retorno) */}
      {(g.anexos || []).filter((a) => a.categoria === 'envio_fabrica' || a.categoria === 'retorno_fabrica').length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
          {(g.anexos || [])
            .filter((a) => a.categoria === 'envio_fabrica' || a.categoria === 'retorno_fabrica')
            .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
            .map((a) => {
              const isEnvio = a.categoria === 'envio_fabrica'
              return (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 10px', borderRadius: 8,
                    background: isEnvio ? colors.infoBg : colors.successBg,
                    border: `1px solid ${isEnvio ? colors.infoBorder : colors.successBorder}`,
                    fontSize: 12, fontWeight: 600,
                    color: isEnvio ? colors.info : colors.success,
                    textDecoration: 'none',
                  }}
                >
                  <FileText size={13} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isEnvio ? 'SG enviada à fábrica' : 'Retorno da fábrica'}
                    {a.nome_arquivo ? ` — ${a.nome_arquivo}` : ''}
                  </span>
                  <Download size={13} />
                </a>
              )
            })}
        </div>
      )}

      {/* Peças aprovadas — aguardando o serviço (fluxo em duas etapas) */}
      {g.status === 'aguardando_servico' && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 2, marginTop: 10,
            padding: '8px 10px', borderRadius: 8,
            background: '#CCFBF1', color: '#0F766E', fontSize: 12, fontWeight: 700,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} />
            Peças aprovadas pela fábrica — pode combinar e executar o serviço.
          </div>
          <div style={{ fontSize: 11, fontWeight: 500 }}>
            Depois o garantista solicita o ressarcimento das suas horas e km.
            {g.pecas_retorno_em ? ` Aprovadas há ${diasEntre(g.pecas_retorno_em)}d.` : ''}
          </div>
        </div>
      )}

      {/* Desfecho */}
      {g.status === 'aprovada' && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 2, marginTop: 10,
            padding: '8px 10px', borderRadius: 8,
            background: colors.successBg, color: colors.success, fontSize: 12, fontWeight: 700,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} />
            Garantia paga: {fmtMoeda(g.valor_pago_total)}
          </div>
          <div style={{ fontSize: 11, fontWeight: 500 }}>
            {g.garantista_horas || 0}h · {g.garantista_km || 0}km
            {g.valor_pago_pecas != null && g.valor_pago_pecas > 0
              ? ` · peças ${fmtMoeda(g.valor_pago_pecas)}`
              : ''}
          </div>
        </div>
      )}
      {g.status === 'rejeitada' && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
            padding: '8px 10px', borderRadius: 8,
            background: colors.dangerBg, color: colors.danger, fontSize: 12, fontWeight: 700,
          }}
        >
          <XCircle size={14} />
          Garantia não paga
          {g.motivo_recusa ? ` — ${g.motivo_recusa}` : ''}
        </div>
      )}

      {/* Pendência aberta — texto + botão responder */}
      {precisaAcao && pendAberta && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontSize: 12, color: '#92400E', background: '#FEF3C7',
              borderRadius: 8, padding: '8px 10px', marginBottom: 8,
            }}
          >
            <strong style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <AlertTriangle size={13} />
              {pendAberta.tipo === 'bo' ? 'Garantista pediu (B.O.):' : 'A fábrica solicitou:'}
            </strong>
            <span style={{ overflowWrap: 'anywhere' }}>{pendAberta.descricao}</span>
            {pendAberta.exige_visita && (
              <div style={{ marginTop: 4, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={12} /> É necessário ir até a propriedade do cliente.
              </div>
            )}
          </div>

          {!expandido ? (
            <button
              onClick={() => setExpandido(true)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                width: '100%', padding: '10px 0', minHeight: 44, borderRadius: radius.md,
                border: 'none', background: '#F59E0B', color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              <Send size={14} /> Responder
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                value={respostaTexto}
                onChange={(e) => setRespostaTexto(e.target.value)}
                placeholder="Escreva a resposta para o garantista..."
                rows={3}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 10,
                  border: '2px solid #E5E7EB', fontSize: 16,
                  resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                  background: '#fff', outline: 'none',
                }}
              />
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: colors.textMuted, fontWeight: 600,
                  cursor: 'pointer', padding: '8px 10px', minHeight: 44, borderRadius: 8,
                  border: `1px dashed ${colors.borderStrong}`, background: '#fff',
                }}
              >
                <Camera size={15} /> Anexar fotos/vídeos ({imagens.length})
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    // vídeo até 50MB (limite de upload do Supabase) — acima
                    // disso o técnico comprime/corta e tenta de novo
                    const MAX_MB = 50
                    const todos = Array.from(e.target.files || [])
                    const grandes = todos.filter((f) => f.size > MAX_MB * 1024 * 1024)
                    if (grandes.length) {
                      setErro(`Arquivo(s) acima de ${MAX_MB}MB: ${grandes.map((f) => f.name).join(', ')} — comprima ou corte o vídeo.`)
                    } else {
                      setErro('')
                    }
                    setImagens(todos.filter((f) => f.size <= MAX_MB * 1024 * 1024))
                    // permite escolher o mesmo arquivo de novo (onChange não dispara sem isso)
                    e.target.value = ''
                  }}
                />
              </label>
              {erro && <div style={{ fontSize: 12, color: colors.danger }}>{erro}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={enviar}
                  disabled={enviando}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '11px 0', minHeight: 44, borderRadius: radius.md, border: 'none',
                    background: colors.accent, color: '#fff',
                    fontSize: 13, fontWeight: 700, cursor: enviando ? 'default' : 'pointer',
                    opacity: enviando ? 0.7 : 1,
                  }}
                >
                  {enviando ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                  Enviar resposta
                </button>
                <button
                  type="button"
                  aria-label="Cancelar resposta"
                  disabled={enviando}
                  onClick={() => { setExpandido(false); setRespostaTexto(''); limparRespostaSalva(); setImagens([]); setErro('') }}
                  style={{
                    padding: '11px 14px', minWidth: 44, minHeight: 44, borderRadius: radius.md, border: 'none',
                    background: colors.surfaceAlt, color: colors.textMuted,
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
