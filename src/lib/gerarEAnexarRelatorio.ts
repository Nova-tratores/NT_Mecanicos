import { diasDoRegistro, buscarRelatorioDaOS } from '@/lib/diasRelatorio'
import { supabase } from './supabase'
import { gerarPdfRelatorio } from './gerarPdfRelatorio'

/**
 * Regera o PDF do relatório a partir do registro já gravado no banco
 * (Ordem_Servico_Tecnicos) e o ANEXA na OS (ID_Relatorio_Final + pdf_criado).
 *
 * Usado ao reconectar: quando a OS é enviada offline, a fila sobe os dados, mas
 * o PDF (gerado no cliente) não é feito — então o portal fica sem o relatório
 * anexado. Esta função fecha esse buraco.
 *
 * Retorna true se anexou (ou já estava anexado), false se falhou.
 */
/** URL de foto do bucket "requisicoes" → caminho no storage. Aceita as formas usadas no app:
 *  /object/public/requisicoes/…, /object/sign/requisicoes/…, /storage/v1/object/…, /render/image/… e qualquer
 *  URL com "/requisicoes/" (antes só a pública era entendida e as outras saíam sem foto no PDF). */
export function caminhoNoStorage(url: string): string | null {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null
  const m = url.match(/\/(?:object|render\/image)\/(?:public|sign|authenticated)\/requisicoes\/(.+?)(\?|#|$)/)
  if (m) return decodeURIComponent(m[1])
  const i = url.indexOf('/requisicoes/')
  if (i >= 0) return decodeURIComponent(url.substring(i + '/requisicoes/'.length).split(/[?#]/)[0])
  return null
}

function blobParaDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

/** baixa a foto (storage sem CORS; senão fetch direto) e devolve em base64 para o PDF */
export async function downloadFotoRelatorio(url: string): Promise<string | null> {
  if (!url) return null
  if (url.startsWith('data:')) return url
  if (url.startsWith('blob:')) return null
  const path = caminhoNoStorage(url)
  if (path) {
    try {
      const { data: blob, error } = await supabase.storage.from('requisicoes').download(path)
      if (!error && blob) return await blobParaDataUrl(blob)
    } catch { /* tenta o fetch abaixo */ }
  }
  try {
    const resp = await fetch(url)
    if (resp.ok) return await blobParaDataUrl(await resp.blob())
  } catch { /* sem foto */ }
  return null
}

/** cidade do cliente (cadastro do Omie no portal — a tabela "Clientes" não existe mais) */
export async function cidadeDoCliente(cnpj?: string | null): Promise<string> {
  if (!cnpj) return ''
  try {
    const { data } = await supabase.from('portal_nt_clientes_cadastro_omie').select('cidade').eq('cnpj_cpf', cnpj).limit(1)
    return String((data?.[0] as { cidade?: string } | undefined)?.cidade || '')
  } catch { return '' }
}

/** fotos extras do relatório: FotosExtras (json) ou as colunas antigas FotoExtra1..5 */
export function fotosExtrasDoRegistro(r: Record<string, unknown>): string[] {
  let extras = r.FotosExtras as unknown
  if (typeof extras === 'string') { try { extras = JSON.parse(extras) } catch { extras = null } }
  if (Array.isArray(extras) && extras.length) return (extras as unknown[]).filter((x) => typeof x === 'string' && x) as string[]
  return ['FotoExtra1', 'FotoExtra2', 'FotoExtra3', 'FotoExtra4', 'FotoExtra5'].map((k) => String(r[k] || '')).filter(Boolean)
}

/**
 * opts.forcar: gera mesmo com pdf_criado = true (reedição: o pdf_criado antigo não pode descartar o PDF novo).
 */
export async function gerarEAnexarRelatorio(osId: string, opts: { forcar?: boolean; mexerPedidos?: boolean } = {}): Promise<boolean> {
  const { data: registro } = await buscarRelatorioDaOS(osId)
  if (!registro) return false
  if (registro.pdf_criado && !opts.forcar) return true // já anexado
  if (registro.Status && registro.Status !== 'enviado') return false // rascunho não vira PDF

  const { data: osInfo } = await supabase
    .from('Ordem_Servico')
    .select('*')
    .eq('Id_Ordem', osId)
    .maybeSingle()

  const cidade = await cidadeDoCliente(osInfo?.Cnpj_Cliente)

  const dias = diasDoRegistro(registro)
  if (dias.length === 0) dias.push({ data: '', horaInicio: '', horaFim: '', kmTotal: '' })

  const downloadFoto = downloadFotoRelatorio
  const g = (k: string) => String(registro[k] ?? '')

  let pecas: unknown[] = []
  if (registro.PecasInfo) {
    try { pecas = JSON.parse(String(registro.PecasInfo)) } catch { /* ignore */ }
  }

  const pdfBlob = await gerarPdfRelatorio({
    ordemServico: osId,
    cliente: osInfo?.Os_Cliente || '',
    endereco: osInfo?.Endereco_Cliente || '',
    cidade,
    tipoServico: g('TipoServico'),
    projeto: g('Projeto'),
    idPPV: osInfo?.ID_PPV || '',
    status: 'Enviado',
    tecResp1: g('TecResp1'),
    temTec2: !!registro.TemTec,
    tecResp2: g('TecResp2'),
    chassis: g('Chassis'),
    marca: g('Marca'),
    modelo: g('Modelo'),
    horimetro: g('Horimetro'),
    garantia: !!registro.Garantia,
    numPlaca: g('NumPlaca'),
    tratorLocal1: g('TratorLocal1'),
    tratorLocal2: g('TratorLocal2'),
    diagnostico: g('Motivo'),
    servicoRealizado: g('ServicoRealizado'),
    tipoRev: g('TipoRev'),
    dias,
    totalHora: g('TotalHora'),
    totalKm: g('TotalKm'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pecas: pecas as any,
    fotoHorimetro: g('FotoHorimetro'),
    fotoChassis: g('FotoChassis'),
    fotoFrente: g('FotoFrente'),
    fotoDireita: g('FotoDireita'),
    fotoEsquerda: g('FotoEsquerda'),
    fotoTraseira: g('FotoTraseira'),
    fotoVolante: g('FotoVolante'),
    fotoFalha1: g('FotoFalha1'),
    fotoFalha2: g('FotoFalha2'),
    fotoFalha3: g('FotoFalha3'),
    fotoFalha4: g('FotoFalha4'),
    fotoPecaNova1: g('FotoPecaNova1'),
    fotoPecaNova2: g('FotoPecaNova2'),
    fotoPecaInstalada1: g('FotoPecaInstalada1'),
    fotoPecaInstalada2: g('FotoPecaInstalada2'),
    fotosExtras: fotosExtrasDoRegistro(registro),
    assCliente: g('AssCliente'),
    assTecnico: g('AssTecnico'),
    nomResp: g('NomResp'),
    fazenda: g('Fazenda'),
    cidadeServico: g('Cidade'),
    data: g('Data'),
    apenasBlob: true,
    downloadFoto,
  })

  if (!pdfBlob) return false

  const pdfPath = `relatorios-os/${osId}/Relatorio_${osId}_${Date.now()}.pdf`
  const pdfFile = new File([pdfBlob as BlobPart], `Relatorio_${osId}.pdf`, { type: 'application/pdf' })
  const { error: upErr } = await supabase.storage.from('requisicoes').upload(pdfPath, pdfFile)
  if (upErr) return false

  const { data: urlData } = supabase.storage.from('requisicoes').getPublicUrl(pdfPath)
  const pdfUrl = urlData.publicUrl

  // confere erro e linhas: 0 linhas (sessão expirada, RLS) = falha e o PDF continua pendente (José, 23/10/2026)
  const [rOs, rTec] = await Promise.all([
    supabase.from('Ordem_Servico').update({ ID_Relatorio_Final: pdfUrl }).eq('Id_Ordem', osId).select('Id_Ordem'),
    supabase.from('Ordem_Servico_Tecnicos').update({ pdf_criado: true }).eq('Ordem_Servico', osId).eq('Status', 'enviado').select('IdOs'),
  ])
  if (rOs.error || !rOs.data?.length || rTec.error || !rTec.data?.length) {
    console.warn('[pdf] relatório não vinculado:', rOs.error?.message || rTec.error?.message || 'nenhuma linha alterada')
    return false
  }

  // Atualiza pedidos vinculados ao PPV (mesmo comportamento do envio online)
  // PDF refeito de OS antiga (já faturada) não pode voltar o pedido de fase (José, 23/10/2026)
  const ppvStr = opts.mexerPedidos === false ? '' : osInfo?.ID_PPV
  if (ppvStr) {
    const ppvIds = String(ppvStr).split(',').map((s: string) => s.trim()).filter(Boolean)
    if (ppvIds.length > 0) {
      await supabase.from('pedidos').update({ status: 'Aguardando Para Faturar' })
        .in('id_pedido', ppvIds).not('status', 'in', '("Fechado","Cancelado")')
    }
  }

  return true
}
