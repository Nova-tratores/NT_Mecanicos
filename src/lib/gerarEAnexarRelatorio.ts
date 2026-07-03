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
export async function gerarEAnexarRelatorio(osId: string): Promise<boolean> {
  const { data: registro } = await supabase
    .from('Ordem_Servico_Tecnicos')
    .select('*')
    .eq('Ordem_Servico', osId)
    .maybeSingle()
  if (!registro) return false
  if (registro.pdf_criado) return true // já anexado

  const { data: osInfo } = await supabase
    .from('Ordem_Servico')
    .select('*')
    .eq('Id_Ordem', osId)
    .maybeSingle()

  let cidade = ''
  if (osInfo?.Cnpj_Cliente) {
    const { data: cli } = await supabase
      .from('Clientes')
      .select('cidade')
      .eq('cnpj_cpf', osInfo.Cnpj_Cliente)
      .maybeSingle()
    cidade = cli?.cidade || ''
  }

  const dias: { data: string; horaInicio: string; horaFim: string; kmTotal: string }[] = []
  if (registro.DataInicio) {
    dias.push({
      data: registro.DataInicio || '', horaInicio: registro.InicioHora || '',
      horaFim: registro.FinalHora || '', kmTotal: registro.InicioKm || registro.TotalKm || '',
    })
  }
  if (registro.AdicionarData2 && registro.DataInicio2) {
    dias.push({
      data: registro.DataInicio2 || '', horaInicio: registro.InicioHora2 || '',
      horaFim: registro.FinalHora2 || '', kmTotal: registro.InicioKm2 || '',
    })
  }
  if (registro.AdicionarData3 && registro.DataInicio3) {
    dias.push({
      data: registro.DataInicio3 || '', horaInicio: registro.InicioHora3 || '',
      horaFim: registro.FinaHora3 || '', kmTotal: registro.InicioKm3 || '',
    })
  }
  if (dias.length === 0) dias.push({ data: '', horaInicio: '', horaFim: '', kmTotal: '' })

  const downloadFoto = async (url: string): Promise<string | null> => {
    if (!url) return null
    const match = url.match(/\/object\/public\/requisicoes\/(.+?)(\?|$)/)
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
    try { pecas = JSON.parse(registro.PecasInfo) } catch { /* ignore */ }
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
  const { error: upErr } = await supabase.storage.from('requisicoes').upload(pdfPath, pdfFile)
  if (upErr) return false

  const { data: urlData } = supabase.storage.from('requisicoes').getPublicUrl(pdfPath)
  const pdfUrl = urlData.publicUrl

  await Promise.all([
    supabase.from('Ordem_Servico').update({ ID_Relatorio_Final: pdfUrl }).eq('Id_Ordem', osId),
    supabase.from('Ordem_Servico_Tecnicos').update({ pdf_criado: true }).eq('Ordem_Servico', osId),
  ])

  // Atualiza pedidos vinculados ao PPV (mesmo comportamento do envio online)
  const ppvStr = osInfo?.ID_PPV
  if (ppvStr) {
    const ppvIds = String(ppvStr).split(',').map((s: string) => s.trim()).filter(Boolean)
    if (ppvIds.length > 0) {
      await supabase.from('pedidos').update({ status: 'Aguardando Para Faturar' })
        .in('id_pedido', ppvIds).not('status', 'in', '("Fechado","Cancelado")')
    }
  }

  return true
}
