'use client'
import { supabase } from '../supabase'
import { BUCKET_GARANTIAS, STATUS_FINALIZADOS } from './constants'
import type {
  Garantia, GarantiaDetalhe, GarantiaResumo, OSElegivel, PecaOS,
} from './types'

// ─── Notificações ────────────────────────────────────────────────────────────

async function notificarGarantistas(params: { titulo: string; descricao?: string; link?: string }) {
  try {
    const { data: users } = await supabase
      .from('portal_permissoes')
      .select('user_id, is_admin, modulos_permitidos')
    if (!users || users.length === 0) return
    const destinatarios = users
      .filter((u: any) => u.is_admin || (u.modulos_permitidos || []).includes('garantias'))
      .map((u: any) => u.user_id)
      .filter(Boolean)
    if (destinatarios.length === 0) return
    await supabase.from('portal_notificacoes').insert(
      destinatarios.map((user_id) => ({
        user_id,
        tipo: 'garantia',
        titulo: params.titulo,
        descricao: params.descricao || null,
        link: params.link || '/garantias',
      }))
    )
  } catch (err) {
    console.error('[garantias] notificarGarantistas erro:', err)
  }
}

async function registrarEvento(garantiaId: string, params: {
  tipo: string
  statusAnterior?: string | null
  statusNovo?: string | null
  ator?: string | null
  detalhe?: string | null
}) {
  try {
    await supabase.from('garantia_eventos').insert({
      garantia_id: garantiaId,
      tipo: params.tipo,
      status_anterior: params.statusAnterior ?? null,
      status_novo: params.statusNovo ?? null,
      ator: params.ator ?? null,
      detalhe: params.detalhe ?? null,
    })
  } catch (err) {
    console.error('[garantias] registrarEvento erro:', err)
  }
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

export async function listarMinhasGarantias(tecnicoNome: string): Promise<GarantiaResumo[]> {
  if (!tecnicoNome) return []
  const { data, error } = await supabase
    .from('garantias')
    .select(
      '*, montadora:garantia_montadoras(id,nome,cor), pecas:garantia_pecas(id), pendencias:garantia_pendencias(id,tipo,status,descricao,exige_visita), anexos:garantia_anexos(id,categoria,url,nome_arquivo,created_at)'
    )
    .eq('tecnico_nome', tecnicoNome)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[garantias] listarMinhasGarantias:', error.message)
    return []
  }
  return (data as GarantiaResumo[]) || []
}

export async function obterGarantia(id: string): Promise<GarantiaDetalhe | null> {
  const { data: g, error } = await supabase
    .from('garantias')
    .select('*, montadora:garantia_montadoras(*)')
    .eq('id', id)
    .maybeSingle()
  if (error || !g) return null

  const [pecas, pend, anex] = await Promise.all([
    supabase.from('garantia_pecas').select('*').eq('garantia_id', id).order('created_at'),
    supabase.from('garantia_pendencias').select('*').eq('garantia_id', id).order('created_at'),
    supabase.from('garantia_anexos').select('*').eq('garantia_id', id).order('created_at'),
  ])

  return {
    ...(g as any),
    pecas: pecas.data || [],
    pendencias: pend.data || [],
    anexos: anex.data || [],
  } as GarantiaDetalhe
}

// ─── OS elegíveis ────────────────────────────────────────────────────────────

