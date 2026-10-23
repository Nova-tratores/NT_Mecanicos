'use client'
import { useEffect, useState } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import { cacheInvalidate } from '@/lib/cache'
import {
  FilePlus, FileCheck, History, ClipboardList, XCircle,
  CheckCircle2, Clock, Package, ChevronRight, CloudOff, type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { notificarPortalReq } from '@/lib/notificarPortal'
import { TabBar, EmptyState, PageSpinner } from '@/components/ui'
import { getStatus } from '@/lib/ui'
import { COR, T, cartao, botaoPerigo, Icone, Pilula, Cabecalho, EstiloCampos, claro, bordaDe } from './_ui'
import { lerValor, moeda, dataBR, nomeIgual, listarPendentes, enviarPendentes } from './_util'

interface RequisicaoPOS {
  id: number
  titulo: string
  tipo: string
  solicitante: string
  data: string
  status: string
  fornecedor: string | null
  valor_despeza: string | null
  recibo_fornecedor: string | null
  obs: string | null
  origem?: string | null
}

interface ReqData {
  pendentes: RequisicaoPOS[]
  emAberto: RequisicaoPOS[]
  historico: RequisicaoPOS[]
}

// Fases (José, 23/10/2026):
// Pendentes = o técnico precisa agir (pedido sem comprovante: informar valor, fornecedor e foto);
// Em aberto = já fez a parte dele, aguardando o escritório (atualizada, aguardando fornecedor, cancelamento pedido);
// Histórico = finalizadas (financeiro, cancelada).
const EM_ABERTO = ['completa', 'aguardando', 'cancelar']

async function fetchReqData(nome: string, tecnicoNome: string): Promise<ReqData> {
  // Busca larga pelo nome e depois casa o nome exato (sem caixa/acento) — "João" não vê as do "João Pedro".
  const filtros = [nome, tecnicoNome].filter(Boolean).map((n) => `solicitante.ilike.%${n.replace(/[,()]/g, ' ').trim()}%`)
  const { data, error } = await supabase
    .from('Requisicao')
    .select('id, titulo, tipo, solicitante, data, status, fornecedor, valor_despeza, recibo_fornecedor, obs, origem')
    .or(filtros.join(','))
    .neq('status', 'lixeira')
    .order('data', { ascending: false })
    .order('id', { ascending: false })
    .limit(300)
  if (error) throw error // sem internet: o useCached mostra o que está guardado
  const minhas = ((data || []) as RequisicaoPOS[]).filter((r) => nomeIgual(r.solicitante, nome, tecnicoNome))
  const st = (r: RequisicaoPOS) => String(r.status || '').toLowerCase()
  // alimentação aberta sozinha pela OS não pede comprovante do técnico: fica com o escritório
  const doTecnico = (r: RequisicaoPOS) => st(r) === 'pedido' && !r.recibo_fornecedor && r.origem !== 'auto_alimentacao_os'
  return {
    pendentes: minhas.filter(doTecnico),
    emAberto: minhas.filter((r) => (st(r) === 'pedido' && !doTecnico(r)) || EM_ABERTO.includes(st(r))),
    historico: minhas.filter((r) => st(r) !== 'pedido' && !EM_ABERTO.includes(st(r))).slice(0, 50),
  }
}

/* ─── Peças visuais (Estilo POS NewPortal) ─── */

/** número do topo: fundo clarinho na cor, número na cor */
function Numero({ valor, rotulo, dica, cor }: { valor: number; rotulo: string; dica: string; cor: string }) {
  const c = valor === 0 ? COR.neutro : cor
  return (
    <div style={{
      background: claro(c), border: `1px solid ${bordaDe(c)}`, borderRadius: 16,
      padding: '10px 12px', display: 'grid', lineHeight: 1.15, minWidth: 0,
    }}>
      <small style={{ fontSize: 12.5, color: T.textoMedio }}>{rotulo}</small>
      <b style={{ fontSize: 26, fontWeight: 500, color: c, marginTop: 4 }}>{valor}</b>
      <em style={{ fontStyle: 'normal', fontSize: 12, color: T.textoFraco, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dica}</em>
    </div>
  )
}

/** cartão de uma requisição: ícone na cor da situação, nº + etiqueta, título e linha de baixo */
function CartaoReq({ href, icon, cor, id, status, titulo, sub, meta, rodape }: {
  href?: string; icon: LucideIcon; cor: string; id: number; status: string
  titulo: string; sub: string; meta?: React.ReactNode; rodape?: React.ReactNode
}) {
  const st = getStatus(String(status || '').toLowerCase())
  const corpo = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <Icone icon={icon} cor={cor} />
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: T.textoFraco, fontVariantNumeric: 'tabular-nums', flex: 'none' }}>#{id}</span>
          <Pilula cor={st.color}>{st.label}</Pilula>
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, color: T.texto, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {titulo}
        </div>
        <div style={{ fontSize: 13, color: T.textoFraco, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
        {meta && <div style={{ fontSize: 13, color: T.textoMedio, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</div>}
      </div>
      {href && <ChevronRight size={18} color="#94A3B8" style={{ flex: 'none' }} />}
    </div>
  )
  return (
    <div style={{ ...cartao, display: 'grid', gap: 12 }}>
      {href ? (
        <Link href={href} className="rq-toque" style={{ textDecoration: 'none', color: 'inherit', display: 'block', minWidth: 0 }}>{corpo}</Link>
      ) : corpo}
      {rodape}
    </div>
  )
}

/** "fornecedor · R$ 150,00" — tolera valor antigo gravado com vírgula */
function valorTexto(r: RequisicaoPOS) {
  const n = lerValor(r.valor_despeza)
  const v = Number.isFinite(n) ? `R$ ${moeda(n)}` : ''
  return [r.fornecedor, v].filter(Boolean).join(' · ')
}

type Aba = 'pendentes' | 'aberto' | 'historico'

export default function RequisicoesHub() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''
  const cacheKey = `requisicoes:${nome}`

  const { data, loading, refreshing, refresh } = useCached<ReqData>(
    cacheKey,
    () => fetchReqData(nome, user?.tecnico_nome || ''),
    { skip: !user },
  )

  const [aba, setAba] = useState<Aba>('pendentes')
  const [cancelando, setCancelando] = useState<number | null>(null)
  const [noCelular, setNoCelular] = useState<number[]>([]) // atualizações guardadas sem sinal

  // ?aba=aberto (vindo da antiga "Requisições enviadas")
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get('aba')
    if (a === 'aberto' || a === 'historico' || a === 'pendentes') setAba(a)
  }, [])

  // manda atualizações guardadas no celular e mostra quais ainda estão esperando sinal
  useEffect(() => {
    let vivo = true
    const ver = async () => {
      const antes = (await listarPendentes()).length
      const n = await enviarPendentes().catch(() => 0)
      const lista = await listarPendentes()
      if (!vivo) return
      setNoCelular(lista.map((p) => p.reqId))
      if (n > 0 || lista.length !== antes) { cacheInvalidate(cacheKey); refresh() }
    }
    ver()
    window.addEventListener('online', ver)
    return () => { vivo = false; window.removeEventListener('online', ver) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])

  const { pendentes = [], emAberto = [], historico = [] } = data || {}

  const solicitarCancelamento = async (req: RequisicaoPOS) => {
    const confirmar = window.confirm('Tem certeza que deseja solicitar o cancelamento desta requisição?')
    if (!confirmar) return
    setCancelando(req.id)
    const res = await offlineWrite({
      table: 'Requisicao', action: 'update', data: { status: 'cancelar' }, match: { id: req.id },
    })
    if (!res.ok) {
      alert(`Erro ao solicitar cancelamento: ${res.error || 'tente novamente.'}`)
    } else {
      notificarPortalReq(
        'Solicitação de Cancelamento',
        `Técnico ${nome} solicitou cancelamento da requisição #${req.id} — ${req.titulo}`
      )
      if (res.queued) alert('Salvo no celular, vai quando tiver sinal.')
      cacheInvalidate(cacheKey)
      refresh()
    }
    setCancelando(null)
  }

  const botaoCancelar = (req: RequisicaoPOS) => (
    <button
      onClick={() => solicitarCancelamento(req)}
      disabled={cancelando === req.id}
      style={{
        ...botaoPerigo, minHeight: 40, fontSize: 14,
        background: cancelando === req.id ? claro(COR.erro) : T.cartao,
        cursor: cancelando === req.id ? 'not-allowed' : 'pointer',
      }}
    >
      <XCircle size={15} />
      {cancelando === req.id ? 'Cancelando...' : 'Solicitar cancelamento'}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <EstiloCampos />
      {refreshing && <div className="refresh-bar" />}

      <Cabecalho
        icon={ClipboardList}
        titulo="Requisições"
        subtitulo="Peças, ferramentas e despesas"
        acao={
          <Link href="/requisicoes/nova" style={{
            background: COR.principal, borderRadius: 12, padding: '0 14px', height: 42,
            color: '#fff', textDecoration: 'none', flex: 'none',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 14, fontWeight: 500,
          }}>
            <FilePlus size={16} />
            Nova
          </Link>
        }
      />

      {/* Números */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <Numero valor={pendentes.length} rotulo="Pendentes" dica="você precisa agir" cor={COR.pendente} />
        <Numero valor={emAberto.length} rotulo="Em aberto" dica="com o escritório" cor={COR.andamento} />
        <Numero valor={historico.length} rotulo="Histórico" dica="finalizadas" cor={COR.feita} />
      </div>

      {noCelular.length > 0 && (
        <div style={{ ...cartao, display: 'flex', alignItems: 'center', gap: 10, background: claro(COR.pendente), border: `1px solid ${bordaDe(COR.pendente)}` }}>
          <CloudOff size={18} color={COR.pendente} style={{ flex: 'none' }} />
          <span style={{ fontSize: 13.5, color: T.texto }}>
            {noCelular.length === 1 ? 'Uma atualização está salva' : `${noCelular.length} atualizações estão salvas`} no celular, vai quando tiver sinal.
          </span>
        </div>
      )}

      {/* Tabs */}
      <TabBar
        value={aba}
        onChange={setAba}
        options={[
          { value: 'pendentes', label: 'Pendentes', badgeCount: pendentes.length },
          { value: 'aberto', label: 'Em aberto' },
          { value: 'historico', label: 'Histórico' },
        ]}
      />

      {/* ═══ PENDENTES: o técnico precisa informar valor/fornecedor/comprovante ═══ */}
      {aba === 'pendentes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading ? (
            <PageSpinner />
          ) : pendentes.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Tudo em dia!"
              subtitle="Nenhuma requisição esperando por você"
              tone="success"
            />
          ) : (
            pendentes.map((req) => {
              const guardada = noCelular.includes(req.id)
              const temValor = Number.isFinite(lerValor(req.valor_despeza))
              return (
                <CartaoReq
                  key={req.id}
                  href={`/requisicoes/atualizar/${req.id}`}
                  icon={Clock}
                  cor={COR.pendente}
                  id={req.id}
                  status="pedido"
                  titulo={req.titulo}
                  sub={`${req.tipo} · ${dataBR(req.data)}`}
                  meta={guardada
                    ? <span style={{ color: COR.pendente }}>Salvo no celular, vai quando tiver sinal</span>
                    : <span style={{ color: COR.pendente }}>{temValor ? `${valorTexto(req)} · falta o comprovante` : 'Toque para informar valor, fornecedor e comprovante'}</span>}
                  rodape={botaoCancelar(req)}
                />
              )
            })
          )}
        </div>
      )}

      {/* ═══ EM ABERTO: aguardando o escritório (só consulta) ═══ */}
      {aba === 'aberto' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading ? (
            <PageSpinner />
          ) : emAberto.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Nada em aberto"
              subtitle="O que você atualizar aparece aqui até o escritório finalizar"
            />
          ) : (
            emAberto.map((req) => {
              const st = getStatus(String(req.status || '').toLowerCase())
              return (
                <CartaoReq
                  key={req.id}
                  icon={ClipboardList}
                  cor={st.color}
                  id={req.id}
                  status={req.status}
                  titulo={req.titulo}
                  sub={`${req.tipo}${req.data ? ` · ${dataBR(req.data)}` : ''}`}
                  meta={valorTexto(req) || undefined}
                  rodape={req.status === 'pedido' ? botaoCancelar(req) : undefined}
                />
              )
            })
          )}
        </div>
      )}

      {/* ═══ HISTÓRICO ═══ */}
      {aba === 'historico' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading ? (
            <PageSpinner />
          ) : historico.length === 0 ? (
            <EmptyState icon={History} title="Nenhuma no histórico" />
          ) : (
            historico.map((req) => {
              const st = getStatus(String(req.status || '').toLowerCase())
              return (
                <CartaoReq
                  key={req.id}
                  icon={FileCheck}
                  cor={st.color}
                  id={req.id}
                  status={req.status}
                  titulo={req.titulo}
                  sub={`${req.tipo} · ${dataBR(req.data)}`}
                  meta={valorTexto(req) || undefined}
                />
              )
            })
          )}
        </div>
      )}

      <div style={{ height: 80 }} />
    </div>
  )
}
