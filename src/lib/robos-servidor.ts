// Tarefas que rodavam no celular a cada abertura do app e passaram para o servidor (José, 23/10/2026):
// com 2 aparelhos abrindo juntos saíam ocorrências −3/−5 e avisos em dobro. Agora rodam no laço de 5 min do
// instrumentation.ts, com trava em memória (uma rodada por vez) e conferência no banco antes de gravar
// (+ índice único em sql/robos-servidor-dedupe.sql, que barra a 2ª cópia se duas instâncias gravarem juntas).
//  - escalarOpas: Opa aberto há 1 dia útil → −3 para cada técnico; 2 dias úteis → −5.
//    Dia útil = segunda a sexta: o Opa é resolvido pelo escritório, que não abre no sábado (antes contava dia
//    corrido e punia o fim de semana). Também precisa ter passado 24h por dia, como era antes.
//  - avisarOsNovas: sino "Nova OS" para os técnicos da OS aberta desde ontem. O push dessa OS já sai pelo vigia
//    (vigia-os-push.ts), então aqui não manda push — só a notificação do sino.
import { enviarPush, inscricoes, mesmoNome, supabaseServidor } from './push-server'

type Rec = Record<string, unknown>
const DUPLICADO = '23505'
const OS_TESTE = /-T\d+$/i // OS-0000-T1/T2/T3: nunca gravar nada ligado a elas

const diaSP = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ms))

/** dias úteis (seg–sex) depois do dia em que foi criado, até hoje (horário de Brasília) */
export function diasUteisDesde(criadoMs: number, agoraMs = Date.now()): number {
  const ini = diaSP(criadoMs), fim = diaSP(agoraMs)
  let n = 0
  const d = new Date(ini + 'T12:00:00Z')
  for (let i = 0; i < 400; i++) {
    d.setUTCDate(d.getUTCDate() + 1)
    const s = d.toISOString().slice(0, 10)
    if (s > fim) break
    const dow = d.getUTCDay()
    if (dow >= 1 && dow <= 5) n++
  }
  return n
}

/** insere as linhas; se o índice único barrar alguma, grava as outras uma a uma e ignora a repetida */
async function inserirSemRepetir(tabela: string, rows: Rec[]): Promise<number> {
  if (!rows.length) return 0
  const sb = supabaseServidor()
  const { error } = await sb.from(tabela).insert(rows)
  if (!error) return rows.length
  if (error.code !== DUPLICADO) throw new Error(`${tabela}: ${error.message}`)
  let ok = 0
  for (const r of rows) {
    const { error: e } = await sb.from(tabela).insert(r)
    if (!e) ok++
    else if (e.code !== DUPLICADO) throw new Error(`${tabela}: ${e.message}`)
  }
  return ok
}

/** técnicos de verdade (José, 23/10/2026): mecanico_usuarios.ativo só tinha o "Jose Ortiz" (admin). Agora vem do
 *  portal_permissoes (mecanico_role='tecnico' com mecanico_tecnico_nome), tirando quem está inativo no
 *  financeiro_usu e o usuário de teste. O nome gravado é o mecanico_tecnico_nome (o mesmo do login do app). */
export async function tecnicosAtivos(): Promise<string[]> {
  const sb = supabaseServidor()
  const { data: perms, error } = await sb.from('portal_permissoes').select('user_id, mecanico_tecnico_nome')
    .eq('mecanico_role', 'tecnico').not('mecanico_tecnico_nome', 'is', null)
  if (error) throw new Error(`portal_permissoes: ${error.message}`)
  const lista = (perms || []) as Rec[]
  const ids = lista.map((p) => String(p.user_id || '')).filter(Boolean)
  const { data: fu } = ids.length ? await sb.from('financeiro_usu').select('id, ativo').in('id', ids) : { data: [] }
  const inativos = new Set(((fu || []) as Rec[]).filter((u) => u.ativo === false).map((u) => String(u.id)))
  const nomes = lista.filter((p) => !inativos.has(String(p.user_id)))
    .map((p) => String(p.mecanico_tecnico_nome || '').trim())
    .filter((n) => n && !/\bteste\b/i.test(n))
  return [...new Set(nomes)]
}

