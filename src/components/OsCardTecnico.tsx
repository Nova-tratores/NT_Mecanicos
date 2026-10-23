'use client'
import { hojeBR } from '@/lib/hoje'
// Cartão de OS da lista do técnico (tirado de app/(tecnico)/os/page.tsx em 22/10/2026 para a prévia do resserviço
// usar o mesmo cartão). Inclui os ajudantes de fase.
// 22/10/2026 — "Estilo POS NewPortal": a cor da SITUAÇÃO vai na etiqueta e no ícone do cartão. As cores querem
// dizer sempre a mesma coisa — no cartão, nas barrinhas dos dias da Lousa e na legenda (a tela inicial usa as
// mesmas peças daqui).
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Tractor, MapPin, ChevronRight, RotateCcw, Package, CheckCircle2, Clock, Cog, Building2, type LucideIcon } from 'lucide-react'
import type { OrdemServico } from '@/lib/types'
import { colors } from '@/lib/ui'
import { infoResservico } from '@/lib/resservico'

function getHoje() {
  return hojeBR()
}

/* ═══ Helpers de fase ═══ */
export const FASES_ORCAMENTO = ['Orçamento', 'Orçamento enviado para o cliente e aguardando']
export const FASES_EXECUCAO = ['Execução', 'Execução Procurando peças', 'Execução aguardando peças (em transporte)']
export const FASES_AGUARDANDO = ['Aguardando outros', 'Aguardando ordem Técnico', 'Relatório Concluído', 'Executada aguardando comercial']

export function getFaseInfo(status: string): { label: string; color: string; bg: string } {
  if (FASES_EXECUCAO.includes(status)) {
    if (status.includes('peças')) return { label: 'Aguardando peças', color: colors.warning, bg: colors.warningBg }
    return { label: 'Em execução', color: colors.info, bg: colors.infoBg }
  }
  if (status === 'Aguardando ordem Técnico') return { label: 'Aguard. ordem técnico', color: '#7C3AED', bg: '#F5F3FF' }
  if (status === 'Relatório Concluído') return { label: 'Rel. Concluído', color: colors.warning, bg: colors.warningBg }
  if (status === 'Executada aguardando comercial') return { label: 'Aguard. comercial', color: colors.warning, bg: colors.warningBg }
  if (status === 'Aguardando outros') return { label: 'Aguardando', color: colors.textMuted, bg: colors.border }
  if (status.includes('Orçamento')) return { label: 'Orçamento', color: colors.accent, bg: colors.accentBg }
  return { label: status, color: colors.textMuted, bg: colors.border }
}

/* ═══ Situação da OS na visão do técnico (cores fixas) ═══ */
export type Situacao = { rot: string; cor: string; dica: string }
export const SITUACAO = {
  fazer: { rot: 'Para fazer', cor: colors.osFazer, dica: 'ainda não começou' },
  execucao: { rot: 'Em execução', cor: colors.osExecucao, dica: 'você está fazendo' },
  pecas: { rot: 'Esperando peças', cor: colors.osPecas, dica: 'parada pela peça' },
  feita: { rot: 'Feita', cor: colors.osFeita, dica: 'relatório enviado' },
  atrasada: { rot: 'Atrasada', cor: colors.osAtrasada, dica: 'o dia já passou e não foi feita' },
  resservico: { rot: 'Resserviço', cor: colors.osResservico, dica: 'voltar para refazer' },
  orcamento: { rot: 'Orçamento', cor: '#0891B2', dica: 'esperando o cliente aprovar' },
} as const
/** as 6 cores da legenda */
export const LEGENDA: Situacao[] = [SITUACAO.fazer, SITUACAO.execucao, SITUACAO.pecas, SITUACAO.feita, SITUACAO.atrasada, SITUACAO.resservico]

/** situação pelo Status do POS. `atrasou` = o dia/previsão já passou (só vale antes de feita). */
export function situacaoOS(status?: string | null, atrasou?: boolean, resservico?: boolean): Situacao {
  const s = String(status || '')
  const feita = /Conclu|Relat|Executada|Omie|Cobrando|Garantia|Fatur|Finaliz/i.test(s)
  if (resservico && !feita) return SITUACAO.resservico
  if (feita) return SITUACAO.feita
  if (/Or[çc]amento/i.test(s)) return SITUACAO.orcamento
  if (/pe[çc]as/i.test(s)) return atrasou ? SITUACAO.atrasada : SITUACAO.pecas
  if (/Execu/i.test(s)) return atrasou ? SITUACAO.atrasada : SITUACAO.execucao
  if (/^Aguardando/i.test(s)) return atrasou ? SITUACAO.atrasada : SITUACAO.fazer
  return { rot: s || '—', cor: colors.textSubtle, dica: '' }
}

