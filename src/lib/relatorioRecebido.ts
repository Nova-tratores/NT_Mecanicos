// O SERVIDOR grava o relatório do técnico (José, 12/11/2026: "não pode depender só do celular do técnico").
// O app manda o relatório inteiro para /api/relatorio/receber no Enviar. Aqui: guarda a cópia em
// relatorios_recebidos e grava em Ordem_Servico_Tecnicos com a chave do servidor — sem depender do login do
// celular, do sinal ou da fila do aparelho. O robô de 5 min tenta de novo o que não gravou.
import { supabaseAdmin } from '@/lib/apiAuth'
import { mesmoNome, sem } from '@/lib/push-server'
import { antesDoRelatorio } from '@/lib/fasesRelatorio'

type Rec = Record<string, unknown>
const T = 'Ordem_Servico_Tecnicos'

// colunas que o app manda no relatório final (preencher/page.tsx) — nada além disso entra na tabela
const COLUNAS = new Set([
  'Ordem_Servico', 'TecResp1', 'TemTec', 'TecResp2', 'Motivo', 'ServicoRealizado', 'TipoServico', 'TipoRev', 'Projeto',
  'Chassis', 'Marca', 'Modelo', 'Garantia', 'Horimetro', 'NumPlaca', 'TratorLocal1', 'TratorLocal2', 'NomResp', 'Fazenda',
  'Cidade', 'TotalHora', 'TotalKm', 'DataInicio', 'DataFinal', 'InicioHora', 'FinalHora', 'InicioKm', 'FinalKm',
  'AdicionarData2', 'DataInicio2', 'InicioHora2', 'FinalHora2', 'InicioKm2', 'FinalKm2', 'AdicionarData3', 'DataInicio3',
  'InicioHora3', 'FinaHora3', 'InicioKm3', 'FinalKm3', 'DiasExecucao', 'FotoHorimetro', 'FotoChassis', 'FotoFrente',
  'FotoDireita', 'FotoEsquerda', 'FotoTraseira', 'FotoVolante', 'FotoFalha1', 'FotoFalha2', 'FotoFalha3', 'FotoFalha4',
  'FotoPecaNova1', 'FotoPecaNova2', 'FotoPecaInstalada1', 'FotoPecaInstalada2', 'FotoExtra1', 'FotoExtra2', 'FotoExtra3',
  'FotoExtra4', 'FotoExtra5', 'FotosExtras', 'AlmocosFotos', 'TemAlmoco', 'ValorAlmoco', 'FotoAlmoco', 'AssCliente',
  'AssTecnico', 'PecasInfo', 'JustificativaPecaExtra', 'Data', 'Status', 'pdf_criado',
])

/** a OS é deste técnico? (Os_Tecnico ou Os_Tecnico2, com "A / B", "A e B"…) */
function tecnicoDaOS(os: Rec, nomes: string[]): boolean {
  const campos = [os.Os_Tecnico, os.Os_Tecnico2].map((c) => String(c ?? '').trim()).filter(Boolean)
  const partes = campos.flatMap((c) => [c, ...c.split(/\s*(?:\/\/|\/|&|,|;|\s+e\s+)\s*/i)])
  return nomes.some((n) => partes.some((p) => sem(p) === sem(n) || mesmoNome(p, n)))
}

