import { supabase } from './supabase'
import { gerarPdfRelatorio } from './gerarPdfRelatorio'
import { getQueue } from './offlineCache'

const TIMEOUT = 30000

function comTimeout<T>(p: PromiseLike<T>, ms = TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms) }),
  ]).finally(() => clearTimeout(timer))
}

/** Dias do relatório: DiasExecucao (JSON, sem limite) com fallback para as
 *  colunas legadas de até 3 dias. Antes só lia as legadas — OS com 4+ dias
 *  saía com dias faltando no PDF. */
export function diasDoRegistro(registro: Record<string, unknown>): { data: string; horaInicio: string; horaFim: string; kmTotal: string }[] {
  const s = (v: unknown) => (v == null ? '' : String(v))
  const json = registro.DiasExecucao
  if (Array.isArray(json) && json.length > 0) {
    return json.map((d) => {
      const o = (d || {}) as Record<string, unknown>
      return { data: s(o.data), horaInicio: s(o.horaInicio), horaFim: s(o.horaFim), kmTotal: s(o.kmTotal) }
    })
  }
  const dias: { data: string; horaInicio: string; horaFim: string; kmTotal: string }[] = []
  if (registro.DataInicio) {
    dias.push({
      data: s(registro.DataInicio), horaInicio: s(registro.InicioHora),
      horaFim: s(registro.FinalHora), kmTotal: s(registro.InicioKm) || s(registro.TotalKm),
    })
  }
  if (registro.AdicionarData2 && registro.DataInicio2) {
    dias.push({
      data: s(registro.DataInicio2), horaInicio: s(registro.InicioHora2),
      horaFim: s(registro.FinalHora2), kmTotal: s(registro.InicioKm2),
    })
  }
  if (registro.AdicionarData3 && registro.DataInicio3) {
    dias.push({
      data: s(registro.DataInicio3), horaInicio: s(registro.InicioHora3),
      horaFim: s(registro.FinaHora3), kmTotal: s(registro.InicioKm3),
    })
  }
  return dias
}