/* ═══ Textos ═══ */
export const nomeBonito = (n?: string | null) => String(n || '').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()).replace(/ (De|Da|Do|Dos|Das|E) /g, (m) => m.toLowerCase())
export const cidadeCurta = (c?: string | null) => (c || '').replace(/\s*\([A-Z]{2}\)\s*$/, '').replace(/\s*[-/]\s*[A-Z]{2}\s*$/, '').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase())
export const numeroOS = (id?: string | null) => String(id || '').replace(/^OS-?/i, '')
/** mistura a cor com o branco do cartão (fundo clarinho / borda) */
export const clarinho = (cor: string, pct: number, base = '#FEFEFE') => `color-mix(in srgb, ${cor} ${pct}%, ${base})`

/* ═══ Busca: sem acento e sem maiúscula, com o trecho achado destacado ═══ */
export const semAcento = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** mesmo técnico? ("DANILO DE SOUZA" × "Danilo de Souza", "José Oliveira" × "JOSE ANTONIO DE OLIVEIRA") — a mesma
 *  regra de lib/push-server.ts (mesmoNome), que lá não pode ser importada no navegador (José, 23/10/2026) */
const semAcentoUp = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
export function mesmoNome(a: unknown, b: unknown) {
  const x = semAcentoUp(a).split(/\s+/).filter((w) => w.length > 2), y = semAcentoUp(b).split(/\s+/).filter((w) => w.length > 2)
  if (!x.length || !y.length) return false
  return x[0] === y[0] && (x[x.length - 1] === y[y.length - 1] || x.every((w) => y.includes(w)) || y.every((w) => x.includes(w)))
}
/** o técnico está neste campo? (o campo pode ter mais de um nome: "A / B", "A e B", "A, B") */
export function tecnicoNoCampo(campo: unknown, nome: string): boolean {
  const c = String(campo ?? '').trim()
  if (!c || !nome) return false
  if (semAcentoUp(c) === semAcentoUp(nome)) return true
  return mesmoNome(c, nome) || c.split(/\s*(?:\/\/|\/|&|,|;|\s+e\s+)\s*/i).some((parte) => mesmoNome(parte, nome))
}

/** "846", "0846", "OS-0846" → "846" (só os dígitos sem zero à esquerda); null se a busca não é número de OS */
export function numeroBuscado(q: string): string | null {
  const m = /^\s*(os[\s-]*)?0*(\d+)\s*$/i.exec(q)
  return m ? m[2] : null
}
/** marca (fundo amarelo-claro) o trecho de `texto` que bate com `termo`, ignorando acento e maiúscula */
export function Realce({ texto, termo }: { texto: string; termo?: string | null }) {
  const t = semAcento(termo || '').trim()
  if (!t || !texto) return <>{texto}</>
  // normaliza letra por letra para o índice achado valer no texto original
  const norm = Array.from(texto).map((c) => semAcento(c).charAt(0) || c)
  const pos = norm.join('').indexOf(t)
  if (pos < 0) return <>{texto}</>
  const letras = Array.from(texto)
  return (
    <>
      {letras.slice(0, pos).join('')}
      <mark style={{ background: '#FEF08A', color: 'inherit', borderRadius: 3, padding: '0 1px' }}>{letras.slice(pos, pos + t.length).join('')}</mark>
      {letras.slice(pos + t.length).join('')}
    </>
  )
}

/** máquina da OS: Projeto + modelo/chassi escritos na descrição (ou em colunas com esse nome) */
export function maquinaDaOS(os: Record<string, unknown>): string {
  const partes: string[] = []
  if (os.Projeto) partes.push(String(os.Projeto))
  for (const [k, v] of Object.entries(os)) if (/modelo|chassi/i.test(k) && typeof v === 'string' && v.trim()) partes.push(v.trim())
  const serv = String(os.Serv_Solicitado || '')
  const mod = /modelo\s*:\s*(.*?)(?=\s*chassi|\s*solicita|\n|$)/i.exec(serv)
  const cha = /chassis?\s*:\s*(.*?)(?=\s*modelo|\s*solicita|\n|$)/i.exec(serv)
  if (mod?.[1]?.trim()) partes.push(mod[1].trim())
  if (cha?.[1]?.trim()) partes.push(cha[1].trim())
  // sem repetir: "JIVO 245" some quando já está dentro de "JIVO 245 TESTE"
  const unicas = [...new Set(partes)]
  return unicas.filter((p, i) => !unicas.some((q, j) => j !== i && q.length > p.length && q.toUpperCase().includes(p.toUpperCase()))).join(' · ')
}
/** OS interna (coluna Servico_Interno) */
export const ehInterna = (os: unknown) => {
  const v = (os as { Servico_Interno?: unknown })?.Servico_Interno
  return v === true || /^(sim|s|true|1)$/i.test(String(v ?? '').trim())
}

