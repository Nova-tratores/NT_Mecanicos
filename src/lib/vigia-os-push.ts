// Vigia das OS dos técnicos (José, 22/10/2026: "os técnicos esquecem de abrir o celular na loja… precisamos de uma
// forma que não dependa do técnico para carregar essas ordens"). O push faz o celular BAIXAR as OS sozinho, com o
// app fechado (o service worker roda o backgroundPrefetch quando o push chega — public/sw.js).
//  - a cada 5 min: OS nova ou alterada (POS ou Lousa) de um técnico inscrito → push só para ele;
//  - 6h30 de segunda a sábado: "Suas ordens de hoje estão no celular" para todos os inscritos.
// A 1ª rodada depois de ligar o servidor só anota como está (não avisa nada).
import { enviarPush, inscricoes, mesmoNome, nomesInscritos, sem, supabaseServidor, type Inscricao } from './push-server'

// cada celular recebe pela grafia exata com que se inscreveu (sem repetir com outra grafia do mesmo nome) — José, 23/10/2026
const doNome = (subs: Inscricao[], n: string) => subs.filter((s) => sem(s.tecnico_nome) === sem(n))

type Rec = Record<string, unknown>
// só as fases em que a OS é do técnico (depois do relatório — garantia, Omie, cobrança — não avisa)
const DO_TECNICO = /^(aguardando ordem|execu)/i
const assinatura = (o: Rec) => [o.Status, o.Dias_Execucao, o.Previsao_Execucao, o.Os_Tecnico, o.Os_Tecnico2, o.Serv_Solicitado, o.Projeto, o.ID_PPV].map((x) => String(x ?? '')).join('|')
const numOS = (id: unknown) => String(id || '').replace(/^OS-0*/, '')

let fotografia: Map<string, Map<string, string>> | null = null // técnico → (OS → assinatura)
let manhaEnviada = ''

async function osAbertas(): Promise<Rec[]> {
  const { data } = await supabaseServidor().from('Ordem_Servico')
    .select('Id_Ordem, Status, Os_Cliente, Os_Tecnico, Os_Tecnico2, Dias_Execucao, Previsao_Execucao, Serv_Solicitado, Projeto, ID_PPV')
    .not('Status', 'in', '("Concluída","Concluida","Cancelada","cancelada")').order('Id_Ordem', { ascending: false }).limit(800)
  return ((data || []) as Rec[]).filter((o) => DO_TECNICO.test(String(o.Status || '')))
}

/** uma rodada do vigia; devolve o resumo (para o log) */
export async function vigiarOS(): Promise<string> {
  const [subs, lista] = await Promise.all([inscricoes(), osAbertas()])
  const nomes = nomesInscritos(subs)
  const agora = new Map<string, Map<string, string>>()
  for (const n of nomes) {
    const m = new Map<string, string>()
    for (const o of lista) if (mesmoNome(o.Os_Tecnico, n) || mesmoNome(o.Os_Tecnico2, n)) m.set(String(o.Id_Ordem), assinatura(o))
    agora.set(sem(n), m)
  }
  const antes = fotografia
  fotografia = agora
  if (!antes) return `vigia OS: começou (${nomes.length} técnicos com push)`

  let enviados = 0
  for (const n of nomes) {
    const a = antes.get(sem(n)), d = agora.get(sem(n))
    if (!d) continue
    const novas: string[] = [], mudaram: string[] = []
    for (const [id, ass] of d) {
      const velho = a?.get(id)
      if (velho == null) novas.push(id); else if (velho !== ass) mudaram.push(id)
    }
    if (!novas.length && !mudaram.length) continue
    const os = (id: string) => lista.find((o) => String(o.Id_Ordem) === id)
    let titulo: string, corpo: string
    if (novas.length + mudaram.length === 1) {
      const id = novas[0] || mudaram[0]
      titulo = `${novas.length ? 'Nova OS' : 'OS'} ${numOS(id)}${novas.length ? '' : ' mudou'}`
      corpo = `${String(os(id)?.Os_Cliente || '').trim()} · já está no celular para usar sem internet`
    } else {
      titulo = [novas.length ? `${novas.length} OS nova${novas.length > 1 ? 's' : ''}` : '', mudaram.length ? `${mudaram.length} alterada${mudaram.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' e ')
      corpo = `${[...novas, ...mudaram].map(numOS).join(', ')} · já estão no celular para usar sem internet`
    }
    enviados += await enviarPush(doNome(subs, n), { titulo, corpo, url: novas.length + mudaram.length === 1 ? `/os/${novas[0] || mudaram[0]}` : '/os' })
  }
  return enviados ? `vigia OS: ${enviados} push(es) de OS nova/alterada` : ''
}

/** "bom dia" uma vez por dia mesmo com o servidor reiniciando ou 2 instâncias (José, 23/10/2026): grava a chave do
 *  dia em robos_execucoes (sql/robos-execucoes.sql); quem gravar primeiro manda, a outra cópia toma 23505 e não manda.
 *  Sem a tabela (SQL ainda não rodado) ou com erro no banco, cai no controle só em memória, como era. */
async function reservarManha(dia: string): Promise<boolean> {
  const { error } = await supabaseServidor().from('robos_execucoes').insert({ chave: `bom-dia:${dia}` })
  if (!error) return true
  if (error.code === '23505') return false
  if (error.code !== 'PGRST205' && error.code !== '42P01') console.warn('[push] robos_execucoes:', error.message)
  return true
}

/** 6h30 de segunda a sábado (horário de Brasília), uma vez por dia */
export async function pushDaManha(agoraMs = Date.now()): Promise<string> {
  const sp = new Date(agoraMs - 3 * 3600_000) // Brasília, UTC−3
  const dia = sp.toISOString().slice(0, 10)
  const min = sp.getUTCHours() * 60 + sp.getUTCMinutes()
  if (sp.getUTCDay() === 0 || min < 6 * 60 + 30 || min > 7 * 60 + 30 || manhaEnviada === dia) return ''
  manhaEnviada = dia
  if (!(await reservarManha(dia))) return ''
  const [subs, lista] = await Promise.all([inscricoes(), osAbertas()])
  let enviados = 0
  for (const n of nomesInscritos(subs)) {
    const minhas = lista.filter((o) => mesmoNome(o.Os_Tecnico, n) || mesmoNome(o.Os_Tecnico2, n)).length
    enviados += await enviarPush(doNome(subs, n), {
      titulo: 'Bom dia! Suas ordens estão no celular',
      corpo: minhas ? `${minhas} OS para fazer, baixadas para usar sem internet.` : 'Nenhuma OS para fazer agora.',
      url: '/',
    })
  }
  return `push da manhã: ${enviados} celular(es)`
}
