'use client'
import { useState, useEffect, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import { cacheInvalidate } from '@/lib/cache'
import { getCachedRequisicoes } from '@/lib/prefetch'
import { fmtData } from '@/lib/garantias/format'
import {
  FilePlus, FileCheck, History, ClipboardList, XCircle,
  CheckCircle2, Clock, Package, WifiOff,
} from 'lucide-react'
import Link from 'next/link'
import { notificarPortalReq } from '@/lib/notificarPortal'
import {
  PageHeader, StatCard, TabBar, ListRow, EmptyState, PageSpinner, Badge,
} from '@/components/ui'
import { colors, radius, shadow, getStatus } from '@/lib/ui'

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
}

interface ReqData {
  pendentes: RequisicaoPOS[]
  enviadas: RequisicaoPOS[]
  historico: RequisicaoPOS[]
}

async function fetchReqData(nome: string, tecnicoNome: string): Promise<ReqData> {
  const [pendRes, envRes, histRes] = await Promise.all([
    supabase
      .from('Requisicao')
      .select('id, titulo, tipo, solicitante, data, status, fornecedor, valor_despeza, recibo_fornecedor, obs')
      .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
      .eq('status', 'pedido')
      .is('recibo_fornecedor', null)
      .order('data', { ascending: false }),
    supabase
      .from('Requisicao')
      .select('id, titulo, tipo, solicitante, data, status, fornecedor, valor_despeza, recibo_fornecedor, obs')
      .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
      .eq('status', 'pedido')
      .order('data', { ascending: false }),
    supabase
      .from('Requisicao')
      .select('id, titulo, tipo, solicitante, data, status, fornecedor, valor_despeza, recibo_fornecedor, obs')
      .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
      .not('status', 'in', '("pedido","lixeira")')
      .order('data', { ascending: false })
      .limit(50),
  ])

  // Falha de rede/consulta tem que lançar: senão o useCached grava listas
  // vazias por cima do cache bom e a tela diz "nenhuma requisição".
  const erro = pendRes.error || envRes.error || histRes.error
  if (erro) throw new Error(erro.message)

  return {
    pendentes: (pendRes.data || []) as RequisicaoPOS[],
    enviadas: (envRes.data || []) as RequisicaoPOS[],
    historico: (histRes.data || []) as RequisicaoPOS[],
  }
}

/** valor_despeza é texto digitado pelo técnico ("1.250,50", "150,00", "150.5").
 *  Number("150,00") dava NaN e a tela mostrava "R$ NaN". */
function fmtValorReq(v: string | null): string {
  if (!v) return ''
  const s = String(v).replace(/[R$\s]/g, '')
  const milharBR = /^\d{1,3}(\.\d{3})+$/.test(s) // "1.250" = mil duzentos e cinquenta
  const n = Number(s.includes(',') || milharBR ? s.replace(/\./g, '').replace(',', '.') : s)
  if (!isFinite(n)) return `R$ ${v}`
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Monta as 3 listas a partir do prefetch offline (Requisicao select *) */
function separarReqs(rows: RequisicaoPOS[]): ReqData {
  const pedidos = rows.filter((r) => r.status === 'pedido')
  return {
    pendentes: pedidos.filter((r) => !r.recibo_fornecedor),
    enviadas: pedidos,
    historico: rows.filter((r) => r.status !== 'pedido' && r.status !== 'lixeira').slice(0, 50),
  }
}

/* ─── Card de requisição reutilizável ─── */
function ReqBadge({ id, status, color = colors.primary }: { id: number; status: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color }}>#{id}</span>
      <Badge status={status}>{getStatus(status).label}</Badge>
    </div>
  )
}

