import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

const CHECKLIST_ITEMS = [
  { key: 'crlv', cat: 'Documentação', titulo: 'CRLV', desc: 'Fotografe o documento CRLV do veículo e verifique a validade' },
  { key: 'lataria_frente', cat: 'Exterior', titulo: 'Frente do veículo', desc: 'Fotografe a frente mostrando para-choque, capô e faróis' },
  { key: 'lataria_traseira', cat: 'Exterior', titulo: 'Traseira do veículo', desc: 'Fotografe a traseira mostrando lanternas e para-choque' },
  { key: 'lataria_esquerda', cat: 'Exterior', titulo: 'Lateral esquerda', desc: 'Fotografe toda a lateral esquerda' },
  { key: 'lataria_direita', cat: 'Exterior', titulo: 'Lateral direita', desc: 'Fotografe toda a lateral direita' },
  { key: 'pneu_de', cat: 'Pneus', titulo: 'Pneu dianteiro esquerdo', desc: 'Fotografe mostrando a banda de rodagem' },
  { key: 'pneu_dd', cat: 'Pneus', titulo: 'Pneu dianteiro direito', desc: 'Fotografe mostrando a banda de rodagem' },
  { key: 'pneu_te', cat: 'Pneus', titulo: 'Pneu traseiro esquerdo', desc: 'Fotografe mostrando a banda de rodagem' },
  { key: 'pneu_td', cat: 'Pneus', titulo: 'Pneu traseiro direito', desc: 'Fotografe mostrando a banda de rodagem' },
  { key: 'estepe', cat: 'Pneus', titulo: 'Estepe', desc: 'Fotografe o estepe e verifique estado e calibragem' },
  { key: 'parabrisa', cat: 'Exterior', titulo: 'Para-brisa e limpador', desc: 'Fotografe de dentro para fora mostrando trincas se houver' },
  { key: 'oleo_motor', cat: 'Motor', titulo: 'Nível de óleo', desc: 'Com motor frio, verifique a vareta e fotografe' },
  { key: 'arrefecimento', cat: 'Motor', titulo: 'Fluido de arrefecimento', desc: 'Fotografe o reservatório mostrando o nível' },
  { key: 'bateria', cat: 'Motor', titulo: 'Bateria', desc: 'Fotografe mostrando terminais e fixação' },
  { key: 'painel', cat: 'Interior', titulo: 'Painel de instrumentos', desc: 'Ligue o veículo e fotografe o painel (luzes de alerta)' },
  { key: 'hodometro', cat: 'Interior', titulo: 'Hodômetro', desc: 'Fotografe mostrando a quilometragem atual' },
  { key: 'limpeza_interna', cat: 'Interior', titulo: 'Limpeza interna', desc: 'Fotografe o interior (bancos, tapetes, porta-objetos)' },
  { key: 'extintor', cat: 'Segurança', titulo: 'Extintor de incêndio', desc: 'Fotografe mostrando a etiqueta de validade' },
  { key: 'triangulo', cat: 'Segurança', titulo: 'Triângulo de segurança', desc: 'Fotografe o triângulo' },
  { key: 'macaco_chave', cat: 'Segurança', titulo: 'Macaco e chave de roda', desc: 'Fotografe o macaco e a chave de roda' },
]

