'use client'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { supabase } from '@/lib/supabase'
import { ChevronRight, FileCheck, Send } from 'lucide-react'
import Link from 'next/link'
import { PageHeader, EmptyState, PageSpinner } from '@/components/ui'
import { colors } from '@/lib/ui'
import { SITUACAO, clarinho, numeroOS, nomeBonito, tecnicoNoCampo } from '@/components/OsCardTecnico'
import { melhorRelatorio } from '@/lib/diasRelatorio'

/** "2026-10-21" ou ISO → "21/10/2026" (data pura sem cair no dia anterior pelo fuso) */
function dataBR(d: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d).trim())
  return m ? `${m[3]}/${m[2]}/${m[1]}` : new Date(d).toLocaleDateString('pt-BR')
}

interface OsEnviada {
  IdOs: number
  Ordem_Servico: string
  TecResp1: string
  Data: string
  TipoServico: string
  Status: string
  cliente?: string | null
  [key: string]: unknown
}

const FASES_FINALIZADAS = [
  'Relatório Concluído', 'Relatorio Concluido',
  'Executada aguardando comercial',
  'Concluída', 'Concluida', 'Concluído', 'Concluido',
  'Faturada', 'Faturado',
  'Finalizada', 'Finalizado',
  'Enviado Para Omie', 'Enviado para Omie',
  'Preenchido Garantia',
]

/** só letras do 1º nome no filtro (vírgula/parêntese quebram o .or) — o filtro fino é o tecnicoNoCampo */
const primeiroNome = (nome: string) => nome.replace(/[,()%*]/g, ' ').trim().split(/\s+/)[0] || '_'

async function fetchOsEnviadas(nome: string): Promise<OsEnviada[]> {
  const p1 = primeiroNome(nome)
  // Relatórios ENVIADOS do técnico (rascunho de horários não é "enviada" — José, 23/10/2026)
  const { data: tecData } = await supabase
    .from('Ordem_Servico_Tecnicos')
    .select('IdOs, Ordem_Servico, TecResp1, TecResp2, Data, TipoServico, Status')
    .or(`TecResp1.ilike.%${p1}%,TecResp2.ilike.%${p1}%`)
    .eq('Status', 'enviado')
    .order('Data', { ascending: false })
  const meus = ((tecData || []) as OsEnviada[])
    .filter((t) => tecnicoNoCampo(t.TecResp1, nome) || tecnicoNoCampo(t.TecResp2, nome))
  // uma por OS (havia OS com relatório duplicado)
  const porOs = new Map<string, OsEnviada[]>()
  for (const t of meus) porOs.set(String(t.Ordem_Servico), [...(porOs.get(String(t.Ordem_Servico)) || []), t])
  const relatorios = [...porOs.values()].map((l) => melhorRelatorio(l)!).filter(Boolean)

  // OS em fases finais (portal avançou) que o técnico não tem relatório
  const { data: osFinais } = await supabase
    .from('Ordem_Servico')
    .select('Id_Ordem, Status, Os_Cliente, Previsao_Execucao, Os_Tecnico, Os_Tecnico2')
    .or(`Os_Tecnico.ilike.%${p1}%,Os_Tecnico2.ilike.%${p1}%`)
    .in('Status', FASES_FINALIZADAS)
  const finais = ((osFinais || []) as Record<string, unknown>[])
    .filter((o) => tecnicoNoCampo(o.Os_Tecnico, nome) || tecnicoNoCampo(o.Os_Tecnico2, nome))

  // nome do cliente (o cartão mostrava o técnico no lugar do cliente)
  const ids = relatorios.map((r) => String(r.Ordem_Servico))
  const clientes: Record<string, string> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('Ordem_Servico').select('Id_Ordem, Os_Cliente').in('Id_Ordem', ids.slice(i, i + 200))
    for (const o of (data || []) as { Id_Ordem: string; Os_Cliente: string | null }[]) clientes[String(o.Id_Ordem)] = o.Os_Cliente || ''
  }

  const idsComRelatorio = new Set(ids)
  const extras: OsEnviada[] = finais
    .filter(o => !idsComRelatorio.has(String(o.Id_Ordem)))
    .map(o => ({
      IdOs: 0,
      Ordem_Servico: String(o.Id_Ordem),
      TecResp1: '',
      Data: String(o.Previsao_Execucao || ''),
      TipoServico: String(o.Status || ''),
      Status: 'enviado',
      cliente: String(o.Os_Cliente || ''),
    }))

  return [...relatorios.map((r) => ({ ...r, cliente: clientes[String(r.Ordem_Servico)] || '' })), ...extras]
    .sort((a, b) => String(b.Data || '').localeCompare(String(a.Data || '')))
}

export default function OsEnviadas() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const { data: ordens, loading, refreshing } = useCached<OsEnviada[]>(
    `os-enviadas:v2:${nome}`,
    () => fetchOsEnviadas(nome),
    { skip: !user },
  )

  const verde = SITUACAO.feita.cor

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {refreshing && <div className="refresh-bar" />}

      <PageHeader title="OS enviadas" subtitle={loading ? 'carregando…' : `${ordens?.length || 0} relatório${(ordens?.length || 0) === 1 ? '' : 's'} enviado${(ordens?.length || 0) === 1 ? '' : 's'}`} />

      {loading ? (
        <PageSpinner />
      ) : !ordens || ordens.length === 0 ? (
        <EmptyState icon={Send} title="Nenhuma OS enviada" subtitle="Suas ordens de serviço enviadas aparecerão aqui" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ordens.map((os, i) => (
            <Link
              key={`o-${os.Ordem_Servico}`}
              href={`/os-enviadas/${os.Ordem_Servico}`}
              className="hb-in"
              style={{
                display: 'grid', gap: 9, padding: '0 14px 13px', minWidth: 0, overflow: 'hidden',
                background: clarinho(verde, 5), border: `1px solid ${clarinho(verde, 30, colors.border)}`,
                borderRadius: 16, textDecoration: 'none', color: colors.text,
                animationDelay: `${Math.min(i * 45, 300)}ms`,
              }}
            >
              {/* faixa no topo com a situação */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 -14px', padding: '6px 14px', background: verde, color: '#FEFEFE' }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Enviada</span>
                <small style={{ fontSize: 12, opacity: 0.9 }}>{os.Data ? `relatório de ${dataBR(os.Data)}` : 'relatório enviado'}</small>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: verde, color: '#FEFEFE', display: 'grid', placeItems: 'center' }}>
                  <FileCheck size={18} />
                </span>
                <div style={{ display: 'grid', gap: 3, flex: 1, minWidth: 0 }}>
                  <span style={{
                    justifySelf: 'start', display: 'inline-flex', gap: 5, alignItems: 'baseline', fontSize: 13, padding: '0 8px',
                    borderRadius: 7, background: clarinho(verde, 8), border: `1px solid ${clarinho(verde, 20, 'transparent')}`,
                  }}>
                    <em style={{ fontStyle: 'normal', fontSize: 10.5, color: verde }}>OS</em>{numeroOS(os.Ordem_Servico)}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nomeBonito(os.cliente) || 'Sem cliente'}
                  </span>
                  {os.TipoServico && (
                    <span style={{ fontSize: 13, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{os.TipoServico}</span>
                  )}
                </div>
                <ChevronRight size={18} color="#94A3B8" style={{ flexShrink: 0 }} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