export async function listarOSElegiveis(tecnicoNome: string): Promise<OSElegivel[]> {
  if (!tecnicoNome) return []

  const { data: ordens } = await supabase
    .from('Ordem_Servico')
    .select('Id_Ordem, Os_Cliente, Data, Tipo_Servico, Serv_Solicitado, Status')
    .or(`Os_Tecnico.eq.${tecnicoNome},Os_Tecnico2.eq.${tecnicoNome}`)
    .neq('Status', 'Cancelada')
    .order('Data', { ascending: false })
    .limit(120)

  const ids = (ordens || []).map((o: any) => o.Id_Ordem)
  if (ids.length === 0) return []

  // OS com garantia ativa não entram
  const { data: garativas } = await supabase
    .from('garantias')
    .select('id_ordem')
    .in('id_ordem', ids)
    .not('status', 'in', `(${STATUS_FINALIZADOS.join(',')})`)
  const comGarantia = new Set((garativas || []).map((g: any) => g.id_ordem))

  // Chassi do relatório técnico (lookup)
  const { data: tecs } = await supabase
    .from('Ordem_Servico_Tecnicos')
    .select('Ordem_Servico, Chassis')
    .in('Ordem_Servico', ids)
  const chassiPorOS: Record<string, string> = {}
  ;(tecs || []).forEach((t: any) => {
    if (t.Ordem_Servico) chassiPorOS[t.Ordem_Servico] = t.Chassis || ''
  })

  return (ordens || [])
    .filter((o: any) => !comGarantia.has(o.Id_Ordem))
    .map((o: any) => ({
      id_ordem: o.Id_Ordem,
      cliente: o.Os_Cliente || '',
      chassis: chassiPorOS[o.Id_Ordem] || null,
      data: o.Data || '',
      tipo_servico: o.Tipo_Servico || '',
      serv_solicitado: o.Serv_Solicitado || '',
    }))
}

// ─── Peças da OS (PPV + manuais do relatório técnico) ────────────────────────

