import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { normName, cleanName, namesMatch, splitTecnicos, nomesBatem } from '@/lib/tecnico-utils'

export async function GET(req: NextRequest) {
  const nome = req.nextUrl.searchParams.get('nome')

  try {
    const { data: perms, error: permErr } = await supabase
      .from('portal_permissoes')
      .select('user_id, mecanico_role, mecanico_tecnico_nome, is_admin, modulos_permitidos, created_at')
      .eq('mecanico_role', 'tecnico')

    if (permErr) throw permErr
    if (!perms || perms.length === 0) return NextResponse.json([])

    const userIds = perms.map(p => p.user_id)

    const { data: users, error: usrErr } = await supabase
      .from('financeiro_usu')
      .select('id, nome, email, funcao, avatar_url')
      .in('id', userIds)

    if (usrErr) throw usrErr

    const mecanicos = (users || []).map(u => {
      const perm = perms.find(p => p.user_id === u.id)
      return {
        id: u.id,
        nome: u.nome,
        email: u.email,
        funcao: u.funcao,
        avatar_url: u.avatar_url,
        mecanico_role: perm?.mecanico_role || 'tecnico',
        tecnico_nome: perm?.mecanico_tecnico_nome || u.nome,
      }
    })

    if (nome) {
      const found = mecanicos.find(m => nomesBatem(m.tecnico_nome || m.nome, nome))
      if (!found) return NextResponse.json(null)

      const tecNome = found.tecnico_nome || found.nome
      const mesParam = req.nextUrl.searchParams.get('mes')
      const now = new Date()
      const mesAtual = mesParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const [anoMes, mesMes] = mesAtual.split('-').map(Number)
      const primeiro = `${mesAtual}-01`
      const ultimo = `${mesAtual}-${new Date(anoMes, mesMes, 0).getDate()}`

      const tecFirstName = normName(tecNome).split(/\s+/)[0]
      const [allOrdensRes, ocorrenciasRes, gpsRes, resumoDiarioRes, reqRes] = await Promise.all([
        supabase.from('Ordens_Omie').select('os_num, cod_int, data, horas, km, valor, status, faturada, interno, cidade, empresa, descricao, obs, tecnicos, vendedor_nome').neq('status', 'Cancelada').gte('data', primeiro).lte('data', ultimo).order('data', { ascending: false }).limit(5000),
        supabase.from('mecanico_ocorrencias').select('*').eq('tecnico_nome', tecNome).order('created_at', { ascending: false }).limit(50),
        supabase.from('GPS_Viagens').select('tecnico_nome, data, km_total, placa, saida_loja, chegada_cliente, saida_cliente, retorno_loja, eventos').ilike('tecnico_nome', `%${tecFirstName}%`).gte('data', primeiro).lte('data', ultimo),
        supabase.from('resumo_diario_tecnico').select('tecnico_nome, data, horas_dirigindo').ilike('tecnico_nome', `%${tecFirstName}%`).gte('data', primeiro).lte('data', ultimo),
        supabase.from('pedidos').select('id_pedido, Id_Os, status, data, pedido_omie, valor_total, Tipo_Pedido').ilike('tecnico', `%${tecNome}%`),
      ])

      const gpsData = (gpsRes.data || []).filter((g: any) => nomesBatem(g.tecnico_nome || '', tecNome))
      const resumoDiarioData = (resumoDiarioRes.data || []).filter((r: any) => nomesBatem(r.tecnico_nome || '', tecNome))

      const resumoDiarioMap: Record<string, number> = {}
      for (const r of resumoDiarioData) {
        const key = String(r.data)
        resumoDiarioMap[key] = (resumoDiarioMap[key] || 0) + (parseFloat(r.horas_dirigindo) || 0)
      }

      const ordens = (allOrdensRes.data || []).filter((o: any) => {
        const tecs = (o.tecnicos as string[]) || []
        return tecs.some((t: string) => nomesBatem(t, tecNome))
      }).map((o: any) => {
        const desc = String(o.descricao || '')
        let servico_solicitado = ''
        let relatorio = ''
        const solMatch = desc.match(/Solicit[aã][çc][aã]o\s+(?:d[oe]\s+)?cliente:\s*([\s\S]*?)(?=\|*Diagn|\|*Servi|$)/i)
        if (solMatch) servico_solicitado = solMatch[1].replace(/\|/g, ' ').trim()
        const servMatch = desc.match(/Servi[çc]o\s+[Rr]ealizado:\s*([\s\S]*?)$/i)
        if (servMatch) relatorio = servMatch[1].replace(/\|/g, ' ').trim()
        if (!relatorio && !servico_solicitado && desc) relatorio = desc.replace(/\|/g, ' ').trim()
        return { ...o, relatorio, servico_solicitado }
      })

      const osCodInts = ordens.map((o: any) => String(o.cod_int)).filter(Boolean)
      const ppvsPorOs: Record<string, any[]> = {}
      const clientePorOs: Record<string, { cliente: string; cidade_cliente: string }> = {}
      const relatorioTecPorOs: Record<string, { motivo: string; servico_realizado: string; status: string; data_envio: string }> = {}

      if (osCodInts.length > 0) {
        const [pedidosRes, osRes, tecRes] = await Promise.all([
          supabase.from('pedidos').select('id_pedido, Id_Os, status, valor_total, pedido_omie').in('Id_Os', osCodInts),
          supabase.from('Ordem_Servico').select('Id_Ordem, Os_Cliente, Cidade_Cliente').in('Id_Ordem', osCodInts),
          supabase.from('Ordem_Servico_Tecnicos').select('Ordem_Servico, Motivo, ServicoRealizado, Status, Data').in('Ordem_Servico', osCodInts),
        ])

        for (const os of osRes.data || []) {
          clientePorOs[String(os.Id_Ordem)] = { cliente: String(os.Os_Cliente || ''), cidade_cliente: String(os.Cidade_Cliente || '') }
        }
        for (const rt of tecRes.data || []) {
          const osId = String(rt.Ordem_Servico)
          if (!relatorioTecPorOs[osId] || rt.Status === 'enviado') {
            relatorioTecPorOs[osId] = { motivo: String(rt.Motivo || ''), servico_realizado: String(rt.ServicoRealizado || ''), status: String(rt.Status || ''), data_envio: String(rt.Data || '') }
          }
        }

        const pedidos = pedidosRes.data
        if (pedidos && pedidos.length > 0) {
          const ppvIds = pedidos.map((p: any) => String(p.id_pedido))
          const { data: movs } = await supabase.from('movimentacoes').select('Id_PPV, CodProduto, Descricao, Qtde, Preco, TipoMovimento').in('Id_PPV', ppvIds)

          for (const ped of pedidos) {
            const osId = String(ped.Id_Os)
            const ppvId = String(ped.id_pedido)
            const pedasMovs = (movs || []).filter((m: any) => String(m.Id_PPV) === ppvId)

            const prodMap: Record<string, any> = {}
            for (const m of pedasMovs) {
              const tipo = String(m.TipoMovimento || '').toLowerCase()
              const cod = String(m.CodProduto || '')
              const qtd = Math.abs(parseFloat(String(m.Qtde || 0)))
              const preco = parseFloat(String(m.Preco || 0))
              const desc = String(m.Descricao || '')

              if (tipo.includes('saida') || tipo.includes('saída')) {
                if (prodMap[cod]) prodMap[cod].qtd += qtd
                else prodMap[cod] = { codigo: cod, descricao: desc, qtd, preco, devolvido: 0 }
              } else if (tipo.includes('devolu')) {
                if (prodMap[cod]) prodMap[cod].devolvido += qtd
                else prodMap[cod] = { codigo: cod, descricao: desc, qtd: 0, preco, devolvido: qtd }
              }
            }

            if (!ppvsPorOs[osId]) ppvsPorOs[osId] = []
            ppvsPorOs[osId].push({ id: ppvId, pedido_omie: String(ped.pedido_omie || ''), status: String(ped.status || ''), produtos: Object.values(prodMap) })
          }
        }
      }

      const calcHorasServicoDia = (eventos: any[]): number => {
        if (!eventos || eventos.length === 0) return 0
        let horas = 0
        let ultimaSaida: Date | null = null
        for (const ev of eventos) {
          if (ev.tipo === 'saida_loja') ultimaSaida = new Date(ev.horario)
          else if (ev.tipo === 'retorno_loja' && ultimaSaida) {
            const diffMin = (new Date(ev.horario).getTime() - ultimaSaida.getTime()) / 60000
            if (diffMin > 30) horas += diffMin / 60
            ultimaSaida = null
          }
        }
        if (ultimaSaida && eventos.length > 0) {
          const diffMin = (new Date(eventos[eventos.length - 1].horario).getTime() - ultimaSaida.getTime()) / 60000
          if (diffMin > 30) horas += diffMin / 60
        }
        return horas
      }

      let gpsKmMes = 0, gpsDias = 0, gpsDirigindoHoras = 0, gpsParadoForaHoras = 0

      for (const g of gpsData) {
        gpsKmMes += parseFloat(g.km_total) || 0
        gpsDias++
        const horasFora = calcHorasServicoDia(g.eventos || [])
        const dirigindo = resumoDiarioMap[String(g.data)] || 0
        gpsParadoForaHoras += Math.max(0, horasFora - dirigindo)
        gpsDirigindoHoras += dirigindo
      }

      const ordensComPpv = ordens.map((o: any) => {
        const codInt = String(o.cod_int)
        const cli = clientePorOs[codInt]
        const relTec = relatorioTecPorOs[codInt]
        return {
          ...o,
          cliente: cli?.cliente || '',
          cidade_cliente: cli?.cidade_cliente || '',
          relatorio_tecnico: relTec?.servico_realizado || '',
          diagnostico_tecnico: relTec?.motivo || '',
          relatorio_status: relTec?.status || '',
          relatorio_data_envio: relTec?.data_envio || '',
          ppvs: ppvsPorOs[codInt] || [],
        }
      })

      // Alertas
      const alertasDetectados: any[] = []
      const hoje = new Date()
      hoje.setHours(0, 0, 0, 0)
      for (const o of ordensComPpv) {
        const codInt = String(o.cod_int)
        const rel = relatorioTecPorOs[codInt]
        const dataOs = String(o.data || '')
        if (!rel || !rel.servico_realizado) {
          const diasSem = dataOs ? Math.floor((hoje.getTime() - new Date(dataOs + 'T00:00:00').getTime()) / 86400000) : 0
          alertasDetectados.push({ tipo: 'atraso_relatorio', descricao: `OS ${o.os_num} sem relatorio do tecnico${diasSem > 0 ? ` (${diasSem} dias)` : ''}`, id_ordem: codInt, data_referencia: dataOs || primeiro, detalhes: `${o.cliente || o.cidade || 'Sem cliente'}` })
        } else if (rel.status === 'enviado' && rel.data_envio && dataOs) {
          const dOs = new Date(dataOs + 'T00:00:00')
          const dEnvio = new Date(rel.data_envio.slice(0, 10) + 'T00:00:00')
          const diasAtraso = Math.floor((dEnvio.getTime() - dOs.getTime()) / 86400000)
          if (diasAtraso > 1) {
            alertasDetectados.push({ tipo: 'atraso_entrega_relatorio', descricao: `OS ${o.os_num} - relatorio entregue com ${diasAtraso} dias de atraso`, id_ordem: codInt, data_referencia: dataOs, detalhes: `Executada: ${dataOs.split('-').reverse().join('/')} | Entregue: ${rel.data_envio.slice(0, 10).split('-').reverse().join('/')} | ${o.cliente || o.cidade || 'Sem cliente'}` })
          }
        }
      }

      const gpsKmPorData: Record<string, number> = {}
      for (const g of gpsData) gpsKmPorData[String(g.data)] = (gpsKmPorData[String(g.data)] || 0) + (parseFloat(g.km_total) || 0)
      for (const o of ordensComPpv) {
        const kmOs = parseFloat(String(o.km)) || 0
        const dataOs = String(o.data || '')
        const kmGps = gpsKmPorData[dataOs] || 0
        if (kmOs > 0 && kmGps > 0) {
          const diff = Math.abs(kmOs - kmGps)
          const pct = diff / Math.max(kmOs, kmGps) * 100
          if (pct > 30 && diff > 20) {
            alertasDetectados.push({ tipo: 'divergencia_km', descricao: `OS ${o.os_num} - KM divergente (OS: ${kmOs.toFixed(0)} km | GPS: ${kmGps.toFixed(0)} km)`, id_ordem: String(o.cod_int), data_referencia: dataOs || primeiro, detalhes: `Diferenca: ${diff.toFixed(0)} km (${pct.toFixed(0)}%)` })
          }
        }
      }

      const { data: alertasExistentes } = await supabase.from('mecanico_alertas').select('*').eq('tecnico_nome', tecNome).gte('data_referencia', primeiro).lte('data_referencia', ultimo)
      const alertasMap = new Map((alertasExistentes || []).map((a: any) => [`${a.tipo}_${a.id_ordem}`, a]))
      const novos = alertasDetectados.filter(a => !alertasMap.has(`${a.tipo}_${a.id_ordem}`))
      if (novos.length > 0) {
        await supabase.from('mecanico_alertas').insert(novos.map(a => ({ tecnico_nome: tecNome, tipo: a.tipo, descricao: a.descricao, detalhes: a.detalhes, id_ordem: a.id_ordem, data_referencia: a.data_referencia, status: 'pendente' })))
      }

      const [alertasMesRes, alertasCarryoverRes] = await Promise.all([
        supabase.from('mecanico_alertas').select('*').eq('tecnico_nome', tecNome).gte('data_referencia', primeiro).lte('data_referencia', ultimo).order('data_referencia', { ascending: false }),
        supabase.from('mecanico_alertas').select('*').eq('tecnico_nome', tecNome).eq('status', 'pendente').lt('data_referencia', primeiro).order('data_referencia', { ascending: false }),
      ])

      const ordensMap = new Map<string, any>()
      for (const o of ordensComPpv) ordensMap.set(String(o.cod_int), o)

      const carryoverOrdemIds = (alertasCarryoverRes.data || []).map((a: any) => String(a.id_ordem)).filter((id: string) => id && !ordensMap.has(id))
      if (carryoverOrdemIds.length > 0) {
        const uniqueIds = [...new Set(carryoverOrdemIds)]
        const [carryOsRes, carryCliRes, carryTecRes] = await Promise.all([
          supabase.from('Ordens_Omie').select('os_num, cod_int, data, horas, km, valor, status, faturada, interno, cidade, empresa, descricao, obs, tecnicos').in('cod_int', uniqueIds),
          supabase.from('Ordem_Servico').select('Id_Ordem, Os_Cliente, Cidade_Cliente').in('Id_Ordem', uniqueIds),
          supabase.from('Ordem_Servico_Tecnicos').select('Ordem_Servico, Motivo, ServicoRealizado, Status').in('Ordem_Servico', uniqueIds),
        ])
        const carryCliMap: Record<string, any> = {}
        for (const os of carryCliRes.data || []) carryCliMap[String(os.Id_Ordem)] = { cliente: String(os.Os_Cliente || ''), cidade_cliente: String(os.Cidade_Cliente || '') }
        const carryTecMap: Record<string, any> = {}
        for (const rt of carryTecRes.data || []) {
          const osId = String(rt.Ordem_Servico)
          if (!carryTecMap[osId] || rt.Status === 'enviado') carryTecMap[osId] = { motivo: String(rt.Motivo || ''), servico_realizado: String(rt.ServicoRealizado || '') }
        }
        for (const os of carryOsRes.data || []) {
          const codInt = String(os.cod_int)
          const cli = carryCliMap[codInt]
          const relTec = carryTecMap[codInt]
          ordensMap.set(codInt, { os_num: os.os_num, cod_int: codInt, data: os.data, horas: os.horas, km: os.km, valor: os.valor, status: os.status, faturada: os.faturada, interno: os.interno, cidade: os.cidade, cliente: cli?.cliente || '', cidade_cliente: cli?.cidade_cliente || '', relatorio_tecnico: relTec?.servico_realizado || '', diagnostico_tecnico: relTec?.motivo || '', ppvs: [] })
        }
      }

      const enriquecerAlerta = (a: any, isCarryover: boolean) => {
        const ordem = ordensMap.get(String(a.id_ordem))
        return {
          ...a, carryover: isCarryover,
          ordem: ordem ? { os_num: ordem.os_num, data: ordem.data, status: ordem.status, faturada: ordem.faturada, cliente: ordem.cliente || '', cidade_cliente: ordem.cidade_cliente || '', horas: String(ordem.horas || ''), km: String(ordem.km || ''), valor: String(ordem.valor || ''), relatorio_tecnico: ordem.relatorio_tecnico || '', diagnostico_tecnico: ordem.diagnostico_tecnico || '', servico_solicitado: ordem.servico_solicitado || '', ppvs: ordem.ppvs || [] } : null,
        }
      }

      const alertasEnriquecidos = [
        ...(alertasMesRes.data || []).map((a: any) => enriquecerAlerta(a, false)),
        ...(alertasCarryoverRes.data || []).map((a: any) => enriquecerAlerta(a, true)),
      ]

      const mesNum = mesMes
      const anoNum = anoMes
      const reqDoMes = (reqRes.data || []).filter((r: any) => {
        const d = String(r.data || '')
        const parts = d.split('/')
        if (parts.length < 3) return false
        const mes = parseInt(parts[1])
        const ano = parseInt(parts[2].split(' ')[0])
        return mes === mesNum && ano === anoNum
      })

      return NextResponse.json({
        ...found,
        mes: mesAtual,
        ordens: ordensComPpv,
        ocorrencias: ocorrenciasRes.data || [],
        requisicoes: reqDoMes,
        alertas: alertasEnriquecidos,
        gps: { kmMes: Math.round(gpsKmMes), dias: gpsDias, dirigindoMin: Math.round(gpsDirigindoHoras * 60), paradoForaMin: Math.round(gpsParadoForaHoras * 60) },
        veiculo: null,
        data_entrada: null,
      })
    }

    // Lista
    const now = new Date()
    const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const primeiro = `${mesAtual}-01`
    const ultimo = `${mesAtual}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`

    const { data: ordens } = await supabase.from('Ordens_Omie').select('os_num, tecnicos, horas, km, valor, interno').neq('status', 'Cancelada').gte('data', primeiro).lte('data', ultimo).limit(5000)

    const [ocPendentesRes, alertasPendentesRes] = await Promise.all([
      supabase.from('mecanico_ocorrencias').select('tecnico_nome, id').eq('pontos', 0),
      supabase.from('mecanico_alertas').select('tecnico_nome, id').eq('status', 'pendente'),
    ])

    const resultado = mecanicos.map(m => {
      const tecNome = m.tecnico_nome || m.nome
      let total = 0, horas = 0, km = 0, valor = 0
      for (const o of ordens || []) {
        const tecs = ((o as any).tecnicos || []) as string[]
        if (tecs.some((t: string) => nomesBatem(t, tecNome))) {
          total++
          horas += parseFloat((o as any).horas) || 0
          km += parseFloat((o as any).km) || 0
          valor += parseFloat((o as any).valor) || 0
        }
      }
      const ocPendentes = (ocPendentesRes.data || []).filter((oc: any) => nomesBatem(oc.tecnico_nome || '', tecNome)).length
      const alertasPendentes = (alertasPendentesRes.data || []).filter((al: any) => nomesBatem(al.tecnico_nome || '', tecNome)).length
      return { ...m, stats: { total, horas, km, valor }, ocorrencias_pendentes: ocPendentes, alertas_pendentes: alertasPendentes }
    })

    return NextResponse.json({ mecanicos: resultado })
  } catch (e: any) {
    console.error('[mecanicos]', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { acao } = body

    if (acao === 'criar_ocorrencia') {
      const { tecnico_nome, tipo, titulo, descricao, criado_por } = body
      if (!tecnico_nome || !tipo || !titulo) return NextResponse.json({ error: 'campos obrigatorios' }, { status: 400 })
      const textoDescricao = titulo + (descricao ? ` - ${descricao}` : '')
      const { data, error } = await supabase.from('mecanico_ocorrencias').insert({ tecnico_nome, tipo, descricao: textoDescricao, data_referencia: new Date().toISOString().slice(0, 10), admin_nome: criado_por || 'admin' }).select().single()
      if (error) throw error
      return NextResponse.json(data)
    }

    if (acao === 'atualizar_ocorrencia') {
      const { id, status } = body
      if (!id) return NextResponse.json({ error: 'id obrigatorio' }, { status: 400 })
      const update: Record<string, unknown> = {}
      if (status === 'resolvida') update.pontos = 1
      else if (status === 'cancelada') update.pontos = -1
      else if (status === 'justificada') update.pontos = 2
      const { error } = await supabase.from('mecanico_ocorrencias').update(update).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (acao === 'justificar_alerta') {
      const { id, admin_comentario, admin_nome } = body
      if (!id) return NextResponse.json({ error: 'id obrigatorio' }, { status: 400 })
      const { error } = await supabase.from('mecanico_alertas').update({ status: 'justificada', admin_comentario: admin_comentario || '', admin_nome: admin_nome || 'admin', resolvido_em: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (acao === 'alerta_para_ocorrencia') {
      const { id, admin_nome } = body
      if (!id) return NextResponse.json({ error: 'id obrigatorio' }, { status: 400 })
      const { data: alerta, error: aErr } = await supabase.from('mecanico_alertas').select('*').eq('id', id).single()
      if (aErr || !alerta) return NextResponse.json({ error: 'alerta nao encontrado' }, { status: 404 })
      const tipoOc = alerta.tipo === 'atraso_relatorio' || alerta.tipo === 'atraso_entrega_relatorio' ? 'atraso' : 'observacao'
      await supabase.from('mecanico_ocorrencias').insert({ tecnico_nome: alerta.tecnico_nome, tipo: tipoOc, descricao: alerta.descricao + (alerta.detalhes ? ` - ${alerta.detalhes}` : ''), data_referencia: alerta.data_referencia || new Date().toISOString().slice(0, 10), admin_nome: admin_nome || 'admin', id_alerta: String(alerta.id) })
      await supabase.from('mecanico_alertas').update({ status: 'ocorrencia', admin_nome: admin_nome || 'admin', resolvido_em: new Date().toISOString() }).eq('id', id)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'acao desconhecida' }, { status: 400 })
  } catch (e: any) {
    console.error('[mecanicos POST]', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
