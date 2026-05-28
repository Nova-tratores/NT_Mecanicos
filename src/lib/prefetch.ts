/**
 * Prefetch de dados para funcionamento offline.
 * Carrega tudo que o técnico precisa no IndexedDB quando está online.
 */

import { supabase } from './supabase'
import { offlineSet, offlineGet } from './offlineCache'

const PREFETCH_KEY = 'nt-prefetch-timestamp'
const MIN_INTERVAL = 60_000 // no mínimo 1 min entre prefetches

/** Retorna true se já rodou pelo menos um prefetch com sucesso */
export function hasPrefetchedBefore(): boolean {
  return !!localStorage.getItem(PREFETCH_KEY)
}

export async function prefetchAll(
  nome: string,
  tecnicoNome: string,
  onProgress?: (msg: string) => void,
): Promise<boolean> {
  if (!navigator.onLine) return false
  if (!nome) return false

  // Evitar prefetch muito frequente
  const last = parseInt(localStorage.getItem(PREFETCH_KEY) || '0', 10)
  if (Date.now() - last < MIN_INTERVAL) return true

  console.log('[prefetch] Carregando dados para offline...')
  onProgress?.('Baixando ordens de servico...')

  try {
    // 1. Todas as OS do técnico (ativas)
    const { data: osList } = await supabase
      .from('Ordem_Servico')
      .select('*')
      .not('Status', 'in', '("Concluida","Cancelada","Concluída","cancelada")')
      .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
      .order('Id_Ordem', { ascending: false })

    if (osList && osList.length > 0) {
      await offlineSet('prefetch:os-list', osList)

      // Cache individual de cada OS por ID
      for (const os of osList) {
        await offlineSet(`prefetch:os:${os.Id_Ordem}`, os)
      }

      const ids = osList.map((o: { Id_Ordem: string }) => o.Id_Ordem)
      const cnpjs = [...new Set(osList.map((o: { Cnpj_Cliente: string }) => o.Cnpj_Cliente).filter(Boolean))]

      // 2. OS_Tecnicos para todas as OS
      onProgress?.('Baixando preenchimentos...')
      const { data: tecEntries } = await supabase
        .from('Ordem_Servico_Tecnicos')
        .select('*')
        .in('Ordem_Servico', ids)

      if (tecEntries) {
        for (const entry of tecEntries) {
          await offlineSet(`prefetch:os-tec:${entry.Ordem_Servico}`, entry)
        }
      }

      // 3. Clientes (para cidade)
      let clientesData: { cnpj_cpf: string; cidade: string }[] = []
      if (cnpjs.length > 0) {
        onProgress?.('Baixando clientes...')
        const { data: clientes } = await supabase
          .from('Clientes')
          .select('cnpj_cpf, cidade')
          .in('cnpj_cpf', cnpjs)

        if (clientes) {
          clientesData = clientes as { cnpj_cpf: string; cidade: string }[]
          for (const cli of clientes) {
            await offlineSet(`prefetch:cliente:${cli.cnpj_cpf}`, cli)
          }
        }
      }

      // 4. Agenda do técnico (próximos 30 dias)
      onProgress?.('Baixando agenda...')
      const hoje = new Date().toISOString().split('T')[0]
      const fim = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
      const { data: agenda } = await supabase
        .from('agenda_tecnico')
        .select('*')
        .eq('tecnico_nome', nome)
        .gte('data_agendada', hoje)
        .lte('data_agendada', fim)
        .order('data_agendada')

      if (agenda) {
        await offlineSet('prefetch:agenda', agenda)
        for (const ag of agenda) {
          await offlineSet(`prefetch:agenda:${ag.id_ordem}`, ag)
        }
      }

      // 5. Movimentações PPV para cada OS que tem PPV
      const osComPPV = osList.filter((o: { ID_PPV?: string }) => o.ID_PPV)
      if (osComPPV.length > 0) {
        onProgress?.('Baixando pecas...')
        for (const os of osComPPV) {
          const { data: movs } = await supabase
            .from('movimentacoes')
            .select('*')
            .eq('Id_PPV', os.ID_PPV)

          if (movs) {
            await offlineSet(`prefetch:ppv:${os.ID_PPV}`, movs)
          }
        }
      }

      // ── Salvar dados compostos com as keys do useCached ──
      // Isso garante que páginas nunca visitadas funcionem offline
      const preenchidas = new Set<string>()
      const enviadas = new Set<string>()
      const cidadeMap: Record<string, string> = {}
      const agendaMap: Record<string, string[]> = {}

      if (tecEntries) {
        for (const e of tecEntries) {
          preenchidas.add(String(e.Ordem_Servico))
          if (e.Status === 'enviado') enviadas.add(String(e.Ordem_Servico))
        }
      }
      const FASES_CONCLUIDAS = ['Relatorio Concluido', 'Relatório Concluído', 'Executada aguardando comercial']
      for (const o of osList) {
        if (FASES_CONCLUIDAS.includes(o.Status)) enviadas.add(String(o.Id_Ordem))
      }
      for (const c of clientesData) {
        if (c.cidade) cidadeMap[c.cnpj_cpf] = c.cidade
      }
      if (agenda) {
        for (const a of agenda) {
          if (!agendaMap[a.id_ordem]) agendaMap[a.id_ordem] = []
          agendaMap[a.id_ordem].push(a.data_agendada)
        }
      }

      // Key do useCached na página /os
      await offlineSet(`os:${nome}`, {
        ordens: osList,
        preenchidas: [...preenchidas],
        enviadas: [...enviadas],
        cidadeMap,
        enviadasCount: enviadas.size,
        agendaMap,
      })

      // Key do useCached no dashboard
      const hojeStr = hoje // já declarado acima
      let osPendentes = 0
      let osAbertas = 0
      let osAtrasadas = 0
      for (const o of osList) {
        const id = String(o.Id_Ordem)
        if (enviadas.has(id)) continue
        const prev = (o.Previsao_Execucao || '').trim()
        if (o.Status === 'Aguardando ordem Técnico' && !preenchidas.has(id)) {
          if (prev && prev < hojeStr) {
            const diffDias = Math.floor((new Date(hojeStr + 'T00:00:00').getTime() - new Date(prev + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24))
            if (diffDias > 1) { osAtrasadas++; continue }
          }
          osPendentes++
        } else {
          osAbertas++
        }
      }

      await offlineSet(`dashboard:${nome}`, {
        osPendentes,
        osAbertas,
        osEnviadas: enviadas.size,
        osAtrasadas,
        reqPendentes: 0,
        reqEnviadas: 0,
        fotosCount: 0,
        garantiasPendentes: 0,
        garantiasAbertas: 0,
        avisos: [],
        avisosHistorico: [],
      })
    }

    // 6. Dados de referência (globais)
    onProgress?.('Baixando dados de referencia...')
    const [{ data: tecnicos }, { data: veiculos }] = await Promise.all([
      supabase.from('Tecnicos_Appsheet').select('UsuNome').order('UsuNome'),
      supabase.from('SupaPlacas').select('IdPlaca, NumPlaca').order('NumPlaca'),
    ])

    if (tecnicos) await offlineSet('prefetch:tecnicos', tecnicos)
    if (veiculos) await offlineSet('prefetch:veiculos', veiculos)

    // 7. OS enviadas do técnico
    onProgress?.('Baixando OS enviadas...')
    const { data: osEnviadas } = await supabase
      .from('Ordem_Servico_Tecnicos')
      .select('*')
      .or(`TecResp1.ilike.%${nome}%,TecResp2.ilike.%${nome}%`)
      .in('Status', ['enviado', 'rascunho'])
      .order('Data', { ascending: false })

    if (osEnviadas) {
      await offlineSet('prefetch:os-enviadas', osEnviadas)
    }

    // 8. Pré-aquecer cache do SW com páginas-chave (HTML + JS chunks)
    // Isso garante que navegação offline funcione sem depender do app shell fallback
    onProgress?.('Preparando paginas offline...')
    const rotasParaCachear = ['/os', '/dashboard']
    await Promise.allSettled(rotasParaCachear.map(r => fetch(r)))

    localStorage.setItem(PREFETCH_KEY, String(Date.now()))
    console.log('[prefetch] Dados offline carregados com sucesso')
    onProgress?.('')
    return true
  } catch (err) {
    console.warn('[prefetch] Erro (parcial ok):', err)
    onProgress?.('')
    return false
  }
}

// Helpers para ler dados cacheados offline
export async function getCachedOSList() {
  return offlineGet<Record<string, unknown>[]>('prefetch:os-list')
}

export async function getCachedOS(id: string) {
  return offlineGet<Record<string, unknown>>(`prefetch:os:${id}`)
}

export async function getCachedOSTec(idOrdem: string) {
  return offlineGet<Record<string, unknown>>(`prefetch:os-tec:${idOrdem}`)
}

export async function getCachedCliente(cnpj: string) {
  return offlineGet<{ cnpj_cpf: string; cidade: string }>(`prefetch:cliente:${cnpj}`)
}

export async function getCachedTecnicos() {
  return offlineGet<{ UsuNome: string }[]>('prefetch:tecnicos')
}

export async function getCachedVeiculos() {
  return offlineGet<{ IdPlaca: number; NumPlaca: string }[]>('prefetch:veiculos')
}

export async function getCachedPPV(idPPV: string) {
  return offlineGet<Record<string, unknown>[]>(`prefetch:ppv:${idPPV}`)
}
