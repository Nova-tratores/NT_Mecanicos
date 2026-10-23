'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ShieldCheck, Factory, Clock, AlertTriangle, CheckCircle2, XCircle,
  Send, Camera, X, Loader2, MapPin, FileText, Download, CloudOff, Image as ImageIcon, Film,
} from 'lucide-react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import { EmptyState, PageSpinner } from '@/components/ui'
import type { GarantiaResumo, GarantiaStatus } from '@/lib/garantias/types'
import { STATUS_LABEL } from '@/lib/garantias/constants'
import { COR, T, cartao, campo, botaoPrincipal, botaoSecundario, claro, bordaDe, Icone, Cabecalho, EstiloCampos } from '../requisicoes/_ui'

/** Cor fixa de cada situação (Estilo POS NewPortal): roxo aguardando/para fazer, azul em andamento,
 *  laranja pendente da sua resposta, verde aprovada, vermelho recusada. Só aparência. */
function corGarantia(s: GarantiaStatus): string {
  switch (s) {
    case 'aberta': return COR.fazer
    case 'aguardando_servico': return COR.fazer
    case 'em_analise': return COR.andamento
    case 'enviada': return COR.andamento
    case 'ressarcimento_fabrica': return COR.andamento
    case 'bo_tecnico': return COR.pendente
    case 'info_pendente': return COR.pendente
    case 'aprovada': return COR.feita
    case 'rejeitada': return COR.erro
    default: return COR.neutro
  }
}
import { tempoDecorrido, diasEntre, fmtMoeda } from '@/lib/garantias/format'
import { listarMinhasGarantias, responderPendencia } from '@/lib/garantias/client'

