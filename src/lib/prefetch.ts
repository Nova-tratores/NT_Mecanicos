/**
 * Prefetch de dados para funcionamento offline.
 * Carrega tudo que o técnico precisa no IndexedDB quando está online.
 */

import { supabase } from './supabase'
import { offlineSet, offlineGet } from './offlineCache'

const PREFETCH_KEY = 'nt-prefetch-timestamp'
const MIN_INTERVAL = 15 * 60_000 // 15 min entre prefetches

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

      // 3. Clientes (cidade + coordenadas + nome — necessario p/ jornada/check-in offline)
      let clientesData: { cnpj_cpf: string; cidade: string }[] = []
      if (cnpjs.length > 0) {
        onProgress?.('Baixando clientes...')
        const { data: clientes } = await supabase
          .from('Clientes')
          .select('cnpj_cpf, nome, cidade, latitude, longitude')
          .in('cnpj_cpf', cnpjs)

        if (clientes) {
          clientesData = clientes as { cnpj_cpf: string; cidade: string }[]
          // Mapa nome -> coordenadas, usado pelo check-in/jornada (que buscam por nome)
          const coordsPorNome: Record<string, { lat: number; lng: number }> = {}
          for (const cli of clientes as { cnpj_cpf: string; nome?: string; cidade: string; latitude?: number; longitude?: number }[]) {
            await offlineSet(`prefetch:cliente:${cli.cnpj_cpf}`, cli)
            if (cli.nome && cli.latitude && cli.longitude) {
              coordsPorNome[cli.nome] = { lat: cli.latitude, lng: cli.longitude }
            }
          }
          await offlineSet('prefetch:clientes-coords', coordsPorNome)
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

      // Key do useCached na página /os (a tela usa a versao "v2")
      await offlineSet(`os:v2:${nome}`, {
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

      // Contadores reais para o dashboard funcionar offline (antes salvava zeros)
      onProgress?.('Baixando avisos e garantias...')
      const [reqPendRes, reqEnvRes, avisosRes, garPendRes, garAbertasRes] = await Promise.all([
        supabase.from('Requisicao').select('id', { count: 'exact', head: true })
          .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
          .eq('status', 'pedido').is('recibo_fornecedor', null),
        supabase.from('Requisicao').select('id', { count: 'exact', head: true })
          .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
          .in('status', ['pedido', 'completa', 'aguardando']),
        supabase.from('avisos_gerais').select('id, titulo, mensagem, prioridade, created_at')
          .eq('ativo', true).or(`expira_em.is.null,expira_em.gte.${hoje}`)
          .order('created_at', { ascending: false }).limit(5),
        tecnicoNome
          ? supabase.from('garantias').select('id', { count: 'exact', head: true })
            .eq('tecnico_nome', tecnicoNome).in('status', ['bo_tecnico', 'info_pendente'])
          : Promise.resolve({ count: 0 }),
        tecnicoNome
          ? supabase.from('garantias').select('id', { count: 'exact', head: true })
            .eq('tecnico_nome', tecnicoNome).not('status', 'in', '("aprovada","rejeitada")')
          : Promise.resolve({ count: 0 }),
      ])

      // Filtrar avisos ja confirmados pelo tecnico (mesma logica da home)
      const todosAvisos = (avisosRes.data || []) as { id: number; created_at: string }[]
      let avisosFiltrados = todosAvisos
      let avisosHistorico: typeof todosAvisos = []
      if (todosAvisos.length > 0 && tecnicoNome) {
        const { data: confirmados } = await supabase
          .from('avisos_gerais_confirmados')
          .select('aviso_id')
          .eq('tecnico_nome', tecnicoNome)
          .in('aviso_id', todosAvisos.map(a => a.id))
        const confirmSet = new Set((confirmados || []).map((c: { aviso_id: number }) => c.aviso_id))
        avisosFiltrados = todosAvisos.filter(a => !confirmSet.has(a.id))
        avisosHistorico = todosAvisos.filter(a => confirmSet.has(a.id))
      }

      await offlineSet(`dashboard:${nome}`, {
        osPendentes,
        osAbertas,
        osEnviadas: enviadas.size,
        osAtrasadas,
        reqPendentes: reqPendRes.count || 0,
        reqEnviadas: reqEnvRes.count || 0,
        fotosCount: 0,
        garantiasPendentes: garPendRes.count || 0,
        garantiasAbertas: garAbertasRes.count || 0,
        avisos: avisosFiltrados,
        avisosHistorico,
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

    // 6b. Check-in de hoje, garantias, requisicoes e fornecedores (telas offline)
    onProgress?.('Baixando jornada e requisicoes...')
    const hojeRef = new Date().toISOString().split('T')[0]
    const [checkinsRes, garantiasRes, requisicoesRes, fornecedoresRes] = await Promise.all([
      supabase.from('checkin_diario').select('*').eq('tecnico_nome', tecnicoNome).eq('data', hojeRef).order('id'),
      tecnicoNome
        ? supabase.from('garantias').select('*').eq('tecnico_nome', tecnicoNome).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from('Requisicao').select('*')
        .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
        .order('data', { ascending: false }).limit(300),
      supabase.from('Fornecedores').select('*').order('nome').then(r => r, () => ({ data: [] })),
    ])
    await offlineSet(`prefetch:checkin:${hojeRef}`, checkinsRes.data || [])
    await offlineSet('prefetch:garantias', garantiasRes.data || [])
    await offlineSet('prefetch:requisicoes', requisicoesRes.data || [])
    await offlineSet('prefetch:fornecedores', fornecedoresRes.data || [])

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

    // 8. Pré-aquecer cache do SW com TODAS as páginas (HTML + JS chunks)
    onProgress?.('Preparando paginas offline...')
    const rotasEstaticas = [
      '/', '/os', '/os-enviadas', '/requisicoes', '/requisicoes/nova',
      '/relatorios', '/perfil', '/fotos', '/jornada', '/garantias', '/mapa',
    ]
    // Cachear uma OS e preencher para garantir que os JS chunks dessas rotas dinâmicas fiquem no SW
    const primeiraOs = osList?.[0]?.Id_Ordem
    if (primeiraOs) {
      rotasEstaticas.push(`/os/${primeiraOs}`, `/os/${primeiraOs}/preencher`)
    }
    await Promise.allSettled(rotasEstaticas.map(r => fetch(r).catch(() => {})))

    // Cachear RSC payloads para TODAS as OS + preencher (navegação client-side offline)
    if (osList && osList.length > 0) {
      const rscHeaders = { RSC: '1', 'Next-Router-Prefetch': '1' }
      const rscFetches = osList.slice(0, 40).flatMap((os: { Id_Ordem: string }) => [
        fetch(`/os/${os.Id_Ordem}`, { headers: rscHeaders }).catch(() => {}),
        fetch(`/os/${os.Id_Ordem}/preencher`, { headers: rscHeaders }).catch(() => {}),
      ])
      await Promise.allSettled(rscFetches)
    }

    // Salvar config para o SW fazer background sync sem o app aberto
    await offlineSet('sw-config', {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      tecnicoNome: nome,
      tecnicoNomeReal: tecnicoNome,
    })

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

export async function getCachedCheckin(data: string) {
  return offlineGet<Record<string, unknown>[]>(`prefetch:checkin:${data}`)
}

export async function getCachedGarantias() {
  return offlineGet<Record<string, unknown>[]>('prefetch:garantias')
}

export async function getCachedRequisicoes() {
  return offlineGet<Record<string, unknown>[]>('prefetch:requisicoes')
}

export async function getCachedFornecedores() {
  return offlineGet<Record<string, unknown>[]>('prefetch:fornecedores')
}

export async function getCachedClientesCoords() {
  return offlineGet<Record<string, { lat: number; lng: number }>>('prefetch:clientes-coords')
}
