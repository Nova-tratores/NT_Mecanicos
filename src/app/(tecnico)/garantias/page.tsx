'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck, Factory, Clock, AlertTriangle, CheckCircle2, XCircle,
  Send, Camera, X, Loader2, MapPin, FileText, Download,
} from 'lucide-react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { PageHeader, EmptyState, PageSpinner, Card } from '@/components/ui'
import { colors, radius } from '@/lib/ui'
import type { GarantiaResumo } from '@/lib/garantias/types'
import { STATUS_LABEL, STATUS_COR, STATUS_BG } from '@/lib/garantias/constants'
import { tempoDecorrido, diasEntre, fmtMoeda } from '@/lib/garantias/format'
import { listarMinhasGarantias, responderPendencia } from '@/lib/garantias/client'

export default function GarantiasPage() {
  const { user, loading: loadingUser } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const [lista, setLista] = useState<GarantiaResumo[]>([])
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    if (!nome) return
    setLoading(true)
    const dados = await listarMinhasGarantias(nome)
    setLista(dados)
    setLoading(false)
  }, [nome])

  useEffect(() => {
    if (nome) carregar()
  }, [nome, carregar])

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

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <PageSpinner />
        ) : lista.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nenhuma garantia ainda"
            subtitle="Ao preencher uma OS como Garantia, marque as peças solicitadas — a requisição aparece aqui."
          />
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
  const [respostaTexto, setRespostaTexto] = useState('')
  const [imagens, setImagens] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const pendAberta = g.pendencias?.find((p) => p.status === 'aberta')
  const precisaAcao = !!pendAberta
  const naFabrica = g.status === 'enviada' || g.status === 'info_pendente'

  async function enviar() {
    if (!pendAberta) return
    if (!respostaTexto.trim() && imagens.length === 0) {
      setErro('Escreva uma resposta ou anexe ao menos uma imagem.')
      return
    }
    setEnviando(true)
    setErro('')
    const res = await responderPendencia({
      garantiaId: g.id,
      pendenciaId: pendAberta.id,
      texto: respostaTexto,
      imagens,
      tecnicoNome,
    })
    setEnviando(false)
    if (!res.ok) {
      setErro(res.erro || 'Falha ao enviar.')
      return
    }
    setExpandido(false)
    setRespostaTexto('')
    setImagens([])
    onChange()
  }

  return (
    <Card
      tone={precisaAcao ? 'warning' : 'default'}
      style={{ borderLeft: `4px solid ${STATUS_COR[g.status]}`, padding: 14 }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: colors.text }}>{g.numero}</span>
        <span
          style={{
            fontSize: 10,
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

      <div style={{ fontSize: 13, color: colors.text, marginTop: 4, fontWeight: 600 }}>
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
            {pendAberta.descricao}
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
                width: '100%', padding: '10px 0', borderRadius: radius.md,
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
                  border: '2px solid #E5E7EB', fontSize: 13,
                  resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                  background: '#fff', outline: 'none',
                }}
              />
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: colors.textMuted, fontWeight: 600,
                  cursor: 'pointer', padding: '8px 10px', borderRadius: 8,
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
                    padding: '11px 0', borderRadius: radius.md, border: 'none',
                    background: colors.accent, color: '#fff',
                    fontSize: 13, fontWeight: 700, cursor: enviando ? 'default' : 'pointer',
                    opacity: enviando ? 0.7 : 1,
                  }}
                >
                  {enviando ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                  Enviar resposta
                </button>
                <button
                  onClick={() => { setExpandido(false); setRespostaTexto(''); setImagens([]); setErro('') }}
                  style={{
                    padding: '11px 14px', borderRadius: radius.md, border: 'none',
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