export default function RequisicoesHub() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''
  const cacheKey = `requisicoes:${nome}`

  const { data, loading, refreshing, refresh } = useCached<ReqData>(
    cacheKey,
    () => fetchReqData(nome, user?.tecnico_nome || ''),
    { skip: !user },
  )

  const [aba, setAba] = useState<'atualizar' | 'enviadas' | 'historico'>('enviadas')
  const [cancelando, setCancelando] = useState<number | null>(null)
  const cancelandoRef = useRef(false)

  // Sem cache e sem rede: cai nos dados baixados pelo prefetch
  const [fallback, setFallback] = useState<ReqData | null>(null)
  useEffect(() => {
    if (loading || data || !user) return
    let vivo = true
    getCachedRequisicoes()
      .then((rows) => { if (vivo && rows) setFallback(separarReqs(rows as unknown as RequisicaoPOS[])) })
      .catch(() => {})
    return () => { vivo = false }
  }, [loading, data, user])

  const usandoFallback = !data && !!fallback
  const semDados = !loading && !!user && !data && !fallback
  const { pendentes = [], enviadas = [], historico = [] } = data || fallback || {}

  const solicitarCancelamento = async (id: number) => {
    // Guarda síncrona contra toque duplo (o disabled só vale após o re-render)
    if (cancelandoRef.current) return
    const confirmar = window.confirm('Tem certeza que deseja solicitar o cancelamento desta requisição?')
    if (!confirmar) return
    cancelandoRef.current = true
    setCancelando(id)
    try {
      const req = enviadas.find(r => r.id === id)
      const res = await offlineWrite({
        table: 'Requisicao', action: 'update', data: { status: 'cancelar' }, match: { id },
      })
      if (!res.ok) {
        alert('Erro ao solicitar cancelamento. Tente novamente.')
      } else {
        notificarPortalReq(
          'Solicitação de Cancelamento',
          `Técnico ${nome} solicitou cancelamento da requisição #${id}${req ? ` — ${req.titulo}` : ''}`
        )
        if (res.queued) alert('Sem sinal agora — o pedido de cancelamento será enviado assim que a conexão voltar.')
        cacheInvalidate(cacheKey)
        refresh()
      }
    } catch (err) {
      console.error('[requisicoes] cancelar:', err)
      alert('Erro ao solicitar cancelamento. Verifique o sinal e tente novamente.')
    } finally {
      cancelandoRef.current = false
      setCancelando(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {refreshing && <div className="refresh-bar" />}

      <PageHeader
        title="Requisições"
        action={
          <Link href="/requisicoes/nova" style={{
            background: colors.primary, borderRadius: radius.md, padding: '10px 16px', minHeight: 44,
            color: '#fff', textDecoration: 'none',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, fontWeight: 700,
            boxShadow: shadow.primary,
          }}>
            <FilePlus size={15} />
            Nova
          </Link>
        }
      />

      {(usandoFallback || semDados) && (
        <div role="status" style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '10px 12px', borderRadius: radius.md,
          background: usandoFallback ? colors.warningBg : colors.dangerBg,
          color: usandoFallback ? '#92400E' : colors.danger,
          fontSize: 13, fontWeight: 600,
        }}>
          <WifiOff size={15} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            {usandoFallback
              ? 'Sem conexão — mostrando as requisições salvas no aparelho.'
              : 'Não foi possível carregar as requisições. Verifique o sinal.'}
          </span>
          <button type="button" onClick={refresh} style={{
            minHeight: 40, padding: '0 12px', borderRadius: radius.md, border: 'none',
            background: '#fff', color: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            Tentar de novo
          </button>
        </div>
      )}

      {/* Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <StatCard value={pendentes.length} label="Pendentes" tone="warning" />
        <StatCard value={enviadas.length} label="Em aberto" tone="info" />
        <StatCard value={historico.length} label="Histórico" tone="success" />
      </div>

      {/* Tabs */}
      <TabBar
        value={aba}
        onChange={setAba}
        options={[
          { value: 'atualizar', label: 'Atualizar', badgeCount: pendentes.length },
          { value: 'enviadas', label: 'Enviadas' },
          { value: 'historico', label: 'Histórico' },
        ]}
      />

      {/* ═══ ABA ATUALIZAR ═══ */}
      {aba === 'atualizar' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <PageSpinner />
          ) : pendentes.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Tudo em dia!"
              subtitle="Nenhuma pendente de atualização"
              tone="success"
            />
          ) : (
            pendentes.map((req) => (
              <ListRow
                key={req.id}
                href={`/requisicoes/atualizar/${req.id}`}
                icon={Clock}
                iconColor={colors.warning}
                iconBg={colors.warningBg}
                badge={<ReqBadge id={req.id} status="pendente" />}
                title={req.titulo}
                subtitle={`${req.tipo} · ${fmtData(req.data)}`}
              />
            ))
          )}
        </div>
      )}

      {/* ═══ ABA ENVIADAS ═══ */}
      {aba === 'enviadas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <PageSpinner />
          ) : enviadas.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Nenhuma requisição enviada"
              subtitle="Suas solicitações aparecerão aqui"
            />
          ) : (
            enviadas.map((req) => {
              const st = getStatus(req.status)
              const podeCancelar = req.status === 'pedido'
              return (
                <div key={req.id} style={{
                  background: colors.surface,
                  borderRadius: radius.xl,
                  border: `1px solid ${colors.border}`,
                  overflow: 'hidden',
                }}>
                  <ListRow
                    href={`/requisicoes/atualizar/${req.id}`}
                    icon={ClipboardList}
                    iconColor={st.color}
                    iconBg={st.bg}
                    badge={<ReqBadge id={req.id} status={req.status} />}
                    title={req.titulo}
                    subtitle={`${req.tipo} · ${fmtData(req.data)}`}
                  />
                  {podeCancelar && (
                    <div style={{ padding: '0 14px 12px' }}>
                      <button
                        onClick={() => solicitarCancelamento(req.id)}
                        disabled={cancelando === req.id}
                        style={{
                          width: '100%', padding: '9px 0', minHeight: 40,
                          borderRadius: radius.md,
                          border: `1px solid ${colors.dangerBorder}`,
                          background: cancelando === req.id ? colors.dangerBg : colors.surface,
                          color: colors.danger, fontSize: 12, fontWeight: 700,
                          cursor: cancelando === req.id ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}
                      >
                        <XCircle size={13} />
                        {cancelando === req.id ? 'Cancelando...' : 'Solicitar Cancelamento'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ═══ ABA HISTÓRICO ═══ */}
      {aba === 'historico' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <PageSpinner />
          ) : historico.length === 0 ? (
            <EmptyState icon={History} title="Nenhuma no histórico" />
          ) : (
            historico.map((req) => {
              const st = getStatus(req.status)
              return (
                <ListRow
                  key={req.id}
                  icon={FileCheck}
                  iconColor={st.color}
                  iconBg={st.bg}
                  badge={<ReqBadge id={req.id} status={req.status} color={colors.accent} />}
                  title={req.titulo}
                  subtitle={`${req.tipo} · ${fmtData(req.data)}`}
                  meta={
                    req.fornecedor && (
                      <span style={{ color: colors.success, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {req.fornecedor}
                        {req.valor_despeza ? ` · ${fmtValorReq(req.valor_despeza)}` : ''}
                      </span>
                    )
                  }
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