function calcularScore(checklist: any, itens: any[]): { score: number; alertas: string[] } {
  let score = 100
  const alertas: string[] = []

  // 1. Tempo total
  if (checklist.duracao_total_seg != null) {
    if (checklist.duracao_total_seg < 480) {
      score -= 30; alertas.push('Checklist completo em menos de 8 minutos')
    } else if (checklist.duracao_total_seg < 900) {
      score -= 15; alertas.push('Checklist completo em menos de 15 minutos')
    }
  }

  // 2. Tempo médio por item
  const comTempo = itens.filter(i => i.respondido_em && checklist.inicio_em)
  if (comTempo.length > 1) {
    const sorted = [...comTempo].sort((a, b) => new Date(a.respondido_em).getTime() - new Date(b.respondido_em).getTime())
    const duracoes: number[] = []
    for (let i = 0; i < sorted.length; i++) {
      const prev = i === 0 ? new Date(checklist.inicio_em).getTime() : new Date(sorted[i - 1].respondido_em).getTime()
      const curr = new Date(sorted[i].respondido_em).getTime()
      duracoes.push((curr - prev) / 1000)
    }
    const media = duracoes.reduce((a, b) => a + b, 0) / duracoes.length
    if (media < 10) {
      score -= 25; alertas.push(`Tempo médio por item: ${Math.round(media)}s (muito rápido)`)
    } else if (media < 20) {
      score -= 10; alertas.push(`Tempo médio por item: ${Math.round(media)}s (rápido)`)
    }

    // Itens individuais muito rápidos
    const rapidos = duracoes.filter(d => d < 10).length
    if (rapidos > 3) {
      score -= 5; alertas.push(`${rapidos} itens respondidos em menos de 10 segundos`)
    }

    // 8. Padrão regular (desvio padrão < 3s = muito regular = bot)
    if (duracoes.length >= 5) {
      const avg = duracoes.reduce((a, b) => a + b, 0) / duracoes.length
      const variance = duracoes.reduce((s, d) => s + (d - avg) ** 2, 0) / duracoes.length
      const stdDev = Math.sqrt(variance)
      if (stdDev < 3 && avg < 30) {
        score -= 15; alertas.push('Intervalo entre respostas muito regular (padrão robótico)')
      }
    }
  }

  // 3. Tudo marcado "ok"
  const respostas = itens.filter(i => i.resposta)
  if (respostas.length >= 15 && respostas.every(i => i.resposta === 'ok')) {
    score -= 10; alertas.push('Todos os itens marcados como OK (nenhum problema reportado)')
  }

  // 4. Sem observações
  if (respostas.length >= 15 && !itens.some(i => i.observacao?.trim())) {
    score -= 5; alertas.push('Nenhuma observação em nenhum item')
  }

  // 5. Fotos com mesmo tamanho (duplicadas)
  const tamanhos = itens.filter(i => i.foto_tamanho).map(i => i.foto_tamanho)
  const tamSet = new Map<number, number>()
  for (const t of tamanhos) {
    const rounded = Math.round(t / 1024) // arredonda para KB
    tamSet.set(rounded, (tamSet.get(rounded) || 0) + 1)
  }
  const duplicatas = [...tamSet.values()].filter(v => v > 1).reduce((s, v) => s + v - 1, 0)
  if (duplicatas > 0) {
    score -= Math.min(30, duplicatas * 15)
    alertas.push(`${duplicatas} foto(s) com tamanho idêntico (possível reutilização)`)
  }

  // 9. GPS não mudou
  if (checklist.loc_inicio && checklist.loc_fim) {
    const lat1 = checklist.loc_inicio.lat, lng1 = checklist.loc_inicio.lng
    const lat2 = checklist.loc_fim.lat, lng2 = checklist.loc_fim.lng
    if (lat1 && lat2 && lng1 && lng2) {
      const dist = Math.sqrt((lat2 - lat1) ** 2 + (lng2 - lng1) ** 2) * 111000
      if (dist < 5) {
        score -= 10; alertas.push('Posição GPS não mudou durante o checklist')
      }
    }
  }

  // 10. Horário suspeito
  if (checklist.inicio_em) {
    const hora = new Date(checklist.inicio_em).getHours()
    if (hora < 6 || hora >= 22) {
      score -= 5; alertas.push('Checklist realizado fora do horário comercial')
    }
  }

  return { score: Math.max(0, score), alertas }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''

    // FormData (salvar_item com foto)
    if (contentType.includes('multipart/form-data')) {
      const fd = await req.formData()
      const action = fd.get('action') as string
      if (action !== 'salvar_item') return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })

      const checklistId = fd.get('checklist_id') as string
      const itemKey = fd.get('item_key') as string
      const resposta = fd.get('resposta') as string
      const observacao = (fd.get('observacao') as string) || ''
      const foto = fd.get('foto') as File | null
      const categoria = fd.get('categoria') as string
      const titulo = fd.get('titulo') as string

      let fotoUrl: string | null = null
      let fotoTamanho: number | null = null

      if (foto) {
        const ext = foto.name.split('.').pop() || 'jpg'
        const path = `checklist/${checklistId}/${itemKey}.${ext}`
        const buffer = Buffer.from(await foto.arrayBuffer())
        fotoTamanho = buffer.length

        const { error: upErr } = await supabase.storage
          .from('mecanico-files')
          .upload(path, buffer, { upsert: true, contentType: foto.type })
        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

        const { data: urlData } = supabase.storage.from('mecanico-files').getPublicUrl(path)
        fotoUrl = urlData.publicUrl
      }

      // Upsert item
      const { data: existing } = await supabase
        .from('veiculo_checklist_itens')
        .select('id')
        .eq('checklist_id', checklistId)
        .eq('item_key', itemKey)
        .maybeSingle()

      if (existing) {
        await supabase.from('veiculo_checklist_itens').update({
          resposta, observacao, foto_url: fotoUrl, foto_tamanho: fotoTamanho,
          respondido_em: new Date().toISOString(),
        }).eq('id', existing.id)
      } else {
        await supabase.from('veiculo_checklist_itens').insert({
          checklist_id: checklistId, item_key: itemKey, categoria, titulo,
          resposta, observacao, foto_url: fotoUrl, foto_tamanho: fotoTamanho,
          respondido_em: new Date().toISOString(),
        })
      }

      // Update checklist status
      await supabase.from('veiculo_checklist')
        .update({ status: 'em_andamento' })
        .eq('id', checklistId)
        .eq('status', 'pendente')

      return NextResponse.json({ ok: true, foto_url: fotoUrl })
    }

    // JSON actions
    const body = await req.json()
    const { action } = body

    // Verificar se precisa fazer checklist (para bloqueio)
    if (action === 'verificar') {
      const { tecnico_nome } = body
      if (!tecnico_nome) return NextResponse.json({ pendente: false })

      const hoje = new Date()
      const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
      const mesRef = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`

      // Só bloqueia a partir do dia 1 do mês seguinte
      const { data } = await supabase
        .from('veiculo_checklist')
        .select('id, status, score_confianca')
        .eq('tecnico_nome', tecnico_nome)
        .eq('mes_referencia', mesRef)
        .maybeSingle()

      const pendente = !data || (data.status !== 'completo' && data.status !== 'suspeito')

      // Também verificar se tem veículo atribuído
      const { data: veic } = await supabase
        .from('tecnico_veiculos')
        .select('placa')
        .eq('tecnico_nome', tecnico_nome)
        .maybeSingle()

      return NextResponse.json({
        pendente: veic ? pendente : false,
        mes_referencia: mesRef,
        checklist_id: data?.id || null,
      })
    }

    // Iniciar checklist
    if (action === 'iniciar') {
      const { tecnico_nome, placa } = body
      const hoje = new Date()
      const mesRef = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
      const token = randomUUID().replace(/-/g, '')

      // Verificar se já existe
      const { data: existente } = await supabase
        .from('veiculo_checklist')
        .select('id, status')
        .eq('tecnico_nome', tecnico_nome)
        .eq('mes_referencia', mesRef)
        .maybeSingle()

      if (existente) {
        if (existente.status === 'completo') {
          return NextResponse.json({ error: 'Checklist deste mês já foi concluído' }, { status: 400 })
        }
        // Retornar existente em andamento
        const { data: itens } = await supabase
          .from('veiculo_checklist_itens')
          .select('*')
          .eq('checklist_id', existente.id)
          .order('created_at')
        return NextResponse.json({ id: existente.id, itens: itens || [], items: CHECKLIST_ITEMS })
      }

      const { data, error } = await supabase
        .from('veiculo_checklist')
        .insert({
          tecnico_nome, placa, mes_referencia: mesRef,
          status: 'pendente', share_token: token,
          inicio_em: new Date().toISOString(),
          loc_inicio: body.loc || null,
        })
        .select()
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ id: data.id, itens: [], items: CHECKLIST_ITEMS })
    }

    // Concluir checklist
    if (action === 'concluir') {
      const { checklist_id, loc } = body

      const { data: checklist } = await supabase
        .from('veiculo_checklist')
        .select('*')
        .eq('id', checklist_id)
        .single()

      if (!checklist) return NextResponse.json({ error: 'Checklist não encontrado' }, { status: 404 })

      const { data: itens } = await supabase
        .from('veiculo_checklist_itens')
        .select('*')
        .eq('checklist_id', checklist_id)

      const inicio = new Date(checklist.inicio_em).getTime()
      const fim = Date.now()
      const duracao = Math.round((fim - inicio) / 1000)

      const { score, alertas } = calcularScore(
        { ...checklist, duracao_total_seg: duracao, loc_fim: loc },
        itens || [],
      )

      const status = score < 50 ? 'suspeito' : 'completo'

      await supabase.from('veiculo_checklist').update({
        status, fim_em: new Date().toISOString(),
        duracao_total_seg: duracao, score_confianca: score,
        alertas: JSON.stringify(alertas), loc_fim: loc,
      }).eq('id', checklist_id)

      return NextResponse.json({ status, score, alertas, duracao })
    }

    // Carregar (por id ou token)
    if (action === 'carregar') {
      const { id, token } = body
      let query = supabase.from('veiculo_checklist').select('*')
      if (token) query = query.eq('share_token', token)
      else query = query.eq('id', id)
      const { data: checklist } = await query.maybeSingle()
      if (!checklist) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

      const { data: itens } = await supabase
        .from('veiculo_checklist_itens')
        .select('*')
        .eq('checklist_id', checklist.id)
        .order('created_at')

      return NextResponse.json({ checklist, itens: itens || [], items: CHECKLIST_ITEMS })
    }

    // Listar do técnico
    if (action === 'listar') {
      const { tecnico_nome } = body
      const { data } = await supabase
        .from('veiculo_checklist')
        .select('id, mes_referencia, status, score_confianca, duracao_total_seg, created_at')
        .eq('tecnico_nome', tecnico_nome)
        .order('mes_referencia', { ascending: false })
        .limit(12)
      return NextResponse.json(data || [])
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