/**
 * O que o cliente pediu, limpo: tira "Modelo: … Chassis: … Horimetro: …" e o "Serviço realizado" e fica só o
 * pedido. Vale para o texto cru da OS e para o que já veio meio limpo do feed (José, 22/10/2026: o cartão
 * mostrava "Modelo: JIVO 245 Chassis: TESTE…" no lugar do serviço).
 */
export function pedidoLimpo(texto?: string | null): string {
  let t = String(texto || '').trim()
  if (!t) return ''
  // "Solicitação do cliente:" ou só "Solicitação:" (as duas formas existem nas OS)
  const m = /solicita[çc][ãa]o(?:\s+do\s+cliente)?\s*:\s*([\s\S]*?)(?:servi[çc]o\s+realizado\s*:|$)/i.exec(t)
  if (m && m[1].trim()) t = m[1]
  else t = t.replace(/(modelo|chassis?|hor[ií]metro|projeto)\s*:\s*[^\n:]*?(?=\s+(modelo|chassis?|hor[ií]metro|projeto|solicita)|\n|$)/gi, ' ')
  return t.replace(/servi[çc]o\s+realizado\s*:[\s\S]*$/i, '').replace(/\s+/g, ' ').trim()
}

/* ═══ Cartão da OS (22/10/2026, 2ª versão — José: "tá horrível, melhora esse design") ═══
   Cartão branco e leve: a SITUAÇÃO vai numa etiqueta colorida no topo (bolinha + nome + explicação) e no
   quadradinho do ícone; o cliente aparece inteiro (até 2 linhas); embaixo o pedido do cliente limpo e uma linha
   discreta com cidade · máquina · PPV. Atrasada e resserviço ganham só a borda e um fundo bem clarinho. */
export interface ChipCartao { icon: LucideIcon; texto: string; cor?: string }