/** foto que ainda veio em base64 (celular sem sinal ao subir): o servidor sobe para o storage */
async function subirBase64(valor: string, os: string, campo: string): Promise<string> {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(valor)
  if (!m) return ''
  const tipo = m[1] || 'image/jpeg'
  const ext = tipo.includes('png') ? 'png' : tipo.includes('mp4') ? 'mp4' : tipo.includes('quicktime') ? 'mov' : 'jpg'
  const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
  const caminho = `os-tecnicos/${os}/${campo}_srv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const sb = supabaseAdmin()
  const { error } = await sb.storage.from('requisicoes').upload(caminho, bytes, { contentType: tipo })
  if (error) throw new Error(`foto ${campo} não subiu: ${error.message}`)
  return sb.storage.from('requisicoes').getPublicUrl(caminho).data.publicUrl
}

async function resolverFotos(p: Rec, os: string): Promise<Rec> {
  const out: Rec = { ...p }
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && v.startsWith('data:')) out[k] = await subirBase64(v, os, k)
    else if (typeof v === 'string' && v.startsWith('blob:')) out[k] = ''
  }
  if (Array.isArray(out.FotosExtras)) {
    out.FotosExtras = (await Promise.all((out.FotosExtras as unknown[]).map(async (f, i) =>
      typeof f === 'string' && f.startsWith('data:') ? subirBase64(f, os, `FotoExtra${i + 1}`) : f))).filter((f) => typeof f === 'string' && f && !f.startsWith('blob:'))
    const ex = out.FotosExtras as string[]
    for (let i = 0; i < 5; i++) out[`FotoExtra${i + 1}`] = ex[i] || ''
  }
  if (Array.isArray(out.AlmocosFotos)) {
    out.AlmocosFotos = await Promise.all((out.AlmocosFotos as Rec[]).map(async (a) =>
      typeof a?.foto === 'string' && a.foto.startsWith('data:') ? { ...a, foto: await subirBase64(a.foto, os, `FotoAlmoco_${a.data}`) } : a))
    const primeira = (out.AlmocosFotos as Rec[])[0]
    if (primeira) out.FotoAlmoco = primeira.foto ?? null
  }
  return out
}

export type Aplicado = { ok: true; idOs: number; jaEstava?: boolean } | { ok: false; erro: string }

/**
 * Grava o relatório final em Ordem_Servico_Tecnicos (um por OS) e sobe a fase da OS como a tela faria.
 * Mesma regra da tela: update na linha da OS se existe, senão insert; fase só sobe se a OS está antes do relatório.
 */
export async function aplicarRelatorio(os: string, payloadBruto: Rec): Promise<Aplicado> {
  const sb = supabaseAdmin()
  const limpo: Rec = {}
  for (const [k, v] of Object.entries(payloadBruto)) if (COLUNAS.has(k)) limpo[k] = v
  limpo.Ordem_Servico = os
  limpo.Status = 'enviado'
  let dados: Rec
  try { dados = await resolverFotos(limpo, os) } catch (e) { return { ok: false, erro: (e as Error).message } }

  const { data: linhas, error: eBusca } = await sb.from(T).select('IdOs, Status, Data, pdf_criado').eq('Ordem_Servico', os).limit(20)
  if (eBusca) return { ok: false, erro: eBusca.message }
  const alvo = ((linhas || []) as Rec[]).sort((a, b) =>
    (b.Status === 'enviado' ? 1 : 0) - (a.Status === 'enviado' ? 1 : 0) || Number(b.IdOs) - Number(a.IdOs))[0]

  let idOs: number
  if (alvo?.IdOs) {
    // o mesmo envio chegando de novo (fila do celular + servidor): não apaga o PDF que já foi anexado
    if (alvo.Status === 'enviado' && alvo.pdf_criado && sem(alvo.Data) === sem(dados.Data)) delete dados.pdf_criado
    const r = await sb.from(T).update(dados).eq('IdOs', alvo.IdOs as number).select('IdOs')
    if (r.error) return { ok: false, erro: r.error.message }
    if (!r.data?.length) return { ok: false, erro: 'nenhuma linha alterada' }
    idOs = Number(alvo.IdOs)
  } else {
    const r = await sb.from(T).insert(dados).select('IdOs')
    if (r.error) return { ok: false, erro: r.error.message }
    idOs = Number((r.data?.[0] as Rec | undefined)?.IdOs)
  }

  // fase da OS + garantia na OS mãe (igual à tela). Falha aqui não desfaz o relatório gravado.
  try {
    const { data: o } = await sb.from('Ordem_Servico').select('Status, ID_PPV').eq('Id_Ordem', os).maybeSingle()
    const upd: Rec = {}
    const antes = antesDoRelatorio((o as Rec | null)?.Status)
    if (antes) upd.Status = 'Relatório Concluído'
    if (String(dados.TipoServico || '').includes('Garantia')) upd.Tipo_Servico = dados.TipoServico
    if (Object.keys(upd).length) await sb.from('Ordem_Servico').update(upd).eq('Id_Ordem', os)
    const ppv = String((o as Rec | null)?.ID_PPV || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (antes && ppv.length) {
      await sb.from('pedidos').update({ status: 'Aguardando Para Faturar' }).in('id_pedido', ppv).not('status', 'in', '("Fechado","Cancelado")')
    }
  } catch (e) { console.warn('[relatorio] fase da OS não atualizou:', os, e instanceof Error ? e.message : e) }

  return { ok: true, idOs }
}

/** guarda a cópia e grava. Devolve o resultado para o celular. */
export async function receberRelatorio(args: {
  os: string; payload: Rec; tecnicoNome: string; nomes: string[]; isAdmin: boolean; userId: string; tokenVencido: boolean
}): Promise<{ id: number | null } & Aplicado> {
  const sb = supabaseAdmin()
  const { data: copia, error: eCopia } = await sb.from('relatorios_recebidos').insert({
    ordem_servico: args.os, tecnico_nome: args.tecnicoNome, user_id: args.userId,
    token_vencido: args.tokenVencido, payload: args.payload,
  }).select('id').maybeSingle()
  const id = (copia as { id?: number } | null)?.id ?? null
  if (eCopia) console.warn('[relatorio] cópia não gravou:', args.os, eCopia.message)

  const { data: os } = await sb.from('Ordem_Servico').select('Os_Tecnico, Os_Tecnico2').eq('Id_Ordem', args.os).maybeSingle()
  let r: Aplicado
  if (!os) r = { ok: false, erro: `OS ${args.os} não existe` }
  else if (!args.isAdmin && !tecnicoDaOS(os as Rec, args.nomes)) r = { ok: false, erro: 'a OS não está no nome deste técnico' }
  else r = await aplicarRelatorio(args.os, args.payload)

  if (id) {
    await sb.from('relatorios_recebidos').update(r.ok
      ? { aplicado_em: new Date().toISOString(), id_os: r.idOs, erro: null }
      : { erro: r.erro }).eq('id', id)
  }
  if (!r.ok) console.warn('[relatorio] não gravou', args.os, '—', r.erro)
  return { id, ...r }
}

/** robô (5 min): o que chegou e não gravou (banco fora, foto que não subiu) tenta de novo por 7 dias */
export async function reaplicarPendentes(): Promise<string> {
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('relatorios_recebidos')
    .select('id, ordem_servico, payload, erro, recebido_em')
    .is('aplicado_em', null)
    .gte('recebido_em', new Date(Date.now() - 7 * 86400_000).toISOString())
    .order('id', { ascending: true }).limit(20)
  if (error) return error.message.includes('relatorios_recebidos') ? '' : `relatórios: ${error.message}`
  let ok = 0
  for (const c of (data || []) as Rec[]) {
    // a OS não é dele: não insiste (fica para o escritório ver)
    if (String(c.erro || '').includes('não está no nome')) continue
    // já entrou por outro envio mais novo da mesma OS? então este está resolvido
    const { data: maisNovo } = await sb.from('relatorios_recebidos').select('id').eq('ordem_servico', c.ordem_servico as string)
      .gt('id', c.id as number).not('aplicado_em', 'is', null).limit(1)
    if (maisNovo?.length) { await sb.from('relatorios_recebidos').update({ aplicado_em: new Date().toISOString(), erro: 'substituído por envio mais novo' }).eq('id', c.id as number); continue }
    const r = await aplicarRelatorio(String(c.ordem_servico), c.payload as Rec)
    await sb.from('relatorios_recebidos').update(r.ok ? { aplicado_em: new Date().toISOString(), id_os: r.idOs, erro: null } : { erro: r.erro }).eq('id', c.id as number)
    if (r.ok) ok++
  }
  return ok ? `relatórios regravados pelo servidor: ${ok}` : ''
}
