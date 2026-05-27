'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, TrendingUp, TrendingDown, Trophy, Wrench, ShoppingCart,
  ClipboardList, Wallet, ChevronDown, RefreshCw, Info, Fuel, AlertTriangle, MapPin, Gift,
} from 'lucide-react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { PageHeader, PageSpinner, EmptyState } from '@/components/ui'
import { colors, radius, shadow, spacing, text } from '@/lib/ui'
import {
  fetchRelatorioMes, mesAtual, mesesOpcoes, fmtBRL, fmtBRLCompacto,
} from '@/lib/relatorios'
import type { RelatorioMes } from '@/lib/types'

export default function RelatoriosPage() {
  const { user } = useCurrentUser()
  const [mes, setMes] = useState<string>(mesAtual())
  const [open, setOpen] = useState<Record<'os' | 'pv' | 'req' | 'comb' | 'int' | 'inf', boolean>>({ os: false, pv: false, req: false, comb: false, int: false, inf: false })

  const opcoes = useMemo(() => mesesOpcoes(12), [])

  const profile = useMemo(
    () => ({
      nome_pos: user?.nome_pos || null,
      tecnico_nome: user?.tecnico_nome || '',
    }),
    [user?.nome_pos, user?.tecnico_nome],
  )

  // Versão da chave: bump quando o shape de RelatorioMes muda, p/ invalidar IndexedDB stale
  const { data, loading, refreshing, refresh } = useCached<RelatorioMes>(
    `relatorios:v11:${profile.tecnico_nome}:${mes}`,
    () => fetchRelatorioMes(profile, mes),
    { skip: !user },
  )

  const labelMes = opcoes.find(o => o.value === mes)?.label || mes

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
        <Link href="/" style={{
          width: 38, height: 38, borderRadius: radius.md, flexShrink: 0,
          background: colors.surface, border: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: colors.textMuted,
        }}>
          <ArrowLeft size={18} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title="Relatórios" subtitle={labelMes} />
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          style={{
            width: 38, height: 38, borderRadius: radius.md, flexShrink: 0,
            background: colors.surface, border: `1px solid ${colors.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: refreshing ? 'wait' : 'pointer',
            color: colors.textMuted,
          }}
          title="Atualizar"
        >
          <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
        </button>
      </div>

      {/* Seletor de mês */}
      <div style={{
        background: colors.surface, borderRadius: radius.lg,
        border: `1px solid ${colors.border}`, padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Período
        </span>
        <select
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontSize: 15, fontWeight: 700, color: colors.text, cursor: 'pointer',
            appearance: 'none',
            paddingRight: 28,
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right center',
          }}
        >
          {opcoes.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {refreshing && <div className="refresh-bar" />}

      {loading ? <PageSpinner /> : data ? (
        <>
          <SecaoOficina data={data} />
          <SecaoPessoal data={data} open={open} setOpen={setOpen} />
          <Rodape ultimoSync={data.ultimoSync} />
        </>
      ) : (
        <EmptyState
          icon={Info}
          title="Sem dados"
          subtitle="Não foi possível carregar o relatório deste mês."
        />
      )}

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .spin { animation: spin 0.9s linear infinite; }
      `}</style>
    </div>
  )
}

// =================================================================
// Seção: Geral da Oficina
// =================================================================