export async function listarPecasOS(osId: string): Promise<PecaOS[]> {
  if (!osId) return []
  const pecas: PecaOS[] = []

  // 1) Peças do PPV via movimentacoes
  const { data: osRow } = await supabase
    .from('Ordem_Servico')
    .select('ID_PPV')
    .eq('Id_Ordem', osId)
    .maybeSingle()

  const ppvIds = String((osRow as any)?.ID_PPV || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (ppvIds.length > 0) {
    const { data: itens } = await supabase.from('movimentacoes').select('*').in('Id_PPV', ppvIds)
    const resumo: Record<string, { descricao: string; qtde: number; totalFin: number; ppv: string }> = {}
    ;(itens || []).forEach((item: any) => {
      const cod = String(item.CodProduto || '')
      const tipo = String(item.TipoMovimento || '').toLowerCase()
      const preco = parseFloat(item.Preco || 0)
      let qtd = Math.abs(parseFloat(item.Qtde || 0))
      if (tipo.includes('devolu')) qtd = -qtd
      if (!resumo[cod]) resumo[cod] = { descricao: item.Descricao || cod, qtde: 0, totalFin: 0, ppv: String(item.Id_PPV || '') }
      resumo[cod].qtde += qtd
      resumo[cod].totalFin += preco * qtd
    })
    Object.entries(resumo).forEach(([cod, p]) => {
      if (p.qtde !== 0) {
        pecas.push({
          cod_produto: cod || null,
          descricao: p.descricao,
          quantidade: p.qtde,
          preco_unitario: p.qtde !== 0 ? p.totalFin / p.qtde : 0,
          origem: 'ppv',
          fonte_ppv_id: p.ppv || null,
        })
      }
    })
  }

  // 2) Peças manuais do relatório técnico (PecasInfo JSON)
  const { data: tec } = await supabase
    .from('Ordem_Servico_Tecnicos')
    .select('PecasInfo')
    .eq('Ordem_Servico', osId)
    .maybeSingle()
  if ((tec as any)?.PecasInfo) {
    try {
      const arr = JSON.parse((tec as any).PecasInfo)
      if (Array.isArray(arr)) {
        arr.filter((p) => p && p.origem === 'manual').forEach((p) => {
          pecas.push({
            cod_produto: p.codigo || null,
            descricao: p.descricao || 'Peça',
            quantidade: Number(p.quantidade) || 1,
            preco_unitario: Number(p.preco) || 0,
            origem: 'pecasinfo_manual',
            fonte_ppv_id: null,
          })
        })
      }
    } catch { /* ignora PecasInfo inválido */ }
  }

  return pecas
}

// ─── Criação ─────────────────────────────────────────────────────────────────

export interface CriarGarantiaInput {
  id_ordem: string
  tecnico_nome: string
  tecnico_horas: number | string
  tecnico_km: number | string
  tecnico_obs?: string
  pecas: PecaOS[]
}

export async function criarGarantia(input: CriarGarantiaInput): Promise<{ garantia?: Garantia; erro?: string }> {
  const { id_ordem, tecnico_nome, pecas } = input
  if (!id_ordem || !tecnico_nome) return { erro: 'OS e técnico são obrigatórios.' }
  if (!pecas || pecas.length === 0) return { erro: 'Selecione ao menos uma peça para a garantia.' }

  // Checa se já existe garantia ativa para essa OS (UI friendly check antes do índice)
  const { data: existente } = await supabase
    .from('garantias')
    .select('numero, status')
    .eq('id_ordem', id_ordem)
    .not('status', 'in', `(${STATUS_FINALIZADOS.join(',')})`)
    .limit(1)
  if (existente && existente.length > 0) {
    return { erro: `Já existe uma garantia ativa para a OS ${id_ordem} (${(existente[0] as any).numero}).` }
  }

  // Snapshot da OS
  const { data: osRow } = await supabase
    .from('Ordem_Servico')
    .select('Os_Cliente, Projeto, ID_PPV')
    .eq('Id_Ordem', id_ordem)
    .maybeSingle()
  const { data: tecRow } = await supabase
    .from('Ordem_Servico_Tecnicos')
    .select('Chassis')
    .eq('Ordem_Servico', id_ordem)
    .maybeSingle()

  const { data: garantia, error } = await supabase
    .from('garantias')
    .insert({
      id_ordem,
      tecnico_nome,
      cliente: (osRow as any)?.Os_Cliente || null,
      modelo: (osRow as any)?.Projeto || null,
      chassis: (tecRow as any)?.Chassis || null,
      ppv_ids: (osRow as any)?.ID_PPV || null,
      tecnico_horas: Number(input.tecnico_horas) || 0,
      tecnico_km: Number(input.tecnico_km) || 0,
      tecnico_obs: input.tecnico_obs || null,
      status: 'aberta',
    })
    .select()
    .single()

  if (error || !garantia) {
    if (error?.code === '23505') {
      return { erro: 'Já existe uma garantia ativa para esta OS.' }
    }
    console.error('[garantias] criarGarantia:', error?.message)
    return { erro: 'Não foi possível criar a garantia.' }
  }

  // Peças
  await supabase.from('garantia_pecas').insert(
    pecas.map((p) => ({
      garantia_id: (garantia as any).id,
      cod_produto: p.cod_produto,
      descricao: p.descricao,
      quantidade: p.quantidade,
      preco_unitario: p.preco_unitario,
      origem: p.origem,
      fonte_ppv_id: p.fonte_ppv_id,
    }))
  )

  await registrarEvento((garantia as any).id, {
    tipo: 'criada',
    statusNovo: 'aberta',
    ator: tecnico_nome,
    detalhe: `Garantia ${(garantia as any).numero} solicitada para a OS ${id_ordem}`,
  })
  await notificarGarantistas({
    titulo: `Nova requisição de garantia — ${(garantia as any).numero}`,
    descricao: `${tecnico_nome} solicitou garantia na OS ${id_ordem}`,
    link: `/garantias?id=${(garantia as any).id}`,
  })

  return { garantia: garantia as Garantia }
}

// ─── Resposta a pendência (B.O. ou pendência da fábrica) ─────────────────────

export interface ResponderPendenciaInput {
  garantiaId: string
  pendenciaId: string
  texto: string
  imagens: File[]
  tecnicoNome: string
}

function sanitize(name: string) {
  return name
    .normalize('NFD')
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9.\-_]/g, '')
}