let rodandoOpa = false
export async function escalarOpas(agoraMs = Date.now()): Promise<string> {
  if (rodandoOpa) return ''
  rodandoOpa = true
  try {
    const sb = supabaseServidor()
    const { data: opas } = await sb.from('portal_opas').select('id, titulo, descricao, created_at').eq('status', 'aberto')
    if (!opas?.length) return ''
    const nomes = await tecnicosAtivos()
    if (!nomes.length) return ''

    let criadas = 0
    for (const opa of opas) {
      const criadoMs = new Date(opa.created_at).getTime()
      const uteis = diasUteisDesde(criadoMs, agoraMs)
      const horas = (agoraMs - criadoMs) / 3600_000
      for (const dia of [1, 2]) {
        if (uteis < dia || horas < 24 * dia) continue
        const tipo = `opa_dia${dia}`
        // já escalou este Opa neste dia? (como antes: uma vez por Opa, para todos os técnicos)
        const { data: ja } = await sb.from('mecanico_ocorrencias').select('id').eq('tipo', tipo).eq('id_ordem', opa.id).limit(1)
        if (ja?.length) continue
        const faltam = nomes
        const hoje = diaSP(agoraMs)
        const n = await inserirSemRepetir('mecanico_ocorrencias', faltam.map((nome) => ({
          tecnico_nome: nome,
          tipo,
          descricao: `OPA "${opa.titulo}" não resolvida há ${dia} dia(s) útil(eis).\n${opa.descricao || ''}`.trim(),
          pontos: dia === 1 ? -3 : -5,
          data_referencia: hoje,
          id_ordem: opa.id,
          admin_nome: 'Sistema',
        })))
        if (!n) continue
        criadas += n
        const aviso = { titulo: 'Ocorrência: OPA não resolvida', descricao: `"${opa.titulo}" - ${dia} dia(s) útil(eis) sem resolução` }
        await sb.from('mecanico_notificacoes').insert(faltam.map((nome) => ({
          tecnico_nome: nome, tipo: 'ocorrencia', titulo: aviso.titulo, descricao: aviso.descricao, link: '/opa', lida: false,
        })))
        await enviarPush(await inscricoes(), { titulo: aviso.titulo, corpo: aviso.descricao, url: '/opa', baixar: false })
      }
    }
    return criadas ? `opa: ${criadas} ocorrência(s) de Opa sem resolver` : ''
  } finally {
    rodandoOpa = false
  }
}

let rodandoOs = false
export async function avisarOsNovas(agoraMs = Date.now()): Promise<string> {
  if (rodandoOs) return ''
  rodandoOs = true
  try {
    const sb = supabaseServidor()
    const ontem = diaSP(agoraMs - 24 * 3600_000)
    const { data: recentes } = await sb.from('Ordem_Servico')
      .select('Id_Ordem, Os_Tecnico, Os_Tecnico2, Os_Cliente')
      .gte('Data', ontem)
      .not('Status', 'in', '("Concluída","Cancelada","Concluida","cancelada")')
      .order('Id_Ordem', { ascending: false })
      .limit(50)
    const lista = ((recentes || []) as Rec[]).filter((o) => !OS_TESTE.test(String(o.Id_Ordem || '')))
    if (!lista.length) return ''

    const links = lista.map((o) => `/os/${o.Id_Ordem}`)
    const { data: existentes } = await sb.from('mecanico_notificacoes').select('tecnico_nome, link').eq('tipo', 'nova_os').in('link', links)
    const ja = (existentes || []) as Rec[]

    const rows: Rec[] = []
    for (const os of lista) {
      const link = `/os/${os.Id_Ordem}`
      for (const tec of [os.Os_Tecnico, os.Os_Tecnico2].map((t) => String(t || '').trim()).filter(Boolean)) {
        // "DANILO DE SOUZA" e "Danilo de Souza" são a mesma pessoa: não repete o aviso
        if (ja.some((n) => n.link === link && mesmoNome(n.tecnico_nome, tec))) continue
        if (rows.some((r) => r.link === link && mesmoNome(r.tecnico_nome, tec))) continue
        rows.push({ tecnico_nome: tec, tipo: 'nova_os', titulo: `Nova OS #${os.Id_Ordem}`, descricao: `Cliente: ${os.Os_Cliente || 'Cliente'}`, link, lida: false })
      }
    }
    const n = await inserirSemRepetir('mecanico_notificacoes', rows)
    return n ? `os: ${n} aviso(s) de OS nova no sino` : ''
  } finally {
    rodandoOs = false
  }
}