function SecaoOficina({ data }: { data: RelatorioMes }) {
  const { oficina, ranking } = data
  const max = Math.max(oficina.receitaTotal, oficina.despesaTotal, 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Wallet size={15} color={colors.accent} />
        <span style={text.sectionLabel}>Geral da Oficina</span>
      </div>

      {/* Cards receita x despesa */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
        <CardBarra
          tone="success"
          icon={<TrendingUp size={18} color={colors.success} />}
          label="Receita"
          valor={oficina.receitaTotal}
          subtitle={`${oficina.qtdOS} OS · ${oficina.qtdPV} PV faturados`}
          pct={(oficina.receitaTotal / max) * 100}
        />
        <CardBarra
          tone="danger"
          icon={<TrendingDown size={18} color={colors.danger} />}
          label="Despesa"
          valor={oficina.despesaTotal}
          subtitle="Operação + custos fixos da oficina"
          pct={(oficina.despesaTotal / max) * 100}
        />
      </div>

      {/* Ranking de faturadores */}
      <div style={{
        background: colors.surface, borderRadius: radius.xl,
        border: `1px solid ${colors.border}`, padding: '16px 18px',
        boxShadow: shadow.sm,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: spacing.md }}>
          <Trophy size={16} color={colors.warning} />
          <span style={{ ...text.sectionLabel, color: colors.warning }}>Top faturadores do mês</span>
        </div>

        {ranking.length === 0 ? (
          <div style={{ fontSize: 13, color: colors.textSubtle, padding: '20px 0', textAlign: 'center' }}>
            Nenhum faturamento registrado no período.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ranking.map((item, idx) => {
              const pct = ranking[0].valor > 0 ? (item.valor / ranking[0].valor) * 100 : 0
              return (
                <div key={`${item.nome}-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 800,
                        color: idx === 0 ? colors.warning : colors.textSubtle,
                        width: 18, textAlign: 'center',
                      }}>
                        {idx + 1}º
                      </span>
                      <span style={{
                        fontSize: 13,
                        fontWeight: item.isMe ? 800 : 600,
                        color: item.isMe ? colors.primary : colors.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {item.isMe ? `${item.nome} (você)` : item.nome}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: item.isMe ? colors.primary : colors.text,
                      flexShrink: 0,
                    }}>
                      {fmtBRLCompacto(item.valor)}
                    </span>
                  </div>
                  <div style={{
                    height: 6, background: colors.border, borderRadius: radius.pill,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: item.isMe ? colors.primary : (idx === 0 ? colors.warning : colors.accent),
                      borderRadius: radius.pill,
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function CardBarra({
  tone, icon, label, valor, subtitle, pct,
}: {
  tone: 'success' | 'danger'
  icon: React.ReactNode
  label: string
  valor: number
  subtitle: string
  pct: number
}) {
  const corBg = tone === 'success' ? colors.successBg : colors.dangerBg
  const corBorder = tone === 'success' ? colors.successBorder : colors.dangerBorder
  const corMain = tone === 'success' ? colors.success : colors.danger
  return (
    <div style={{
      background: corBg, borderRadius: radius.xl,
      border: `1px solid ${corBorder}`, padding: '14px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 700, color: corMain, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: corMain, lineHeight: 1.1 }}>
        {fmtBRLCompacto(valor)}
      </div>
      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 3 }}>{subtitle}</div>
      <div style={{ marginTop: 10, height: 6, background: 'rgba(255,255,255,0.6)', borderRadius: radius.pill, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(100, pct)}%`, height: '100%',
          background: corMain, borderRadius: radius.pill,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}

// =================================================================
// Seção: Meu Desempenho
// =================================================================

function SecaoPessoal({
  data,
  open,
  setOpen,
}: {
  data: RelatorioMes
  open: Record<'os' | 'pv' | 'req' | 'comb' | 'int' | 'inf', boolean>
  setOpen: React.Dispatch<React.SetStateAction<Record<'os' | 'pv' | 'req' | 'comb' | 'int' | 'inf', boolean>>>
}) {
  // Normaliza pessoal — protege contra cache stale ou falha parcial do fetcher
  // (campos novos podem estar ausentes em payload antigo).
  const empty = { qtd: 0, valor: 0, lista: [] as never[] }
  const pessoal = {
    os: data.pessoal?.os ?? empty,
    pv: data.pessoal?.pv ?? empty,
    requisicoes: data.pessoal?.requisicoes ?? empty,
    combustivel: data.pessoal?.combustivel ?? empty,
    osInternas: data.pessoal?.osInternas ?? empty,
    infracoes: data.pessoal?.infracoes ?? { qtd: 0, lista: [] as never[] },
    custoRH: data.pessoal?.custoRH ?? null,
    custoRHCadastro: data.pessoal?.custoRHCadastro ?? null,
  } as RelatorioMes['pessoal']

  const receita = pessoal.os.valor + pessoal.pv.valor
  const despesasReq = pessoal.requisicoes.valor
  const despesasComb = pessoal.combustivel.valor
  const custoOSInt = pessoal.osInternas.valor
  const custoRH = pessoal.custoRH || 0
  const saldo = receita - despesasReq - despesasComb - custoOSInt - custoRH
  const saldoPositivo = saldo >= 0

  const toggle = (k: 'os' | 'pv' | 'req' | 'comb' | 'int' | 'inf') => setOpen(prev => ({ ...prev, [k]: !prev[k] }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Wrench size={15} color={colors.primary} />
        <span style={text.sectionLabel}>Meu desempenho</span>
      </div>

      {/* Grid de números pessoais */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
        <CardMetricaPessoal
          icon={<Wrench size={18} color={colors.primary} />}
          label="OS faturadas"
          qtd={pessoal.os.qtd}
          valor={pessoal.os.valor}
        />
        <CardMetricaPessoal
          icon={<ShoppingCart size={18} color={colors.accent} />}
          label="PVs faturados"
          qtd={pessoal.pv.qtd}
          valor={pessoal.pv.valor}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
        <CardMetricaPessoal
          icon={<ClipboardList size={18} color={colors.warning} />}
          label="Requisições no financeiro"
          qtd={pessoal.requisicoes.qtd}
          valor={pessoal.requisicoes.valor}
        />
        <CardMetricaPessoal
          icon={<Fuel size={18} color={colors.danger} />}
          label="Combustível"
          qtd={pessoal.combustivel.qtd}
          valor={pessoal.combustivel.valor}
        />
      </div>

      {/* Card saldo */}
      <div style={{
        background: saldoPositivo ? colors.successBg : colors.dangerBg,
        borderRadius: radius.xl,
        border: `1px solid ${saldoPositivo ? colors.successBorder : colors.dangerBorder}`,
        padding: '18px 18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {saldoPositivo
            ? <TrendingUp size={16} color={colors.success} />
            : <TrendingDown size={16} color={colors.danger} />}
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: saldoPositivo ? colors.success : colors.danger,
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            Saldo do mês
          </span>
        </div>

        <LinhaSaldo label="Receita gerada" valor={receita} positivo />
        <LinhaSaldo label="− Requisições no seu nome" valor={despesasReq} />
        <LinhaSaldo label="− Combustível do seu veículo" valor={despesasComb} />
        {custoOSInt > 0 && (
          <LinhaSaldo label="− OS internas / cortesia (sem retorno)" valor={custoOSInt} />
        )}
        {pessoal.custoRH !== null && pessoal.custoRH > 0 && (
          <LinhaSaldo label="− Custo RH (salário + encargos)" valor={custoRH} />
        )}

        <div style={{
          borderTop: `1px dashed ${saldoPositivo ? colors.successBorder : colors.dangerBorder}`,
          marginTop: 10, paddingTop: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>
            Saldo líquido
          </span>
          <span style={{
            fontSize: 18, fontWeight: 800,
            color: saldoPositivo ? colors.success : colors.danger,
          }}>
            {saldoPositivo ? '+' : ''}{fmtBRL(saldo)}
          </span>
        </div>

        {pessoal.custoRH === null && (
          <div style={{
            marginTop: 10, fontSize: 11, color: colors.textMuted, display: 'flex',
            alignItems: 'flex-start', gap: 6,
          }}>
            <Info size={12} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>
              Você não foi encontrado no cadastro de salários
              (<code style={{ fontSize: 10 }}>config_vendedores_relatorio</code>).
              Peça ao administrador para cadastrar seu nome.
            </span>
          </div>
        )}
        {pessoal.custoRH !== null && pessoal.custoRH === 0 && (
          <div style={{
            marginTop: 10, fontSize: 11, color: colors.warning, display: 'flex',
            alignItems: 'flex-start', gap: 6,
          }}>
            <Info size={12} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>
              Cadastro encontrado{pessoal.custoRHCadastro ? ` como "${pessoal.custoRHCadastro}"` : ''},
              mas <strong>sem salário/encargos preenchido</strong>. Peça ao admin pra atualizar
              o registro em <code style={{ fontSize: 10 }}>config_vendedores_relatorio</code>.
            </span>
          </div>
        )}
      </div>

      {/* Drilldown OS */}
      <Expandable
        icon={<Wrench size={16} color={colors.primary} />}
        title="Detalhes das OS faturadas"
        qtd={pessoal.os.qtd}
        valor={pessoal.os.valor}
        isOpen={open.os}
        onToggle={() => toggle('os')}
      >
        {pessoal.os.lista.length === 0 ? (
          <DrilldownVazio msg="Nenhuma OS faturada no período" />
        ) : (
          pessoal.os.lista.map(o => (
            <LinhaDetalhe key={o.numero} titulo={`OS ${o.numero}`} subtitulo={o.cliente} data={o.data} valor={o.valor} />
          ))
        )}
      </Expandable>

      {/* Drilldown PV */}
      <Expandable
        icon={<ShoppingCart size={16} color={colors.accent} />}
        title="Detalhes dos PVs faturados"
        qtd={pessoal.pv.qtd}
        valor={pessoal.pv.valor}
        isOpen={open.pv}
        onToggle={() => toggle('pv')}
      >
        {pessoal.pv.lista.length === 0 ? (
          <DrilldownVazio msg="Nenhum PV faturado no período" />
        ) : (
          pessoal.pv.lista.map(p => (
            <LinhaDetalhe key={p.numero} titulo={`PV ${p.numero}`} subtitulo={p.cliente} data={p.data} valor={p.valor} />
          ))
        )}
      </Expandable>

      {/* Drilldown Requisições */}
      <Expandable
        icon={<ClipboardList size={16} color={colors.warning} />}
        title="Detalhes das requisições"
        qtd={pessoal.requisicoes.qtd}
        valor={pessoal.requisicoes.valor}
        isOpen={open.req}
        onToggle={() => toggle('req')}
      >
        {pessoal.requisicoes.lista.length === 0 ? (
          <DrilldownVazio msg="Nenhuma requisição no financeiro no período" />
        ) : (
          pessoal.requisicoes.lista.map(r => (
            <LinhaDetalhe key={r.id} titulo={r.descricao || 'Despesa'} subtitulo={r.fornecedor} data={r.data} valor={r.valor} />
          ))
        )}
      </Expandable>

      {/* Drilldown Combustível */}
      <Expandable
        icon={<Fuel size={16} color={colors.danger} />}
        title="Detalhes do combustível"
        qtd={pessoal.combustivel.qtd}
        valor={pessoal.combustivel.valor}
        isOpen={open.comb}
        onToggle={() => toggle('comb')}
      >
        {pessoal.combustivel.lista.length === 0 ? (
          <DrilldownVazio msg="Nenhum abastecimento registrado no período" />
        ) : (
          pessoal.combustivel.lista.map(r => (
            <LinhaDetalhe key={r.id} titulo={r.descricao} subtitulo={r.fornecedor} data={r.data} valor={r.valor} />
          ))
        )}
      </Expandable>

      {/* Drilldown OS internas / cortesia (custo absorvido) */}
      {pessoal.osInternas.qtd > 0 && (
        <Expandable
          icon={<Gift size={16} color={colors.warning} />}
          title="OS internas / cortesia"
          qtd={pessoal.osInternas.qtd}
          valor={pessoal.osInternas.valor}
          isOpen={open.int}
          onToggle={() => toggle('int')}
        >
          <div style={{
            padding: '8px 10px', marginBottom: 6,
            fontSize: 11, color: colors.warning, fontWeight: 600,
            background: colors.warningBg, borderRadius: radius.md,
            border: `1px solid ${colors.warningBorder}`,
            display: 'flex', alignItems: 'flex-start', gap: 6,
          }}>
            <Info size={12} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>Trabalho seu sem faturamento ao cliente — entra como custo absorvido no seu saldo.</span>
          </div>
          {pessoal.osInternas.lista.map(o => (
            <LinhaDetalhe key={o.numero} titulo={`OS ${o.numero}`} subtitulo={o.cliente} data={o.data} valor={o.valor} />
          ))}
        </Expandable>
      )}

      {/* Infrações de trânsito */}
      <CardInfracoes infracoes={pessoal.infracoes} isOpen={open.inf} onToggle={() => toggle('inf')} />
    </div>
  )
}

// =================================================================
// Card de infrações de trânsito (com deep-link pro mapa)
// =================================================================

function CardInfracoes({
  infracoes,
  isOpen,
  onToggle,
}: {
  infracoes: RelatorioMes['pessoal']['infracoes']
  isOpen: boolean
  onToggle: () => void
}) {
  const qtd = infracoes.qtd
  const temInfracao = qtd > 0
  const tomBg = temInfracao ? colors.dangerBg : colors.successBg
  const tomBorder = temInfracao ? colors.dangerBorder : colors.successBorder
  const tomMain = temInfracao ? colors.danger : colors.success

  return (
    <div style={{
      background: colors.surface, borderRadius: radius.xl,
      border: `1px solid ${colors.border}`, overflow: 'hidden',
      boxShadow: shadow.sm,
    }}>
      <button onClick={onToggle} style={{
        width: '100%', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <AlertTriangle size={16} color={tomMain} />
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.text, textAlign: 'left' }}>
            Infrações de trânsito
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 11, fontWeight: 800,
            color: tomMain,
            background: tomBg,
            border: `1px solid ${tomBorder}`,
            padding: '3px 9px', borderRadius: radius.sm,
          }}>
            {qtd}
          </span>
          <ChevronDown size={18} color={colors.textSubtle} style={{
            transition: 'transform 0.2s',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }} />
        </div>
      </button>

      {isOpen && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!temInfracao ? (
            infracoes.motivoVazio ? (
              <div style={{
                padding: '12px 12px',
                fontSize: 11, color: colors.textMuted, lineHeight: 1.5,
                background: colors.surfaceAlt, borderRadius: radius.md,
                border: `1px solid ${colors.border}`,
                display: 'flex', alignItems: 'flex-start', gap: 6,
              }}>
                <Info size={12} style={{ marginTop: 2, flexShrink: 0, color: colors.textSubtle }} />
                <span>{infracoes.motivoVazio}</span>
              </div>
            ) : (
              <div style={{
                padding: '14px 12px', textAlign: 'center',
                fontSize: 12, color: colors.success, fontWeight: 600,
                background: colors.successBg, borderRadius: radius.md,
                border: `1px solid ${colors.successBorder}`,
              }}>
                Sem infrações no período. Bom trabalho.
              </div>
            )
          ) : (
            <>
              <div style={{
                fontSize: 11, color: colors.textMuted,
                padding: '6px 4px 2px',
                display: 'flex', alignItems: 'flex-start', gap: 5,
              }}>
                <Info size={11} style={{ marginTop: 2, flexShrink: 0 }} />
                <span>
                  Velocidade comparada com o limite da via (OpenStreetMap).
                  Clique em uma linha para ver no mapa.
                </span>
              </div>
              {infracoes.lista.map(inf => (
                <LinkInfracao key={inf.id} inf={inf} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function LinkInfracao({ inf }: { inf: RelatorioMes['pessoal']['infracoes']['lista'][number] }) {
  // Data ISO YYYY-MM-DD pra query do mapa
  const dataISO = inf.dtPosicao.split('T')[0]
  const href = `/mapa?placa=${encodeURIComponent(inf.placa)}&data=${dataISO}&infracao=${inf.lat},${inf.lng}`

  return (
    <Link href={href} style={{
      background: colors.dangerBg, borderRadius: radius.md,
      padding: '10px 12px', textDecoration: 'none',
      border: `1px solid ${colors.dangerBorder}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: colors.danger, color: '#fff',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        lineHeight: 1,
      }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{inf.velocidade}</span>
        <span style={{ fontSize: 7, fontWeight: 700, opacity: 0.85 }}>km/h</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: colors.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          +{inf.excesso} km/h acima do limite ({inf.maxspeed})
        </div>
        <div style={{
          fontSize: 11, color: colors.textMuted, marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {inf.via} · {inf.placa}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted }}>
          {inf.data}
        </div>
        <div style={{ fontSize: 10, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end', marginTop: 2 }}>
          <MapPin size={9} /> {inf.hora}
        </div>
      </div>
    </Link>
  )
}

function CardMetricaPessoal({
  icon, label, qtd, valor, fullWidth,
}: {
  icon: React.ReactNode
  label: string
  qtd: number
  valor: number
  fullWidth?: boolean
}) {
  return (
    <div style={{
      background: colors.surface, borderRadius: radius.xl,
      border: `1px solid ${colors.border}`, padding: '14px 14px',
      boxShadow: shadow.sm,
      gridColumn: fullWidth ? '1 / -1' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {icon}
        <span style={{ fontSize: 12, fontWeight: 700, color: colors.textMuted }}>
          {label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: colors.text, lineHeight: 1 }}>{qtd}</span>
        <span style={{ fontSize: 12, color: colors.textSubtle }}>{qtd === 1 ? 'item' : 'itens'}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: colors.textMuted, marginTop: 4 }}>
        {fmtBRL(valor)}
      </div>
    </div>
  )
}

function LinhaSaldo({ label, valor, positivo }: { label: string; valor: number; positivo?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ fontSize: 13, color: colors.textMuted }}>{label}</span>
      <span style={{
        fontSize: 14, fontWeight: 700,
        color: positivo ? colors.text : colors.textMuted,
      }}>
        {fmtBRL(valor)}
      </span>
    </div>
  )
}

function Expandable({
  icon, title, qtd, valor, isOpen, onToggle, children,
}: {
  icon: React.ReactNode
  title: string
  qtd: number
  valor: number
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div style={{
      background: colors.surface, borderRadius: radius.xl,
      border: `1px solid ${colors.border}`, overflow: 'hidden',
      boxShadow: shadow.sm,
    }}>
      <button onClick={onToggle} style={{
        width: '100%', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {icon}
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.text, textAlign: 'left' }}>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle }}>
            {qtd} · {fmtBRLCompacto(valor)}
          </span>
          <ChevronDown size={18} color={colors.textSubtle} style={{
            transition: 'transform 0.2s',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }} />
        </div>
      </button>
      {isOpen && (
        <div style={{
          padding: '0 14px 14px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

function LinhaDetalhe({
  titulo, subtitulo, data, valor,
}: {
  titulo: string
  subtitulo: string
  data: string
  valor: number
}) {
  return (
    <div style={{
      background: colors.surfaceAlt, borderRadius: radius.md,
      padding: '10px 12px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: colors.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {titulo}
        </div>
        {subtitulo && (
          <div style={{
            fontSize: 11, color: colors.textSubtle, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {subtitulo}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{fmtBRL(valor)}</div>
        {data && <div style={{ fontSize: 10, color: colors.textSubtle }}>{data}</div>}
      </div>
    </div>
  )
}

function DrilldownVazio({ msg }: { msg: string }) {
  return (
    <div style={{
      padding: '14px 12px', textAlign: 'center',
      fontSize: 12, color: colors.textSubtle,
      background: colors.surfaceAlt, borderRadius: radius.md,
    }}>
      {msg}
    </div>
  )
}

function Rodape({ ultimoSync }: { ultimoSync: string | null }) {
  if (!ultimoSync) return null
  const dt = new Date(ultimoSync)
  const label = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    + ' às ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return (
    <div style={{
      fontSize: 11, color: colors.textSubtle, textAlign: 'center',
      padding: '8px 0',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      <Info size={12} />
      <span>Dados sincronizados com o ERP em {label}</span>
    </div>
  )
}
