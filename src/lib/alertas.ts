import { supabase } from './supabase'
import type { AlertaSeveridade } from './types'

interface AlertaDetectado {
  tecnico_nome: string
  tipo: string
  severidade: AlertaSeveridade
  data_referencia: string
  descricao: string
  detalhes: Record<string, unknown>
  id_ordem: string | null
  pontos: number
}

// Pontuação por severidade
const PONTOS: Record<AlertaSeveridade, number> = {
  critica: 10,
  alta: 5,
  media: 3,
  baixa: 1,
}

const LABEL_TIPO: Record<string, string> = {
  atraso_deslocamento: 'Atraso no deslocamento',
  atraso_grave: 'Atraso grave (30+ min)',
  sem_justificativa: 'Atraso sem justificativa',
  inicio_tardio: 'Início tardio do dia',
  sem_atividade: 'Sem atividade no dia',
  km_inconsistente: 'KM inconsistente com rota',
  km_excessivo: 'KM excessivo em viagem',
  km_zero: 'KM zerado com deslocamento',
  horario_invertido: 'Horário invertido',
  servico_muito_curto: 'Serviço muito curto',
  os_rascunho_antiga: 'Relatório parado em rascunho',
  os_nao_preenchida: 'OS atrasada sem relatório',
  sem_assinatura_cliente: 'Sem assinatura do cliente',
  sem_assinatura_tecnico: 'Sem assinatura do técnico',
  sem_foto_horimetro: 'Sem foto do horímetro',
  diario_incompleto: 'Diário incompleto',
  multiplos_atrasos_dia: 'Múltiplos atrasos no dia',
  manual: 'Ocorrência manual',
}

export function getLabelTipo(tipo: string) {
  return LABEL_TIPO[tipo] || tipo
}

