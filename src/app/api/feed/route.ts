// FEED DO TÉCNICO (José, 22/10/2026) — a versão de verdade do /api/teste-feed, usada na tela inicial.
// GET /api/feed?de=YYYY-MM-DD com o header "Authorization: Bearer <access token do Supabase>".
// O nome do técnico SEMPRE vem do banco pelo usuário do token (portal_permissoes.mecanico_tecnico_nome; se vazio,
// financeiro_usu.nome ou o cadastro legado mecanico_usuarios) — nunca de parâmetro da tela.
// Devolve a semana dele como na Lousa do portal: OS com dia marcado (Dias_Execucao / Previsao_Execucao) +
// lançamentos da Lousa (folga, reunião, feriado…) + pendentes + resserviços + quem da equipe está fora.
import { NextRequest, NextResponse } from 'next/server'
import { exigirUsuario, supabaseAdmin } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'
type Rec = Record<string, unknown>

const sem = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const DIA = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?)?/
const addDias = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
/** mesmo nome? ("DANILO DE SOUZA" × "Danilo de Souza", "José Oliveira" × "JOSE ANTONIO DE OLIVEIRA") */
function mesmo(a: unknown, b: unknown) {
  const x = sem(a).split(/\s+/).filter((w) => w.length > 2), y = sem(b).split(/\s+/).filter((w) => w.length > 2)
  if (!x.length || !y.length) return false
  return x[0] === y[0] && (x[x.length - 1] === y[y.length - 1] || x.every((w) => y.includes(w)) || y.every((w) => x.includes(w)))
}
function solicitacao(t: unknown) {
  const s = String(t || '')
  if (/^RESSERVI/i.test(s)) return (s.split('\n').find((l) => /^O que precisa refazer:/i.test(l)) || '').replace(/^O que precisa refazer:\s*/i, '')
  const m = /solicita[cç][aã]o do cliente:[ \t]*([\s\S]*?)(?:\n\s*servi[cç]o realizado:|$)/i.exec(s)
  return (m ? m[1] : s).replace(/\s+/g, ' ').trim().slice(0, 160)
}

export async function GET(req: NextRequest) {
  // login pelo apiAuth: barra usuário inativo (financeiro_usu.ativo=false); o nome segue a mesma regra (José, 23/10/2026)
  const usu = await exigirUsuario(req); if (usu instanceof NextResponse) return usu
  const sb = supabaseAdmin()
  const tecnico = usu.nome
  if (!tecnico) return NextResponse.json({ error: 'técnico não encontrado' }, { status: 404 })

  const sp = req.nextUrl.searchParams
  const hoje = hojeSP()
  // semana começando na segunda
  const base = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('de') || '') ? sp.get('de')! : hoje
  const dow = new Date(base + 'T12:00:00Z').getUTCDay()
  // No domingo a semana "atual" é a que começa amanhã (antes abria a que passou) (José, 23/10/2026)
  const de = addDias(base, dow === 0 ? 1 : 1 - dow), ate = addDias(de, 5)

  const cols = 'Id_Ordem, Status, Os_Cliente, Cidade_Cliente, Os_Tecnico, Os_Tecnico2, Serv_Solicitado, Tipo_Servico, Projeto, Previsao_Execucao, Dias_Execucao, Servico_Oficina, Hora_Inicio_Exec, ID_PPV, resservico_de, lousa_pendente'
  // só letras no filtro (o nome vai dentro do .or do PostgREST)
  const primeiro = (sem(tecnico).split(/\s+/)[0] || '').replace(/[^A-Z]/g, '') || '_'
  const filtro = `Os_Tecnico.ilike.%${primeiro}%,Os_Tecnico2.ilike.%${primeiro}%`
  let r: { data: unknown; error: unknown } = await sb.from('Ordem_Servico').select(cols).or(filtro).not('Status', 'in', '("Cancelada","cancelada")').order('Id_Ordem', { ascending: false }).limit(400)
  if (r.error) r = await sb.from('Ordem_Servico').select(cols.replace(', resservico_de, lousa_pendente', '')).or(filtro).not('Status', 'in', '("Cancelada","cancelada")').order('Id_Ordem', { ascending: false }).limit(400)
  const minhas = ((r.data || []) as unknown as Rec[]).filter((o) => mesmo(o.Os_Tecnico, tecnico) || mesmo(o.Os_Tecnico2, tecnico))

  const itens: Rec[] = []
  const pendentes: Rec[] = []
  for (const o of minhas) {
    const card = {
      fonte: 'os', id: o.Id_Ordem, status: o.Status, cliente: o.Os_Cliente, cidade: o.Cidade_Cliente || null,
      solicitacao: solicitacao(o.Serv_Solicitado), tipo: o.Tipo_Servico, projeto: o.Projeto, oficina: !!o.Servico_Oficina,
      ppv: o.ID_PPV || null, resservicoDe: o.resservico_de || null,
      junto: [o.Os_Tecnico, o.Os_Tecnico2].filter((t) => t && !mesmo(t, tecnico)).join(', ') || null,
    }
    if (o.lousa_pendente && !/conclu/i.test(String(o.Status))) { pendentes.push(card); continue }
    const dias = String(o.Dias_Execucao || '').split(',').map((s) => DIA.exec(s.trim())).filter(Boolean) as RegExpExecArray[]
    const lista = dias.length ? dias.map((m) => ({ dia: m[1], hora: m[2] || null, ate: m[3] || null }))
      : o.Previsao_Execucao ? [{ dia: String(o.Previsao_Execucao).slice(0, 10), hora: (o.Hora_Inicio_Exec as string) || null, ate: null }] : []
    for (const d of lista) if (d.dia >= de && d.dia <= ate) itens.push({ ...card, dia: d.dia, hora: d.hora || (o.Hora_Inicio_Exec as string) || null, horaFim: d.ate })
  }

  const lz = await sb.from('lousa_servicos').select('id, data, tipo, tecnico_nome, tecnico_acompanhante, periodo, descricao, cliente_nome').gte('data', de).lte('data', ate)
  const equipe: Rec[] = []
  for (const l of (lz.data || []) as Rec[]) {
    const meu = mesmo(l.tecnico_nome, tecnico) || mesmo(l.tecnico_acompanhante, tecnico)
    const todos = !l.tecnico_nome
    if (meu || todos) itens.push({ fonte: 'lousa', id: l.id, dia: l.data, tipo: l.tipo, periodo: l.periodo, descricao: l.descricao, cliente: l.cliente_nome, todos })
    else if (l.tipo !== 'servico') equipe.push({ dia: l.data, tipo: l.tipo, quem: l.tecnico_nome, descricao: l.descricao })
  }
  itens.sort((a, b) => String(a.dia).localeCompare(String(b.dia)) || String(a.hora || '99').localeCompare(String(b.hora || '99')))
  return NextResponse.json({ tecnico, de, ate, hoje, itens, pendentes, equipe }, { headers: { 'Cache-Control': 'no-store' } })
}
