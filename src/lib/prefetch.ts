/**
 * Prefetch de dados para funcionamento offline.
 * Carrega tudo que o técnico precisa no IndexedDB quando está online.
 */

import { supabase } from './supabase'
import { offlineSet, offlineGet, offlineKeys, offlineDelete } from './offlineCache'
import { hojeBR } from './hoje'
import { melhorRelatorio } from './diasRelatorio'
import { tecnicoNoCampo } from '@/components/OsCardTecnico'

/** 1º nome para o ilike, com as vogais (e letras acentuadas) trocadas por '_': o ilike não ignora acento
 *  ("Jose" × "José"). A consulta traz um pouco a mais; o filtro fino é o tecnicoNoCampo/mesmoNome — a mesma
 *  regra da tela /os (José, 23/10/2026) */
export function primeiroNomeIlike(nome: string): string {
  const p1 = nome.replace(/[,()%*_]/g, ' ').replace(/\s+/g, ' ').trim().split(' ')[0] || ''
  return p1.replace(/[aeiouyçÀ-ÿ]/gi, '_') || '_'
}

/** OS que saíram da lista (concluídas/canceladas) não ficam para sempre no aparelho (José, 23/10/2026) */
// Pelo openDB do offlineCache (indexedDB.open sem versão criava banco vazio v1 e quebrava o cache).
async function apagarOsQueSairam(atuais: Set<string>): Promise<void> {
  for (const k of await offlineKeys()) {
    const m = /^prefetch:os(?:-tec)?:(.+)$/.exec(k)
    if (m && !atuais.has(m[1])) await offlineDelete(k)
  }
}

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
    // 1. Todas as OS do técnico (ativas) — busca ampla pelo 1º nome + filtro fino, igual à tela /os; com o
    //    nome completo a lista daqui era menor e apagava do aparelho OS que a tela mostra (José, 23/10/2026)
    const p1 = primeiroNomeIlike(nome)
    const { data: osBruta } = await supabase
      .from('Ordem_Servico')
      .select('*')
      .not('Status', 'in', '("Concluida","Cancelada","Concluída","cancelada")')
      .or(`Os_Tecnico.ilike.%${p1}%,Os_Tecnico2.ilike.%${p1}%`)
      .order('Id_Ordem', { ascending: false })
    const osList = osBruta
      ? (osBruta as { Os_Tecnico?: unknown; Os_Tecnico2?: unknown }[]).filter((o) => tecnicoNoCampo(o.Os_Tecnico, nome) || tecnicoNoCampo(o.Os_Tecnico2, nome)) as typeof osBruta
      : osBruta

    if (osList && osList.length > 0) {
      await offlineSet('prefetch:os-list', osList)

      // Cache individual de cada OS por ID (em paralelo)
      await Promise.all(osList.map((os) => offlineSet(`prefetch:os:${os.Id_Ordem}`, os)))
      await apagarOsQueSairam(new Set(osList.map((o: { Id_Ordem: string }) => String(o.Id_Ordem))))

      const ids = osList.map((o: { Id_Ordem: string }) => o.Id_Ordem)
      const cnpjs = [...new Set(osList.map((o: { Cnpj_Cliente: string }) => o.Cnpj_Cliente).filter(Boolean))]

      // 2. OS_Tecnicos para todas as OS
      onProgress?.('Baixando preenchimentos...')
      const { data: tecEntries } = await supabase
        .from('Ordem_Servico_Tecnicos')
        .select('*')
        .in('Ordem_Servico', ids)

      if (tecEntries) {
        // OS com mais de um relatório: guarda o melhor (enviado, mais novo) (José, 23/10/2026)
        const porOS = new Map<string, Record<string, unknown>[]>()
        for (const e of tecEntries as Record<string, unknown>[]) { const k = String(e.Ordem_Servico); porOS.set(k, [...(porOS.get(k) || []), e]) }
        await Promise.all([...porOS.entries()].map(([k, rows]) => offlineSet(`prefetch:os-tec:${k}`, melhorRelatorio(rows))))
      }

      // 3. Clientes (cidade + coordenadas + nome — necessario p/ jornada/check-in offline)
      let clientesData: { cnpj_cpf: string; cidade: string }[] = []
      if (cnpjs.length > 0) {
        onProgress?.('Baixando clientes...')
        // A tabela 'Clientes' não existe: o cadastro vem do Omie (José, 23/10/2026)
        const { data: cadastro } = await supabase
          .from('portal_nt_clientes_cadastro_omie')
          .select('cnpj_cpf, nome_fantasia, cidade, estado, lat, lng')
          .in('cnpj_cpf', cnpjs)
        const clientes = cadastro
          ? (cadastro as { cnpj_cpf: string; nome_fantasia: string | null; cidade: string | null; estado: string | null; lat: number | null; lng: number | null }[])
              .map(c => ({ cnpj_cpf: c.cnpj_cpf, nome: c.nome_fantasia || '', cidade: c.cidade || '', estado: c.estado || '', latitude: c.lat ?? undefined, longitude: c.lng ?? undefined }))
          : null

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

      const hoje = hojeBR()
      // 4. Agenda do técnico: é a Lousa (lousa_servicos), que já vem pelo /api/feed — a tabela agenda_tecnico não existe (José, 23/10/2026)

      // 5. Movimentações PPV para cada OS que tem PPV
      const osComPPV = osList.filter((o: { ID_PPV?: string }) => o.ID_PPV)
      if (osComPPV.length > 0) {
        onProgress?.('Baixando pecas...')
        // Em paralelo (antes era uma query por vez — principal gargalo)
        await Promise.all(osComPPV.map(async (os: { ID_PPV?: string }) => {
          const { data: movs } = await supabase
            .from('movimentacoes')
            .select('*')
            .eq('Id_PPV', os.ID_PPV)
          if (movs) await offlineSet(`prefetch:ppv:${os.ID_PPV}`, movs)
        }))
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
      const FASES_CONCLUIDAS = ['Relatorio Concluido', 'Relatório Concluído', 'Executada aguardando comercial', 'Concluída', 'Concluida', 'Faturada', 'Faturado', 'Finalizada', 'Finalizado', 'Enviado Para Omie', 'Enviado para Omie']
      for (const o of osList) {
        if (FASES_CONCLUIDAS.includes(o.Status)) enviadas.add(String(o.Id_Ordem))
      }
      for (const c of clientesData) {
        if (c.cidade) cidadeMap[c.cnpj_cpf] = c.cidade
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
    const hojeRef = hojeBR()
    const [checkinsRes, garantiasRes, requisicoesRes, fornecedoresRes, permissoesRes] = await Promise.all([
      supabase.from('checkin_diario').select('*').eq('tecnico_nome', tecnicoNome).eq('data', hojeRef).order('id'),
      tecnicoNome
        ? supabase.from('garantias').select('*').eq('tecnico_nome', tecnicoNome).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from('Requisicao').select('*')
        .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
        .order('data', { ascending: false }).limit(300),
      supabase.from('Fornecedores').select('*').order('nome').then(r => r, () => ({ data: [] })),
      supabase.from('portal_permissoes').select('user_id, is_admin, modulos_permitidos').then(r => r, () => ({ data: [] })),
    ])
    await offlineSet(`prefetch:checkin:${hojeRef}`, checkinsRes.data || [])
    await offlineSet('prefetch:garantias', garantiasRes.data || [])
    await offlineSet('prefetch:requisicoes', requisicoesRes.data || [])
    await offlineSet('prefetch:fornecedores', fornecedoresRes.data || [])
    await offlineSet('prefetch:portal-permissoes', permissoesRes.data || [])

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
    // Teste offline (22/10/2026): telas sem a página ou sem os arquivos do programa davam "Erro ao carregar a
    // página" ou abriam a tela inicial. Agora: a página de TODAS as telas e de TODAS as OS (até 40) + os arquivos
    // de programa que cada uma usa.
    const rotasEstaticas = [
      '/', '/os', '/os-enviadas', '/requisicoes', '/requisicoes/nova', '/requisicoes-enviadas',
      '/perfil', '/fotos', '/garantias', '/mapa', '/ocorrencias', '/checklist-veiculo', '/catalogos', '/opa',
    ]
    // requisições que o técnico ainda precisa completar abrem sem internet (José, 23/10/2026)
    for (const r of ((requisicoesRes.data || []) as { id: number | string; status?: string; recibo_fornecedor?: string | null }[])
      .filter((r) => r.status === 'pedido' && !r.recibo_fornecedor).slice(0, 20)) {
      rotasEstaticas.push(`/requisicoes/atualizar/${r.id}`)
    }
    for (const os of (osList || []).slice(0, 40) as { Id_Ordem: string }[]) {
      rotasEstaticas.push(`/os/${os.Id_Ordem}`, `/os/${os.Id_Ordem}/preencher`)
    }
    const arquivos = new Set<string>()
    await Promise.allSettled(rotasEstaticas.map(async (r) => {
      const res = await fetch(r)
      if (!res.ok) return
      const html = await res.text()
      for (const m of html.matchAll(/\/_next\/static\/[^"'\s\\)]+\.(?:js|css)/g)) arquivos.add(m[0])
    }))
    // os arquivos de programa ficam no cache do service worker (cache-first)
    await Promise.allSettled([...arquivos].map((a) => fetch(a).catch(() => {})))

    // Dados COMPLETOS da página de cada OS + preencher (o "prefetch" do Next é parcial e não abre a OS offline)
    if (osList && osList.length > 0) {
      const rscHeaders = { RSC: '1' }
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

    await offlineSet('offline-status', { qtd: (osList || []).length, em: Date.now(), por: 'app aberto' })
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