export function CartaoSituacao({
  href, sit, numero, cliente, solicitacao, resservicoDe, chips = [], hora, icone, index = 0, destaque, destaqueNumero,
}: {
  /** trecho buscado para destacar no cliente, no pedido e nos chips */
  destaque?: string | null
  /** dígitos buscados para destacar no número da OS */
  destaqueNumero?: string | null
  href: string
  sit: Situacao
  numero: string
  cliente?: string | null
  solicitacao?: string | null
  resservicoDe?: string | null
  chips?: ChipCartao[]
  /** coluna da hora à esquerda (feed do dia); sem ela o cartão ocupa a largura toda */
  hora?: ReactNode
  icone?: LucideIcon
  index?: number
}) {
  const cor = sit.cor
  const Icone = icone || (resservicoDe ? RotateCcw : Tractor)
  const alerta = sit === SITUACAO.atrasada || sit.rot === SITUACAO.atrasada.rot || !!resservicoDe
  const pedido = pedidoLimpo(solicitacao)
  const cartao = (
    <div style={{
      minWidth: 0, display: 'grid', gap: 10, padding: '13px 14px 12px', borderRadius: 16,
      background: alerta ? clarinho(cor, 4) : '#FEFEFE',
      border: `1px solid ${alerta ? clarinho(cor, 35, colors.border) : colors.border}`,
      boxShadow: '0 1px 2px rgba(15,23,42,.04)',
    }}>
      {/* situação + nº da OS */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, fontSize: 12.5, fontWeight: 500,
          padding: '3px 10px 3px 8px', borderRadius: 999, color: cor, background: clarinho(cor, 11),
        }}>
          <i style={{ width: 7, height: 7, borderRadius: '50%', background: cor }} />{sit.rot}
        </span>
        {sit.dica && (
          <small style={{ fontSize: 12, color: colors.textSubtle, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sit.dica}</small>
        )}
        <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 12.5, color: colors.textSubtle, fontVariantNumeric: 'tabular-nums' }}>
          OS <Realce texto={numero} termo={destaqueNumero} />
        </span>
      </div>

      {/* ícone + cliente */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
        <span style={{
          width: 38, height: 38, flexShrink: 0, borderRadius: 11, display: 'grid', placeItems: 'center',
          color: cor, background: clarinho(cor, 11),
        }}>
          <Icone size={18} />
        </span>
        <span style={{
          flex: 1, minWidth: 0, fontSize: 16.5, fontWeight: 500, lineHeight: 1.25, color: colors.text,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word',
        }}>
          <Realce texto={nomeBonito(cliente) || 'Sem cliente'} termo={destaque} />
        </span>
        <ChevronRight size={18} color="#94A3B8" style={{ flexShrink: 0 }} />
      </div>

      {/* o que o cliente pediu */}
      {pedido && (
        <p style={{
          margin: 0, fontSize: 14.5, lineHeight: 1.4, color: '#334155',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word',
        }}>
          <Realce texto={pedido} termo={destaque} />
        </p>
      )}

      {resservicoDe && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: colors.osResservico,
          background: clarinho(colors.osResservico, 9), borderRadius: 9, padding: '5px 9px',
        }}>
          <RotateCcw size={13} /> Resserviço da {resservicoDe}
        </div>
      )}

      {/* cidade · máquina · PPV (discreto) */}
      {chips.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4, minWidth: 0,
          paddingTop: 9, borderTop: `1px solid ${alerta ? clarinho(cor, 18, colors.border) : '#F1F5F9'}`,
        }}>
          {chips.map((c, k) => (
            <span key={k} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: c.cor || colors.textMuted,
              maxWidth: '100%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              <c.icon size={13} style={{ flexShrink: 0, opacity: 0.8 }} /> <Realce texto={c.texto} termo={destaque} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
  return (
    <Link
      href={href}
      className="hb-in"
      style={{
        display: hora ? 'grid' : 'block', gridTemplateColumns: hora ? '46px minmax(0, 1fr)' : undefined, gap: 8,
        textDecoration: 'none', color: 'inherit', minWidth: 0,
        animationDelay: `${Math.min(index * 45, 300)}ms`,
      }}
    >
      {hora && (
        <div style={{ display: 'grid', alignContent: 'start', justifyItems: 'end', paddingTop: 14, lineHeight: 1.2 }}>{hora}</div>
      )}
      {cartao}
    </Link>
  )
}

/* ═══ Card de OS da lista ═══ */
export function OsCard({
  os,
  cidade,
  preenchida,
  index = 0,
  destaque,
}: {
  os: OrdemServico
  cidade?: string
  preenchida: boolean
  index?: number
  /** texto da busca, para destacar o trecho achado */
  destaque?: string
}) {
  const rs = infoResservico(os)
  const solicitacao = rs ? (rs.refazer || rs.motivo) : (pedidoLimpo(os.Serv_Solicitado) || os.Tipo_Servico)
  const maquina = maquinaDaOS(os as unknown as Record<string, unknown>)
  const termoNum = destaque ? numeroBuscado(destaque) : null
  // Atrasada: a previsão de execução já passou e a OS ainda está antes de feita (a lista Abertas já exclui enviadas)
  const prev = os.Previsao_Execucao?.trim?.() || ''
  const atrasou = !!prev && prev.slice(0, 10) < getHoje()
  const base = situacaoOS(os.Status, atrasou, !!rs)
  const sit: Situacao = base === SITUACAO.atrasada
    ? { ...base, dica: `a previsão era ${prev.slice(8, 10)}/${prev.slice(5, 7)}` }
    : base
  const fase = getFaseInfo(os.Status)
  const extra = (os as unknown as { Cidade_Cliente?: string | null; Servico_Oficina?: boolean | null })

  const chips: ChipCartao[] = []
  if (extra.Servico_Oficina) chips.push({ icon: Tractor, texto: 'Oficina' })
  else if (cidade || extra.Cidade_Cliente) chips.push({ icon: MapPin, texto: cidadeCurta(cidade || extra.Cidade_Cliente) })
  if (maquina) chips.push({ icon: Cog, texto: maquina.length > 48 ? maquina.slice(0, 47) + '…' : maquina })
  if (os.ID_PPV) chips.push({ icon: Package, texto: os.ID_PPV })
  if (ehInterna(os)) chips.push({ icon: Building2, texto: 'Interna', cor: colors.primary })
  if (preenchida) chips.push({ icon: CheckCircle2, texto: 'Relatório preenchido', cor: colors.osFeita })
  // a faixa já diz a situação; o chip só completa quando ela esconde a fase (atrasada) ou é "Aguardando outros"
  if (base === SITUACAO.atrasada) chips.push({ icon: Clock, texto: situacaoOS(os.Status, false, false).rot, cor: colors.textMuted })
  else if (os.Status === 'Aguardando outros') chips.push({ icon: Clock, texto: fase.label + ' outros', cor: colors.textMuted })

  return (
    <CartaoSituacao
      href={`/os/${os.Id_Ordem}`}
      sit={sit}
      numero={numeroOS(os.Id_Ordem)}
      cliente={os.Os_Cliente}
      solicitacao={solicitacao}
      resservicoDe={rs?.de || null}
      chips={chips}
      index={index}
      destaque={destaque}
      destaqueNumero={termoNum}
    />
  )
}