export async function varrerAlertas(dataInicio: string, dataFim: string): Promise<number> {
  // Buscar dados do período
  const [
    { data: diarios },
    { data: relatorios },
    { data: osAtivas },
    { data: tecnicos },
    { data: alertasExistentes },
  ] = await Promise.all([
    supabase.from('Diario_Tecnico').select('*').gte('data', dataInicio).lte('data', dataFim),
    supabase.from('Ordem_Servico_Tecnicos').select('*').gte('Data', dataInicio).lte('Data', dataFim),
    supabase.from('Ordem_Servico').select('*').not('Status', 'in', '("Concluida","Cancelada")').lt('Previsao_Execucao', dataFim),
    supabase.from('mecanico_usuarios').select('tecnico_nome').eq('ativo', true),
    supabase.from('mecanico_alertas').select('tipo, tecnico_nome, data_referencia, id_ordem').gte('data_referencia', dataInicio).lte('data_referencia', dataFim),
  ])

  const diarioList = (diarios || []) as Record<string, unknown>[]
  const relatorioList = (relatorios || []) as Record<string, unknown>[]
  const osList = (osAtivas || []) as Record<string, unknown>[]
  const tecnicosList = (tecnicos || []) as { tecnico_nome: string }[]

  // Chave única para não duplicar alertas
  const existentes = new Set(
    (alertasExistentes || []).map((a: Record<string, unknown>) =>
      `${a.tipo}|${a.tecnico_nome}|${a.data_referencia}|${a.id_ordem || ''}`
    )
  )

  const alertas: AlertaDetectado[] = []

  function add(a: AlertaDetectado) {
    const chave = `${a.tipo}|${a.tecnico_nome}|${a.data_referencia}|${a.id_ordem || ''}`
    if (existentes.has(chave)) return
    existentes.add(chave)
    alertas.push(a)
  }

  // Agrupar diários por técnico+data
  const diarioPorTecDia = new Map<string, Record<string, unknown>[]>()
  for (const d of diarioList) {
    const key = `${d.tecnico_nome}|${d.data}`
    if (!diarioPorTecDia.has(key)) diarioPorTecDia.set(key, [])
    diarioPorTecDia.get(key)!.push(d)
  }

  // 1. ATRASOS no diário
  for (const d of diarioList) {
    const atraso = Number(d.atraso_min) || 0
    if (atraso > 0 && atraso < 30) {
      add({
        tecnico_nome: d.tecnico_nome as string,
        tipo: 'atraso_deslocamento',
        severidade: 'media',
        data_referencia: d.data as string,
        descricao: `Atraso de ${atraso} min no deslocamento até ${d.cliente}`,
        detalhes: { atraso_min: atraso, cliente: d.cliente, tempo_estimado: d.tempo_estimado_min, tempo_real: d.tempo_real_min },
        id_ordem: d.id_ordem as string,
        pontos: PONTOS.media,
      })
    }
    if (atraso >= 30) {
      add({
        tecnico_nome: d.tecnico_nome as string,
        tipo: 'atraso_grave',
        severidade: 'alta',
        data_referencia: d.data as string,
        descricao: `Atraso grave de ${atraso} min no deslocamento até ${d.cliente}`,
        detalhes: { atraso_min: atraso, cliente: d.cliente, tempo_estimado: d.tempo_estimado_min, tempo_real: d.tempo_real_min },
        id_ordem: d.id_ordem as string,
        pontos: PONTOS.alta,
      })
    }
    // Sem justificativa
    if (atraso > 0 && !d.justificativa_atraso) {
      add({
        tecnico_nome: d.tecnico_nome as string,
        tipo: 'sem_justificativa',
        severidade: 'alta',
        data_referencia: d.data as string,
        descricao: `Atraso de ${atraso} min sem justificativa (${d.cliente})`,
        detalhes: { atraso_min: atraso, cliente: d.cliente },
        id_ordem: d.id_ordem as string,
        pontos: PONTOS.alta,
      })
    }
  }

  // 2. Múltiplos atrasos no mesmo dia
  for (const [key, entradas] of diarioPorTecDia) {
    const atrasadas = entradas.filter(d => (Number(d.atraso_min) || 0) > 0)
    if (atrasadas.length >= 2) {
      const [nome, data] = key.split('|')
      add({
        tecnico_nome: nome,
        tipo: 'multiplos_atrasos_dia',
        severidade: 'alta',
        data_referencia: data,
        descricao: `${atrasadas.length} atrasos no mesmo dia`,
        detalhes: { qtd_atrasos: atrasadas.length, ordens: atrasadas.map(d => d.id_ordem) },
        id_ordem: null,
        pontos: PONTOS.alta,
      })
    }
  }

  // 3. Início tardio (primeiro hora_saida_origem > 09:00)
  for (const [key, entradas] of diarioPorTecDia) {
    const comSaida = entradas.filter(d => d.hora_saida_origem).sort((a, b) =>
      String(a.hora_saida_origem).localeCompare(String(b.hora_saida_origem))
    )
    if (comSaida.length > 0) {
      const primeira = String(comSaida[0].hora_saida_origem)
      if (primeira > '09:00') {
        const [nome, data] = key.split('|')
        add({
          tecnico_nome: nome,
          tipo: 'inicio_tardio',
          severidade: 'baixa',
          data_referencia: data,
          descricao: `Primeira saída às ${primeira} (esperado até 08:15)`,
          detalhes: { hora_primeira_saida: primeira },
          id_ordem: comSaida[0].id_ordem as string,
          pontos: PONTOS.baixa,
        })
      }
    }
  }

  // 4. KM inconsistente / excessivo / zerado
  for (const d of diarioList) {
    if (!d.viagens) continue
    try {
      const viagens = JSON.parse(d.viagens as string) as { kmTotal: string; horaSaida: string; horaChegada: string }[]
      for (const v of viagens) {
        const km = parseFloat(v.kmTotal) || 0
        // KM excessivo
        if (km > 300) {
          add({
            tecnico_nome: d.tecnico_nome as string,
            tipo: 'km_excessivo',
            severidade: 'alta',
            data_referencia: d.data as string,
            descricao: `Viagem com ${km} km registrados (${d.cliente})`,
            detalhes: { km, cliente: d.cliente },
            id_ordem: d.id_ordem as string,
            pontos: PONTOS.alta,
          })
        }
      }
      // KM zerado com deslocamento
      const totalKm = viagens.reduce((s, v) => s + (parseFloat(v.kmTotal) || 0), 0)
      if (totalKm === 0 && d.status === 'finalizado' && d.distancia_km && Number(d.distancia_km) > 5) {
        add({
          tecnico_nome: d.tecnico_nome as string,
          tipo: 'km_zero',
          severidade: 'media',
          data_referencia: d.data as string,
          descricao: `KM zerado mas rota estimada de ${d.distancia_km} km (${d.cliente})`,
          detalhes: { distancia_estimada: d.distancia_km, cliente: d.cliente },
          id_ordem: d.id_ordem as string,
          pontos: PONTOS.media,
        })
      }
      // KM inconsistente com rota (diferença > 100%)
      if (totalKm > 0 && d.distancia_km && Number(d.distancia_km) > 0) {
        const diff = Math.abs(totalKm - Number(d.distancia_km))
        const pct = diff / Number(d.distancia_km)
        if (pct > 1 && diff > 20) {
          add({
            tecnico_nome: d.tecnico_nome as string,
            tipo: 'km_inconsistente',
            severidade: 'media',
            data_referencia: d.data as string,
            descricao: `KM informado (${totalKm}) difere ${Math.round(pct * 100)}% da rota (${d.distancia_km} km)`,
            detalhes: { km_informado: totalKm, km_rota: d.distancia_km, diff_pct: Math.round(pct * 100) },
            id_ordem: d.id_ordem as string,
            pontos: PONTOS.media,
          })
        }
      }
    } catch { /* viagens inválido */ }
  }

  // 5. Horário invertido / serviço muito curto
  for (const d of diarioList) {
    const saida = d.hora_saida_origem as string
    const chegada = d.hora_chegada_cliente as string
    if (saida && chegada && saida > chegada) {
      add({
        tecnico_nome: d.tecnico_nome as string,
        tipo: 'horario_invertido',
        severidade: 'critica',
        data_referencia: d.data as string,
        descricao: `Saída (${saida}) depois da chegada (${chegada}) — ${d.cliente}`,
        detalhes: { hora_saida: saida, hora_chegada: chegada, cliente: d.cliente },
        id_ordem: d.id_ordem as string,
        pontos: PONTOS.critica,
      })
    }
    // Serviço muito curto
    if (chegada && d.hora_saida_cliente) {
      const [h1, m1] = chegada.split(':').map(Number)
      const [h2, m2] = (d.hora_saida_cliente as string).split(':').map(Number)
      const min = (h2 * 60 + m2) - (h1 * 60 + m1)
      if (min >= 0 && min < 5 && d.status === 'finalizado') {
        add({
          tecnico_nome: d.tecnico_nome as string,
          tipo: 'servico_muito_curto',
          severidade: 'alta',
          data_referencia: d.data as string,
          descricao: `Serviço de apenas ${min} min no cliente (${d.cliente})`,
          detalhes: { minutos: min, cliente: d.cliente, chegada, saida_cliente: d.hora_saida_cliente },
          id_ordem: d.id_ordem as string,
          pontos: PONTOS.alta,
        })
      }
    }
  }

  // 6. Diário incompleto (finalizado sem horários)
  for (const d of diarioList) {
    if (d.status === 'finalizado' && (!d.hora_saida_origem || !d.hora_chegada_cliente)) {
      add({
        tecnico_nome: d.tecnico_nome as string,
        tipo: 'diario_incompleto',
        severidade: 'media',
        data_referencia: d.data as string,
        descricao: `Diário finalizado sem horários completos (${d.cliente})`,
        detalhes: { hora_saida: d.hora_saida_origem, hora_chegada: d.hora_chegada_cliente, cliente: d.cliente },
        id_ordem: d.id_ordem as string,
        pontos: PONTOS.media,
      })
    }
  }

  // 7. Sem atividade — técnico ativo sem nenhum diário no dia
  const datasNoRange = new Set(diarioList.map(d => d.data as string))
  for (const data of datasNoRange) {
    // Pular hoje (pode não ter terminado ainda)
    if (data === new Date().toISOString().split('T')[0]) continue
    const dow = new Date(data + 'T12:00:00').getDay()
    if (dow === 0 || dow === 6) continue // pular fim de semana
    for (const tec of tecnicosList) {
      const temDiario = diarioList.some(d => d.tecnico_nome === tec.tecnico_nome && d.data === data)
      if (!temDiario) {
        // Verificar se tinha OS ativa
        const tinhaOS = osList.some(o =>
          ((o.Os_Tecnico as string) === tec.tecnico_nome || (o.Os_Tecnico2 as string) === tec.tecnico_nome) &&
          (o.Previsao_Execucao as string) <= data
        )
        if (tinhaOS) {
          add({
            tecnico_nome: tec.tecnico_nome,
            tipo: 'sem_atividade',
            severidade: 'media',
            data_referencia: data,
            descricao: `Nenhum registro no diário, mas tinha OS ativa`,
            detalhes: {},
            id_ordem: null,
            pontos: PONTOS.media,
          })
        }
      }
    }
  }

  // 8. Relatórios — assinaturas e fotos
  for (const r of relatorioList) {
    if (r.Status !== 'enviado') continue
    if (!r.AssCliente) {
      add({
        tecnico_nome: r.TecResp1 as string,
        tipo: 'sem_assinatura_cliente',
        severidade: 'critica',
        data_referencia: r.Data as string,
        descricao: `Relatório enviado sem assinatura do cliente`,
        detalhes: { ordem: r.Ordem_Servico },
        id_ordem: r.Ordem_Servico as string,
        pontos: PONTOS.critica,
      })
    }
    if (!r.AssTecnico) {
      add({
        tecnico_nome: r.TecResp1 as string,
        tipo: 'sem_assinatura_tecnico',
        severidade: 'critica',
        data_referencia: r.Data as string,
        descricao: `Relatório enviado sem assinatura do técnico`,
        detalhes: { ordem: r.Ordem_Servico },
        id_ordem: r.Ordem_Servico as string,
        pontos: PONTOS.critica,
      })
    }
    if (!r.FotoHorimetro && r.Horimetro) {
      add({
        tecnico_nome: r.TecResp1 as string,
        tipo: 'sem_foto_horimetro',
        severidade: 'alta',
        data_referencia: r.Data as string,
        descricao: `Horímetro preenchido mas sem foto`,
        detalhes: { horimetro: r.Horimetro, ordem: r.Ordem_Servico },
        id_ordem: r.Ordem_Servico as string,
        pontos: PONTOS.alta,
      })
    }
  }

  // 9. OS rascunho antiga (3+ dias)
  const hoje = new Date().toISOString().split('T')[0]
  for (const r of relatorioList) {
    if (r.Status !== 'rascunho') continue
    const dataRel = r.Data as string
    if (!dataRel) continue
    const diff = (new Date(hoje).getTime() - new Date(dataRel).getTime()) / 86400000
    if (diff >= 3) {
      add({
        tecnico_nome: r.TecResp1 as string,
        tipo: 'os_rascunho_antiga',
        severidade: 'media',
        data_referencia: dataRel,
        descricao: `Relatório em rascunho há ${Math.floor(diff)} dias`,
        detalhes: { dias: Math.floor(diff), ordem: r.Ordem_Servico },
        id_ordem: r.Ordem_Servico as string,
        pontos: PONTOS.media,
      })
    }
  }

  // 10. OS não preenchida (previsão passou e sem relatório)
  for (const o of osList) {
    const prev = o.Previsao_Execucao as string
    if (!prev || prev >= hoje) continue
    const diff = (new Date(hoje).getTime() - new Date(prev).getTime()) / 86400000
    if (diff < 2) continue // Só conta >= 2 dias
    const temRelatorio = relatorioList.some(r => r.Ordem_Servico === o.Id_Ordem)
    if (!temRelatorio) {
      const tecnico = o.Os_Tecnico as string
      if (tecnico) {
        add({
          tecnico_nome: tecnico,
          tipo: 'os_nao_preenchida',
          severidade: 'alta',
          data_referencia: prev,
          descricao: `OS ${o.Id_Ordem} com ${Math.floor(diff)} dias de atraso sem relatório`,
          detalhes: { dias_atraso: Math.floor(diff), cliente: o.Os_Cliente, status: o.Status },
          id_ordem: o.Id_Ordem as string,
          pontos: PONTOS.alta,
        })
      }
    }
  }

  // Inserir alertas no banco
  if (alertas.length > 0) {
    const { error } = await supabase.from('mecanico_alertas').insert(alertas)
    if (error) console.error('Erro ao inserir alertas:', error)
  }

  return alertas.length
}