/** Fotos extras: FotosExtras (JSON) com fallback para FotoExtra1-5. */
export function fotosExtrasDoRegistro(registro: Record<string, unknown>): string[] {
  const json = registro.FotosExtras
  if (Array.isArray(json) && json.some(Boolean)) return (json as unknown[]).filter(Boolean).map(String)
  return [registro.FotoExtra1, registro.FotoExtra2, registro.FotoExtra3, registro.FotoExtra4, registro.FotoExtra5]
    .filter(Boolean).map(String)
}

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
export async function gerarEAnexarRelatorio(osId: string): Promise<boolean> {
  // O relatório desta OS ainda está na fila (não subiu, ou tem foto base64
  // pendente)? Gerar agora anexaria um PDF com dados velhos/sem fotos e marcaria
  // pdf_criado=true — e ele nunca mais seria refeito. Espera a fila esvaziar.
  try {
    const fila = await getQueue()
    const pendente = fila.some(i =>
      !i.failed && i.table === 'Ordem_Servico_Tecnicos' &&
      String(i.data?.Ordem_Servico ?? i.match?.Ordem_Servico ?? '') === String(osId),
    )
    if (pendente) return false
  } catch { /* sem IndexedDB: segue */ }

  const { data: registro, error: regErr } = await comTimeout(supabase
    .from('Ordem_Servico_Tecnicos')
    .select('*')
    .eq('Ordem_Servico', osId)
    .order('IdOs', { ascending: false })
    .limit(1)
    .maybeSingle())
  if (regErr || !registro) return false
  if (registro.pdf_criado) return true // já anexado

  const { data: osInfo } = await comTimeout(supabase
    .from('Ordem_Servico')
    .select('*')
    .eq('Id_Ordem', osId)
    .maybeSingle())

  let cidade = ''
  if (osInfo?.Cnpj_Cliente) {
    const { data: cli } = await comTimeout(supabase
      .from('Clientes')
      .select('cidade')
      .eq('cnpj_cpf', osInfo.Cnpj_Cliente)
      .maybeSingle())
    cidade = cli?.cidade || ''
  }

  const dias = diasDoRegistro(registro)
  if (dias.length === 0) dias.push({ data: '', horaInicio: '', horaFim: '', kmTotal: '' })

  const downloadFoto = async (url: string): Promise<string | null> => {
    if (!url) return null
    const match = url.match(/\/(?:object|storage)\/(?:v1\/)?(?:public|sign)\/requisicoes\/(.+?)(\?|$)/)
    if (!match) return null
    const path = decodeURIComponent(match[1])
    const { data: blob, error } = await supabase.storage.from('requisicoes').download(path)
    if (error || !blob) return null
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  }

  let pecas: unknown[] = []
  if (registro.PecasInfo) {
    try {
      const p = JSON.parse(registro.PecasInfo)
      if (Array.isArray(p)) pecas = p
    } catch { /* ignore */ }
  }

  const pdfBlob = await gerarPdfRelatorio({
    ordemServico: osId,
    cliente: osInfo?.Os_Cliente || '',
    endereco: osInfo?.Endereco_Cliente || '',
    cidade,
    tipoServico: registro.TipoServico || '',
    projeto: registro.Projeto || '',
    idPPV: osInfo?.ID_PPV || '',
    status: 'Enviado',
    tecResp1: registro.TecResp1 || '',
    temTec2: registro.TemTec || false,
    tecResp2: registro.TecResp2 || '',
    chassis: registro.Chassis || '',
    marca: registro.Marca || '',
    modelo: registro.Modelo || '',
    horimetro: registro.Horimetro || '',
    garantia: registro.Garantia || false,
    numPlaca: registro.NumPlaca || '',
    tratorLocal1: registro.TratorLocal1 || '',
    tratorLocal2: registro.TratorLocal2 || '',
    diagnostico: registro.Motivo || '',
    servicoRealizado: registro.ServicoRealizado || '',
    tipoRev: registro.TipoRev || '',
    dias,
    totalHora: registro.TotalHora || '',
    totalKm: registro.TotalKm || '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pecas: pecas as any,
    fotoHorimetro: registro.FotoHorimetro || '',
    fotoChassis: registro.FotoChassis || '',
    fotoFrente: registro.FotoFrente || '',
    fotoDireita: registro.FotoDireita || '',
    fotoEsquerda: registro.FotoEsquerda || '',
    fotoTraseira: registro.FotoTraseira || '',
    fotoVolante: registro.FotoVolante || '',
    fotoFalha1: registro.FotoFalha1 || '',
    fotoFalha2: registro.FotoFalha2 || '',
    fotoFalha3: registro.FotoFalha3 || '',
    fotoFalha4: registro.FotoFalha4 || '',
    fotoPecaNova1: registro.FotoPecaNova1 || '',
    fotoPecaNova2: registro.FotoPecaNova2 || '',
    fotoPecaInstalada1: registro.FotoPecaInstalada1 || '',
    fotoPecaInstalada2: registro.FotoPecaInstalada2 || '',
    // antes ficavam de fora: OS enviada offline saía sem as fotos do serviço
    fotosExtras: fotosExtrasDoRegistro(registro),
    assCliente: registro.AssCliente || '',
    assTecnico: registro.AssTecnico || '',
    nomResp: registro.NomResp || '',
    fazenda: registro.Fazenda || '',
    cidadeServico: registro.Cidade || '',
    data: registro.Data || '',
    apenasBlob: true,
    downloadFoto,
  })

  if (!pdfBlob) return false

  const pdfPath = `relatorios-os/${osId}/Relatorio_${osId}_${Date.now()}.pdf`
  const pdfFile = new File([pdfBlob as BlobPart], `Relatorio_${osId}.pdf`, { type: 'application/pdf' })
  const { error: upErr } = await comTimeout(supabase.storage.from('requisicoes').upload(pdfPath, pdfFile), 120000)
  if (upErr) return false

  const { data: urlData } = supabase.storage.from('requisicoes').getPublicUrl(pdfPath)
  const pdfUrl = urlData.publicUrl

  const [osUpd, tecUpd] = await comTimeout(Promise.all([
    supabase.from('Ordem_Servico').update({ ID_Relatorio_Final: pdfUrl }).eq('Id_Ordem', osId),
    supabase.from('Ordem_Servico_Tecnicos').update({ pdf_criado: true }).eq('Ordem_Servico', osId),
  ]))
  // Sem gravar o link na OS o portal não enxerga o PDF — tenta de novo depois
  if (osUpd.error || tecUpd.error) return false

  // Atualiza pedidos vinculados ao PPV (mesmo comportamento do envio online)
  const ppvStr = osInfo?.ID_PPV
  if (ppvStr) {
    const ppvIds = String(ppvStr).split(',').map((s: string) => s.trim()).filter(Boolean)
    if (ppvIds.length > 0) {
      await comTimeout(supabase.from('pedidos').update({ status: 'Aguardando Para Faturar' })
        .in('id_pedido', ppvIds).not('status', 'in', '("Fechado","Cancelado")'))
    }
  }

  return true
}