export default function GarantiasPage() {
  const { user, loading: loadingUser } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const [lista, setLista] = useState<GarantiaResumo[]>([])
  const [loading, setLoading] = useState(true)
  const [aviso, setAviso] = useState<{ origem: 'rede' | 'cache' | 'erro'; erro?: string }>({ origem: 'rede' })

  const carregar = useCallback(async () => {
    if (!nome) return
    setLoading(true)
    const r = await listarMinhasGarantias(nome)
    setLista(r.lista)
    setAviso({ origem: r.origem, erro: r.erro })
    setLoading(false)
  }, [nome])

  useEffect(() => {
    if (nome) carregar()
  }, [nome, carregar])

  // voltou o sinal: recarrega sozinho
  useEffect(() => {
    const on = () => { if (nome) carregar() }
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [nome, carregar])

  if (loadingUser) return <PageSpinner />
  if (!nome) {
    return (
      <div style={{ padding: '0 0 90px', maxWidth: 600, margin: '0 auto' }}>
        <EmptyState
          icon={ShieldCheck}
          title="Não achamos o nome do técnico"
          subtitle="Saia e entre de novo no app (com internet). Se continuar, avise o escritório para ligar seu usuário ao seu nome de técnico."
        />
      </div>
    )
  }

  const totalAlerta = lista.filter((g) => g.status === 'bo_tecnico' || g.status === 'info_pendente').length

  return (
    <div style={{ padding: '0 0 90px', maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <EstiloCampos />
      <Cabecalho
        icon={ShieldCheck}
        cor={totalAlerta > 0 ? COR.pendente : COR.principal}
        titulo="Garantias"
        subtitulo={
          totalAlerta > 0
            ? `${totalAlerta} pendente(s) sua resposta`
            : 'Solicite garantia ao preencher uma OS marcada como Garantia.'
        }
      />

      {!loading && aviso.origem !== 'rede' && (
        <div style={{
          ...cartao, display: 'flex', alignItems: 'center', gap: 10,
          background: claro(aviso.origem === 'erro' ? COR.erro : COR.pendente),
          border: `1px solid ${bordaDe(aviso.origem === 'erro' ? COR.erro : COR.pendente)}`,
        }}>
          <CloudOff size={18} color={aviso.origem === 'erro' ? COR.erro : COR.pendente} style={{ flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: T.texto, lineHeight: 1.4 }}>
            {aviso.origem === 'cache'
              ? `${aviso.erro === 'Sem internet' ? 'Sem internet' : 'Não deu para atualizar'} — mostrando o que está guardado no celular.`
              : `${aviso.erro || 'Sem internet'} — não há garantias guardadas no celular.`}
          </span>
          <button onClick={carregar} style={{ ...botaoSecundario, width: 'auto', minHeight: 36, fontSize: 13.5, flex: 'none' }}>
            Tentar de novo
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <PageSpinner />
        ) : aviso.origem === 'erro' && lista.length === 0 ? null : lista.length === 0 ? (
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
  const enviandoRef = useRef(false)

  const pendAberta = g.pendencias?.find((p) => p.status === 'aberta')

  // Rascunho do texto da resposta (José, 23/10/2026): fechar o quadro ou sair da tela não perde o que foi escrito.
  const getRascunho = useCallback(() => ({ texto: respostaTexto }), [respostaTexto])
  const setRascunho = useCallback((d: Record<string, unknown>) => {
    if (typeof d.texto === 'string' && d.texto) setRespostaTexto(d.texto)
  }, [])
  const { restore: restoreRascunho, clear: clearRascunho } = useFormBackup(`garantia-resp-${pendAberta?.id || g.id}`, getRascunho, setRascunho)
  useEffect(() => { restoreRascunho() }, [restoreRascunho])

  // miniaturas das fotos escolhidas (libera a memória quando muda)
  const previas = useMemo(
    () => imagens.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')),
    [imagens],
  )
  useEffect(() => () => { previas.forEach((u) => u && URL.revokeObjectURL(u)) }, [previas])

  // vídeo até 50MB (limite de upload do Supabase) — acima disso o técnico comprime/corta e tenta de novo
  const adicionarArquivos = (input: HTMLInputElement) => {
    const MAX_MB = 50
    const novos = Array.from(input.files || [])
    input.value = '' // cada "Tirar foto" soma à seleção, e dá para escolher o mesmo arquivo de novo
    if (!novos.length) return
    const grandes = novos.filter((f) => f.size > MAX_MB * 1024 * 1024)
    setErro(grandes.length ? `Arquivo(s) acima de ${MAX_MB}MB: ${grandes.map((f) => f.name).join(', ')} — comprima ou corte o vídeo.` : '')
    setImagens((prev) => [...prev, ...novos.filter((f) => f.size <= MAX_MB * 1024 * 1024)])
  }
  const precisaAcao = !!pendAberta
  const naFabrica = g.status === 'enviada' || g.status === 'info_pendente' || g.status === 'ressarcimento_fabrica'

  async function enviar() {
    if (!pendAberta || enviandoRef.current) return
    if (!respostaTexto.trim() && imagens.length === 0) {
      setErro('Escreva uma resposta ou anexe ao menos uma imagem.')
      return
    }
    enviandoRef.current = true
    setEnviando(true)
    setErro('')
    let res: { ok: boolean; erro?: string }
    try {
      res = await responderPendencia({
        garantiaId: g.id,
        pendenciaId: pendAberta.id,
        texto: respostaTexto,
        imagens,
        tecnicoNome,
      })
    } catch (e) {
      res = { ok: false, erro: `Falha ao enviar: ${(e as Error)?.message || e}` }
    }
    setEnviando(false)
    enviandoRef.current = false
    if (!res.ok) {
      setErro(res.erro || 'Falha ao enviar.')
      return
    }
    clearRascunho()
    setExpandido(false)
    setRespostaTexto('')
    setImagens([])
    onChange()
  }

  const cor = corGarantia(g.status)
  const arquivosFabrica = (g.anexos || []).filter((a) => a.categoria === 'envio_fabrica' || a.categoria === 'retorno_fabrica')

  /** aviso com fundo clarinho na cor + ícone */
  const aviso = (c: string, Ic: typeof CheckCircle2, titulo: React.ReactNode, sub?: React.ReactNode) => (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px', borderRadius: 12,
      background: claro(c), border: `1px solid ${bordaDe(c)}`,
    }}>
      <span style={{ color: c, flex: 'none', marginTop: 1 }}><Ic size={16} /></span>
      <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
        <div style={{ fontSize: 14, color: T.texto, lineHeight: 1.35 }}>{titulo}</div>
        {sub && <div style={{ fontSize: 13, color: T.textoMedio, lineHeight: 1.4 }}>{sub}</div>}
      </div>
    </div>
  )

  return (
    <div style={{ ...cartao, padding: 0, overflow: 'hidden', borderColor: precisaAcao ? bordaDe(cor) : T.borda }}>
      {/* Faixa no topo com a situação */}
      <div style={{
        background: cor, color: '#fff', padding: '7px 14px',
        fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {STATUS_LABEL[g.status]}
      </div>

      <div style={{ padding: 14, display: 'grid', gap: 10 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Icone icon={ShieldCheck} cor={cor} cheio />
          <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
            <span style={{ fontSize: 13, color: T.textoFraco, fontVariantNumeric: 'tabular-nums' }}>{g.numero}</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: T.texto, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              OS {g.id_ordem} · {g.cliente || 'Cliente'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {g.montadora && (
            <span style={chip}>
              <Factory size={12} /> {g.montadora.nome}
            </span>
          )}
          {g.chassis && (
            <span style={chip}>Chassi {g.chassis}</span>
          )}
          <span style={chip}>
            <Clock size={12} />
            {naFabrica && g.enviada_fabrica_em
              ? `${diasEntre(g.enviada_fabrica_em)}d na fábrica`
              : `Aberta ${tempoDecorrido(g.created_at)}`}
          </span>
        </div>

        {/* Arquivos da fábrica (SG enviado + retorno) */}
        {arquivosFabrica.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {arquivosFabrica
              .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
              .map((a) => {
                const isEnvio = a.categoria === 'envio_fabrica'
                const c = isEnvio ? COR.andamento : COR.feita
                return (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
                      padding: '8px 10px', borderRadius: 12,
                      background: T.cartao, border: `1px solid ${T.borda}`,
                      fontSize: 13, color: T.texto, textDecoration: 'none',
                    }}
                  >
                    <Icone icon={FileText} cor={c} tam={30} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isEnvio ? 'SG enviada à fábrica' : 'Retorno da fábrica'}
                      {a.nome_arquivo ? ` — ${a.nome_arquivo}` : ''}
                    </span>
                    <Download size={15} color={COR.principal} style={{ flex: 'none' }} />
                  </a>
                )
              })}
          </div>
        )}

        {/* Peças aprovadas — aguardando o serviço (fluxo em duas etapas) */}
        {g.status === 'aguardando_servico' && aviso(
          COR.fazer, CheckCircle2,
          'Peças aprovadas pela fábrica — pode combinar e executar o serviço.',
          <>
            Depois o garantista solicita o ressarcimento das suas horas e km.
            {g.pecas_retorno_em ? ` Aprovadas há ${diasEntre(g.pecas_retorno_em)}d.` : ''}
          </>,
        )}

        {/* Desfecho */}
        {g.status === 'aprovada' && aviso(
          COR.feita, CheckCircle2,
          <>Garantia paga: <span style={{ fontWeight: 500 }}>{fmtMoeda(g.valor_pago_total)}</span></>,
          <>
            {g.garantista_horas || 0}h · {g.garantista_km || 0}km
            {g.valor_pago_pecas != null && g.valor_pago_pecas > 0
              ? ` · peças ${fmtMoeda(g.valor_pago_pecas)}`
              : ''}
          </>,
        )}
        {g.status === 'rejeitada' && aviso(
          COR.erro, XCircle,
          <>Garantia não paga{g.motivo_recusa ? ` — ${g.motivo_recusa}` : ''}</>,
        )}

        {/* Pendência aberta — texto + botão responder */}
        {precisaAcao && pendAberta && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div
              style={{
                fontSize: 14, color: T.texto, lineHeight: 1.45,
                background: claro(COR.pendente), border: `1px solid ${bordaDe(COR.pendente)}`,
                borderRadius: 12, padding: '10px 12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, color: COR.pendente, fontWeight: 500 }}>
                <AlertTriangle size={15} />
                {pendAberta.tipo === 'bo' ? 'Garantista pediu (B.O.):' : 'A fábrica solicitou:'}
              </div>
              {pendAberta.descricao}
              {pendAberta.exige_visita && (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, color: T.textoMedio }}>
                  <MapPin size={14} color={COR.pendente} /> É necessário ir até a propriedade do cliente.
                </div>
              )}
            </div>

            {!expandido ? (
              <button
                onClick={() => setExpandido(true)}
                style={botaoPrincipal()}
              >
                <Send size={16} /> Responder
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  className="rq-campo"
                  value={respostaTexto}
                  onChange={(e) => setRespostaTexto(e.target.value)}
                  placeholder="Escreva a resposta para o garantista..."
                  rows={3}
                  style={{ ...campo, resize: 'vertical', lineHeight: 1.5 }}
                />
                <label
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, minHeight: 46,
                    fontSize: 14, color: T.textoMedio, fontWeight: 400,
                    cursor: 'pointer', padding: '8px 12px', borderRadius: 12,
                    border: `1px dashed ${T.fantasma}`, background: T.fundo,
                  }}
                >
                  <Camera size={17} color={COR.principal} /> Anexar fotos/vídeos ({imagens.length})
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => adicionarArquivos(e.target)}
                  />
                </label>
                {imagens.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8 }}>
                    {imagens.map((f, i) => (
                      <div key={`${f.name}-${f.size}-${i}`} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', border: `1px solid ${T.borda}`, background: T.fundo }}>
                        {previas[i] ? (
                          <img src={previas[i]} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: T.textoMedio }}>
                            {f.type.startsWith('video/') ? <Film size={22} /> : <ImageIcon size={22} />}
                          </div>
                        )}
                        <button
                          type="button"
                          aria-label="Remover"
                          onClick={() => setImagens((prev) => prev.filter((_, j) => j !== i))}
                          style={{
                            position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: '50%',
                            background: 'rgba(15,23,42,0.7)', border: 'none', color: '#fff', cursor: 'pointer',
                            display: 'grid', placeItems: 'center', padding: 0,
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {erro && <div style={{ fontSize: 13, color: COR.erro, lineHeight: 1.45 }}>{erro}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={enviar}
                    disabled={enviando}
                    style={{
                      ...botaoPrincipal(), flex: 1, width: 'auto',
                      cursor: enviando ? 'default' : 'pointer',
                      opacity: enviando ? 0.7 : 1,
                    }}
                  >
                    {enviando ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                    Enviar resposta
                  </button>
                  <button
                    onClick={() => { setExpandido(false); setErro('') }}
                    aria-label="Fechar resposta"
                    style={{ ...botaoSecundario, width: 46, padding: 0, flex: 'none' }}
                  >
                    <X size={18} color={T.textoMedio} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** etiqueta neutra (montadora, chassi, tempo) */
const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%',
  fontSize: 12.5, padding: '3px 9px', borderRadius: 999,
  background: T.cartao, border: `1px solid ${T.borda}`, color: T.textoMedio,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