export async function responderPendencia(
  input: ResponderPendenciaInput,
): Promise<{ ok: boolean; erro?: string }> {
  const { garantiaId, pendenciaId, texto, imagens, tecnicoNome } = input
  if (!texto.trim() && imagens.length === 0) {
    return { ok: false, erro: 'Responda com um texto ou anexe ao menos uma imagem.' }
  }

  // Carrega pendência e garantia para validar e definir transição
  const { data: pend } = await supabase
    .from('garantia_pendencias')
    .select('*')
    .eq('id', pendenciaId)
    .eq('garantia_id', garantiaId)
    .maybeSingle()
  if (!pend) return { ok: false, erro: 'Pendência não encontrada.' }
  if ((pend as any).status !== 'aberta') return { ok: false, erro: 'Esta pendência já foi respondida.' }

  const { data: g } = await supabase
    .from('garantias')
    .select('id, numero, id_ordem')
    .eq('id', garantiaId)
    .maybeSingle()
  if (!g) return { ok: false, erro: 'Garantia não encontrada.' }

  // Upload de imagens -> bucket garantias -> grava em garantia_anexos
  const anexoIds: string[] = []
  for (const img of imagens) {
    try {
      const ext = img.name.split('.').pop() || 'jpg'
      const path = `${garantiaId}/pendencia_resposta/${Date.now()}_${sanitize(img.name) || `foto.${ext}`}`
      const { error: upErr } = await supabase.storage
        .from(BUCKET_GARANTIAS)
        .upload(path, img, { contentType: img.type || 'image/jpeg', upsert: true })
      if (upErr) {
        console.error('[garantias] upload erro:', upErr.message)
        continue
      }
      const { data: pub } = supabase.storage.from(BUCKET_GARANTIAS).getPublicUrl(path)
      const { data: anexo } = await supabase
        .from('garantia_anexos')
        .insert({
          garantia_id: garantiaId,
          pendencia_id: pendenciaId,
          categoria: 'pendencia_resposta',
          url: pub.publicUrl,
          nome_arquivo: img.name,
          content_type: img.type || null,
          enviado_por: tecnicoNome,
        })
        .select()
        .single()
      if (anexo) anexoIds.push((anexo as any).id)
    } catch (err) {
      console.error('[garantias] falha ao enviar imagem:', err)
    }
  }

  // Fecha a pendência
  const { error: pendErr } = await supabase
    .from('garantia_pendencias')
    .update({
      status: 'respondida',
      resposta_texto: texto || null,
      respondido_por: tecnicoNome,
      respondido_em: new Date().toISOString(),
    })
    .eq('id', pendenciaId)
  if (pendErr) return { ok: false, erro: 'Falha ao salvar a resposta.' }

  // Volta status da garantia ao fluxo
  const tipo = (pend as any).tipo
  const novoStatus = tipo === 'bo' ? 'em_analise' : 'enviada'
  await supabase
    .from('garantias')
    .update({ status: novoStatus, updated_at: new Date().toISOString() })
    .eq('id', garantiaId)

  await registrarEvento(garantiaId, {
    tipo: tipo === 'bo' ? 'bo_respondida' : 'info_respondida',
    statusAnterior: tipo === 'bo' ? 'bo_tecnico' : 'info_pendente',
    statusNovo: novoStatus,
    ator: tecnicoNome,
    detalhe: texto || `Resposta com ${anexoIds.length} anexo(s)`,
  })
  await notificarGarantistas({
    titulo: `Técnico respondeu — garantia ${(g as any).numero}`,
    descricao: `${tecnicoNome} respondeu a pendência da OS ${(g as any).id_ordem}.`,
    link: `/garantias?id=${garantiaId}`,
  })

  return { ok: true }
}
