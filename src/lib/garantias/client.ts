'use client'
import { supabase } from '../supabase'
import { offlineGet, offlineSet } from '../offlineCache'
import { comprimirImagem } from '../imagem'
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

export interface ListaGarantias {
  lista: GarantiaResumo[]
  /** 'rede' veio agora; 'cache' sem internet/erro, mostrando o guardado; 'erro' sem nada guardado */
  origem: 'rede' | 'cache' | 'erro'
  erro?: string
}

function pareceRede(err: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const m = String((err as { message?: string })?.message || err || '').toLowerCase()
  return /fetch|network|load failed|timeout|aborted/.test(m)
}

// Erro de rede não vira "nenhuma garantia" (José, 23/10/2026): devolve o que está guardado no celular e avisa.
export async function listarMinhasGarantias(tecnicoNome: string): Promise<ListaGarantias> {
  if (!tecnicoNome) return { lista: [], origem: 'rede' }
  const chave = `garantias-lista:${tecnicoNome.toUpperCase()}`
  const doCache = async (erro: string): Promise<ListaGarantias> => {
    const salvo = await offlineGet<GarantiaResumo[]>(chave)
    if (salvo) return { lista: salvo, origem: 'cache', erro }
    // prefetch guarda as garantias sem os detalhes (pendências/anexos) — melhor que nada
    const pre = await offlineGet<GarantiaResumo[]>('prefetch:garantias')
    if (pre && pre.length) return { lista: pre, origem: 'cache', erro }
    return { lista: [], origem: 'erro', erro }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return doCache('Sem internet')
  try {
    const { data, error } = await supabase
      .from('garantias')
      .select(
        '*, montadora:garantia_montadoras(id,nome,cor), pecas:garantia_pecas(id), pendencias:garantia_pendencias(id,tipo,status,descricao,exige_visita), anexos:garantia_anexos(id,categoria,url,nome_arquivo,created_at)'
      )
      // Match case-insensitive: a garantia pode ter sido gravada com o nome do
      // técnico em caixa diferente (ex.: "PAULO MOTTA" do Tecnicos_Appsheet) do
      // que o app resolve pro logado ("Paulo Motta" de mecanico_tecnico_nome).
      .ilike('tecnico_nome', tecnicoNome)
      .order('created_at', { ascending: false })
    if (error) throw error
    const lista = (data as GarantiaResumo[]) || []
    offlineSet(chave, lista).catch(() => {})
    return { lista, origem: 'rede' }
  } catch (err) {
    console.error('[garantias] listarMinhasGarantias:', (err as Error)?.message || err)
    return doCache(pareceRede(err) ? 'Sem internet' : `Erro ao carregar: ${(err as Error)?.message || err}`)
  }
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
    // Case-insensitive: as OSes guardam o técnico como "PAULO MOTTA" (caixa alta),
    // mas o app resolve o logado como "Paulo Motta" — .eq não bateria.
    .or(`Os_Tecnico.ilike.${tecnicoNome},Os_Tecnico2.ilike.${tecnicoNome}`)
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

  // 2) Requisições vinculadas à OS (tabela Requisicao)
  const { data: reqs } = await supabase
    .from('Requisicao')
    .select('id, titulo, valor_cobrado_cliente') // Requisicao não tem coluna quantidade
    .eq('ordem_servico', osId)
    .not('status', 'in', '("lixeira","cancelada")')
  for (const r of ((reqs || []) as any[])) {
    const titulo = String(r.titulo || '').trim()
    if (!titulo) continue
    const valor = parseFloat(r.valor_cobrado_cliente || '0')
    const qtd = parseFloat(r.quantidade || '1') || 1
    pecas.push({
      cod_produto: `REQ-${r.id}`,
      descricao: titulo,
      quantidade: qtd,
      preco_unitario: qtd > 0 ? valor / qtd : valor,
      origem: 'pecasinfo_manual',
      fonte_ppv_id: null,
    })
  }

  // 3) Peças manuais do relatório técnico (PecasInfo JSON)
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
  // pecas opcional — garantia pode ser só de mão de obra/deslocamento.

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

  // Peças (opcional — pode ser garantia só de mão de obra)
  if (pecas && pecas.length > 0) {
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
  }

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
    return { ok: false, erro: 'Responda com um texto ou anexe ao menos uma foto/vídeo.' }
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, erro: 'Sem internet. Sua resposta fica guardada aqui — envie quando tiver sinal.' }
  }

  // Carrega pendência e garantia para validar e definir transição
  const { data: pend, error: pendLerErr } = await supabase
    .from('garantia_pendencias')
    .select('*')
    .eq('id', pendenciaId)
    .eq('garantia_id', garantiaId)
    .maybeSingle()
  if (pendLerErr) {
    return { ok: false, erro: pareceRede(pendLerErr) ? 'Sem internet. Sua resposta fica guardada aqui — envie quando tiver sinal.' : `Erro: ${pendLerErr.message}` }
  }
  if (!pend) return { ok: false, erro: 'Pendência não encontrada.' }
  if ((pend as any).status !== 'aberta') return { ok: false, erro: 'Esta pendência já foi respondida.' }

  const { data: g } = await supabase
    .from('garantias')
    .select('id, numero, id_ordem')
    .eq('id', garantiaId)
    .maybeSingle()
  if (!g) return { ok: false, erro: 'Garantia não encontrada.' }

  // Upload de imagens -> bucket garantias -> grava em garantia_anexos.
  // Regra (José, 23/10/2026): se alguma foto/vídeo não subir, NÃO fecha a pendência — diz quais falharam.
  // Foto sai comprimida (~1600 px); vídeo vai como está.
  const subidos: { path: string; url: string; nome: string; tipo: string | null }[] = []
  const falharam: string[] = []
  for (let i = 0; i < imagens.length; i++) {
    const img = imagens[i]
    const nome = img.name || `arquivo ${i + 1}`
    try {
      const arq = img.type?.startsWith('image/') ? await comprimirImagem(img) : img
      const tipo = arq.type || img.type || 'image/jpeg'
      const base = sanitize(nome).replace(/\.[^.]+$/, '') || 'foto'
      const ext = tipo === 'image/jpeg' ? 'jpg' : (nome.split('.').pop() || 'jpg')
      const path = `${garantiaId}/pendencia_resposta/${Date.now()}_${i}_${base}.${ext}`
      const { error: upErr } = await supabase.storage
        .from(BUCKET_GARANTIAS)
        .upload(path, arq, { contentType: tipo, upsert: true })
      if (upErr) {
        console.error('[garantias] upload erro:', upErr.message)
        falharam.push(nome)
        continue
      }
      const { data: pub } = supabase.storage.from(BUCKET_GARANTIAS).getPublicUrl(path)
      subidos.push({ path, url: pub.publicUrl, nome, tipo })
    } catch (err) {
      console.error('[garantias] falha ao enviar imagem:', err)
      falharam.push(nome)
    }
  }
  if (falharam.length > 0) {
    // limpa o que subiu para não ficar arquivo solto; a resposta continua no aparelho
    if (subidos.length) await supabase.storage.from(BUCKET_GARANTIAS).remove(subidos.map((s) => s.path)).catch(() => {})
    const semRede = typeof navigator !== 'undefined' && !navigator.onLine
    return {
      ok: false,
      erro: `${semRede ? 'Sem internet. ' : ''}Não subiu: ${falharam.join(', ')}. Nada foi enviado — tente de novo${semRede ? ' quando tiver sinal' : ''}.`,
    }
  }
  const anexoIds: string[] = []
  if (subidos.length > 0) {
    const { data: anexos, error: anErr } = await supabase
      .from('garantia_anexos')
      .insert(subidos.map((s) => ({
        garantia_id: garantiaId,
        pendencia_id: pendenciaId,
        categoria: 'pendencia_resposta',
        url: s.url,
        nome_arquivo: s.nome,
        content_type: s.tipo,
        enviado_por: tecnicoNome,
      })))
      .select('id')
    if (anErr || !anexos?.length) {
      await supabase.storage.from(BUCKET_GARANTIAS).remove(subidos.map((s) => s.path)).catch(() => {})
      return { ok: false, erro: `Os anexos não foram registrados${anErr ? ` (${anErr.message})` : ''}. Nada foi enviado — tente de novo.` }
    }
    anexos.forEach((a: any) => anexoIds.push(a.id))
  }

  // Fecha a pendência. O `.select()` é proposital: RLS sem policy de UPDATE
  // devolve 0 linhas SEM erro — já engoliu resposta de B.O. em silêncio
  // (GAR-0025, 21/07/2026). 0 linhas atualizadas = erro visível.
  const { data: pendUpd, error: pendErr } = await supabase
    .from('garantia_pendencias')
    .update({
      status: 'respondida',
      resposta_texto: texto || null,
      respondido_por: tecnicoNome,
      respondido_em: new Date().toISOString(),
    })
    .eq('id', pendenciaId)
    .select('id')
  if (pendErr || !pendUpd?.length) {
    // desfaz os anexos desta tentativa: sem isso cada nova tentativa duplicava as fotos (José, 23/10/2026)
    if (anexoIds.length) {
      try { await supabase.from('garantia_anexos').delete().in('id', anexoIds) } catch { /* segue */ }
    }
    if (subidos.length) await supabase.storage.from(BUCKET_GARANTIAS).remove(subidos.map((s) => s.path)).catch(() => {})
    return { ok: false, erro: 'Falha ao salvar a resposta (sem permissão de escrita — avise o garantista).' }
  }

  // Volta status da garantia ao fluxo (mesma checagem anti-silêncio).
  // status_retorno vem da pendência: info_fabrica aberta durante o
  // ressarcimento volta pra ressarcimento_fabrica, não pra enviada.
  // Fallback pro comportamento antigo em pendências sem a coluna preenchida.
  const tipo = (pend as any).tipo
  const novoStatus = (pend as any).status_retorno || (tipo === 'bo' ? 'em_analise' : 'enviada')
  const { data: gUpd, error: gErr } = await supabase
    .from('garantias')
    .update({ status: novoStatus, updated_at: new Date().toISOString() })
    .eq('id', garantiaId)
    .select('id')
  if (gErr || !gUpd?.length) {
    return { ok: false, erro: 'Resposta salva, mas a garantia não mudou de fase (sem permissão — avise o garantista).' }
  }

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
