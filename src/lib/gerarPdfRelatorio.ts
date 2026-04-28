import jsPDF from 'jspdf'

interface PecaInfo {
  descricao: string
  codigo: string
  qtdUsada: string
  devolvida: boolean
  qtdDevolvida: string
  origem: 'ppv' | 'manual'
  naoUsada: boolean
}

interface DadosRelatorio {
  // OS info
  ordemServico: string
  cliente: string
  endereco: string
  cidade: string
  tipoServico: string
  projeto: string
  idPPV: string
  status: string

  // Técnicos
  tecResp1: string
  temTec2: boolean
  tecResp2: string

  // Equipamento
  marca: string
  modelo: string
  chassis: string
  horimetro: string
  garantia: boolean
  numPlaca: string
  tratorLocal1: string
  tratorLocal2: string

  // Serviço
  diagnostico: string
  servicoRealizado: string
  tipoRev: string

  // Dias
  dias: { data: string; horaInicio: string; horaFim: string; kmTotal: string }[]
  totalHora: string
  totalKm: string

  // Peças
  pecas: PecaInfo[]

  // Fotos (URLs)
  fotoHorimetro: string
  fotoChassis: string
  fotoFrente: string
  fotoDireita: string
  fotoEsquerda: string
  fotoTraseira: string
  fotoVolante: string
  fotoFalha1: string
  fotoFalha2: string
  fotoFalha3: string
  fotoFalha4: string
  fotoPecaNova1: string
  fotoPecaNova2: string
  fotoPecaInstalada1: string
  fotoPecaInstalada2: string

  // Assinaturas (base64)
  assCliente: string
  assTecnico: string

  // Responsável
  nomResp: string
  data: string

  // Se true, não faz download, só retorna o blob
  apenasBlob?: boolean

  // Função customizada para baixar fotos (ex: via Supabase Storage, evitando CORS)
  downloadFoto?: (url: string) => Promise<string | null>
}

const VERMELHO = '#C41E2A'
const AZUL_ESCURO = '#1E3A5F'
const CINZA = '#6B7280'
const CINZA_CLARO = '#F3F4F6'
const PRETO = '#1F2937'

function formatarDataBR(dateStr: string) {
  if (!dateStr) return '-'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

async function loadImageAsBase64(url: string, downloadFoto?: (url: string) => Promise<string | null>): Promise<string | null> {
  if (!url) return null
  // Já é base64 — retorna direto
  if (url.startsWith('data:')) return url
  // Ignora blob: URLs que não são válidas fora do navegador
  if (url.startsWith('blob:')) return null

  // Tenta downloader customizado primeiro (Supabase Storage, sem CORS)
  if (downloadFoto) {
    try {
      const result = await downloadFoto(url)
      if (result) return result
    } catch { /* fall through */ }
  }

  try {
    // Tenta fetch (funciona se CORS permite)
    const resp = await fetch(url, { mode: 'cors' })
    if (resp.ok) {
      const blob = await resp.blob()
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    }
  } catch {
    // CORS bloqueou, tenta via Image element
  }
  // Fallback: carrega via <img> crossOrigin
  try {
    return await new Promise((resolve) => {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(img, 0, 0)
            resolve(canvas.toDataURL('image/jpeg', 0.85))
          } else {
            resolve(null)
          }
        } catch {
          resolve(null)
        }
      }
      img.onerror = () => resolve(null)
      // Timeout de 10s
      setTimeout(() => resolve(null), 10000)
      img.src = url
    })
  } catch {
    return null
  }
}

export async function gerarPdfRelatorio(dados: DadosRelatorio) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const marginL = 15
  const marginR = 15
  const contentW = pageW - marginL - marginR
  let y = 15

  const checkNewPage = (needed: number) => {
    if (y + needed > 275) {
      doc.addPage()
      y = 15
    }
  }

  // ============================================
  // HEADER
  // ============================================
  // Tentar carregar logo
  try {
    const logoResp = await fetch('/Logo_Nova.png')
    const logoBlob = await logoResp.blob()
    const logoBase64 = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.readAsDataURL(logoBlob)
    })
    doc.addImage(logoBase64, 'PNG', marginL, y - 2, 40, 12)
  } catch {
    doc.setFontSize(16)
    doc.setTextColor(VERMELHO)
    doc.text('NOVA TRATORES', marginL, y + 6)
  }

  // Título à direita
  doc.setFontSize(14)
  doc.setTextColor(VERMELHO)
  doc.text('RELATÓRIO DE SERVIÇO', pageW - marginR, y + 3, { align: 'right' })
  doc.setFontSize(10)
  doc.setTextColor(CINZA)
  doc.text(`OS: ${dados.ordemServico}`, pageW - marginR, y + 9, { align: 'right' })

  y += 16

  // Linha separadora
  doc.setDrawColor(VERMELHO)
  doc.setLineWidth(0.8)
  doc.line(marginL, y, pageW - marginR, y)
  y += 6

  // ============================================
  // SEÇÃO: DADOS DA ORDEM
  // ============================================
  const drawSectionTitle = (title: string) => {
    checkNewPage(14)
    doc.setFillColor(AZUL_ESCURO)
    doc.roundedRect(marginL, y, contentW, 7, 1, 1, 'F')
    doc.setFontSize(10)
    doc.setTextColor('#FFFFFF')
    doc.text(title, marginL + 4, y + 5)
    y += 10
  }

  const drawField = (label: string, value: string, x: number, w: number) => {
    doc.setFontSize(8)
    doc.setTextColor(CINZA)
    doc.text(label, x, y)
    doc.setFontSize(10)
    doc.setTextColor(PRETO)
    const lines = doc.splitTextToSize(value || '-', w - 2)
    doc.text(lines, x, y + 4)
    return 4 + lines.length * 4
  }

  const drawRow = (fields: { label: string; value: string }[]) => {
    checkNewPage(16)
    const colW = contentW / fields.length
    let maxH = 0
    for (let i = 0; i < fields.length; i++) {
      const h = drawField(fields[i].label, fields[i].value, marginL + i * colW, colW)
      if (h > maxH) maxH = h
    }
    y += maxH + 4
  }

  // --- Dados da Ordem ---
  drawSectionTitle('DADOS DA ORDEM')

  drawRow([
    { label: 'Ordem de Serviço', value: dados.ordemServico },
    { label: 'Data', value: formatarDataBR(dados.data) },
    { label: 'Status', value: dados.status },
  ])

  drawRow([
    { label: 'Cliente', value: dados.cliente },
    { label: 'Cidade', value: dados.cidade },
  ])

  if (dados.endereco) {
    drawRow([{ label: 'Endereço', value: dados.endereco }])
  }

  drawRow([
    { label: 'Tipo de Serviço', value: dados.tipoServico },
    { label: 'Projeto / Chassis', value: dados.chassis || dados.projeto || '-' },
    { label: 'PPV', value: dados.idPPV || '-' },
  ])

  const marcaModelo = [dados.marca, dados.modelo].filter(Boolean).join(' / ')
  if (marcaModelo) {
    drawRow([
      { label: 'Marca / Modelo', value: marcaModelo },
      { label: 'Horímetro', value: dados.horimetro || '-' },
    ])
  }

  // --- Técnicos ---
  drawSectionTitle('TÉCNICOS')
  if (dados.temTec2) {
    drawRow([
      { label: 'Técnico Responsável', value: dados.tecResp1 },
      { label: 'Técnico 2', value: dados.tecResp2 },
    ])
  } else {
    drawRow([{ label: 'Técnico Responsável', value: dados.tecResp1 }])
  }

  drawRow([
    { label: 'Veículo (Placa)', value: dados.numPlaca || '-' },
  ])

  // --- Equipamento ---
  drawSectionTitle('EQUIPAMENTO')

  drawRow([
    { label: 'Chassis', value: dados.chassis },
    { label: 'Horímetro', value: dados.horimetro },
    { label: 'Garantia', value: dados.garantia ? 'SIM' : 'NÃO' },
  ])

  // --- Diagnóstico e Serviço ---
  drawSectionTitle('DIAGNÓSTICO E SERVIÇO REALIZADO')

  checkNewPage(24)
  doc.setFontSize(8)
  doc.setTextColor(CINZA)
  doc.text('Diagnóstico / Motivo', marginL, y)
  doc.setFontSize(10)
  doc.setTextColor(PRETO)
  const diagLines = doc.splitTextToSize(dados.diagnostico || '-', contentW - 4)
  doc.text(diagLines, marginL, y + 4)
  y += 4 + diagLines.length * 4 + 4

  checkNewPage(24)
  doc.setFontSize(8)
  doc.setTextColor(CINZA)
  doc.text('Serviço Realizado', marginL, y)
  doc.setFontSize(10)
  doc.setTextColor(PRETO)
  const servLines = doc.splitTextToSize(dados.servicoRealizado || '-', contentW - 4)
  doc.text(servLines, marginL, y + 4)
  y += 4 + servLines.length * 4 + 4

  if (dados.tipoRev) {
    drawRow([{ label: 'Tipo Revisão', value: dados.tipoRev }])
  }

  // --- Dias / Horas / KM ---
  drawSectionTitle('DIAS DE SERVIÇO')

  // Header da tabela
  checkNewPage(12)
  doc.setFillColor(CINZA_CLARO)
  doc.rect(marginL, y, contentW, 6, 'F')
  doc.setFontSize(8)
  doc.setTextColor(AZUL_ESCURO)
  const cols = [0, 35, 65, 95, 130]
  const headers = ['Data', 'Hora Início', 'Hora Fim', 'Total KM']
  headers.forEach((h, i) => doc.text(h, marginL + cols[i] + 2, y + 4))
  y += 7

  doc.setTextColor(PRETO)
  doc.setFontSize(9)
  for (const dia of dados.dias) {
    checkNewPage(8)
    doc.text(formatarDataBR(dia.data), marginL + cols[0] + 2, y + 4)
    doc.text(dia.horaInicio || '-', marginL + cols[1] + 2, y + 4)
    doc.text(dia.horaFim || '-', marginL + cols[2] + 2, y + 4)
    doc.text(dia.kmTotal || '-', marginL + cols[3] + 2, y + 4)
    doc.setDrawColor('#E5E7EB')
    doc.setLineWidth(0.2)
    doc.line(marginL, y + 6, pageW - marginR, y + 6)
    y += 7
  }

  // Totais
  checkNewPage(10)
  doc.setFillColor('#DBEAFE')
  doc.rect(marginL, y, contentW, 7, 'F')
  doc.setFontSize(9)
  doc.setTextColor(AZUL_ESCURO)
  doc.text(`Total Horas: ${dados.totalHora || '-'}`, marginL + 4, y + 5)
  doc.text(`Total KM: ${dados.totalKm || '-'}`, marginL + 70, y + 5)
  y += 12

  // --- Peças ---
  if (dados.pecas.length > 0) {
    drawSectionTitle('PEÇAS UTILIZADAS')

    checkNewPage(10)
    doc.setFillColor(CINZA_CLARO)
    doc.rect(marginL, y, contentW, 6, 'F')
    doc.setFontSize(7)
    doc.setTextColor(AZUL_ESCURO)
    const pCols = [0, 30, 110, 125, 148]
    const pHeaders = ['Código', 'Descrição', 'Qtd', 'Devolvida', 'Origem']
    pHeaders.forEach((h, i) => doc.text(h, marginL + pCols[i] + 2, y + 4))
    y += 7

    doc.setFontSize(8)
    doc.setTextColor(PRETO)
    for (const peca of dados.pecas) {
      if (peca.naoUsada) continue
      const codeLines = doc.splitTextToSize(peca.codigo || '-', pCols[1] - pCols[0] - 3)
      const descLines = doc.splitTextToSize(peca.descricao || '-', pCols[2] - pCols[1] - 3)
      const rowLines = Math.max(codeLines.length, descLines.length)
      checkNewPage(4 + rowLines * 3.5)
      doc.text(codeLines, marginL + pCols[0] + 2, y + 4)
      doc.text(descLines, marginL + pCols[1] + 2, y + 4)
      doc.text(peca.qtdUsada || '-', marginL + pCols[2] + 2, y + 4)
      const devolvido = peca.devolvida === true
      const devText = devolvido ? `Sim (${peca.qtdDevolvida || '0'})` : 'Não'
      doc.text(devText, marginL + pCols[3] + 2, y + 4)
      doc.text(peca.origem === 'ppv' ? 'PPV' : 'Manual', marginL + pCols[4] + 2, y + 4)
      const rowH = 4 + rowLines * 3.5
      doc.setDrawColor('#E5E7EB')
      doc.setLineWidth(0.2)
      doc.line(marginL, y + rowH, pageW - marginR, y + rowH)
      y += rowH + 1
    }
    y += 4
  }

  // --- Fotos ---
  const fotos: { label: string; url: string }[] = [
    { label: 'Horímetro', url: dados.fotoHorimetro },
    { label: 'Chassis', url: dados.fotoChassis },
    { label: 'Frente', url: dados.fotoFrente },
    { label: 'Direita', url: dados.fotoDireita },
    { label: 'Esquerda', url: dados.fotoEsquerda },
    { label: 'Traseira', url: dados.fotoTraseira },
    { label: 'Volante', url: dados.fotoVolante },
    { label: 'Falha 1', url: dados.fotoFalha1 },
    { label: 'Falha 2', url: dados.fotoFalha2 },
    { label: 'Falha 3', url: dados.fotoFalha3 },
    { label: 'Falha 4', url: dados.fotoFalha4 },
    { label: 'Peça Nova 1', url: dados.fotoPecaNova1 },
    { label: 'Peça Nova 2', url: dados.fotoPecaNova2 },
    { label: 'Peça Instalada 1', url: dados.fotoPecaInstalada1 },
    { label: 'Peça Instalada 2', url: dados.fotoPecaInstalada2 },
  ].filter(f => f.url)

  if (fotos.length > 0) {
    drawSectionTitle('FOTOS')
    const fotoW = (contentW - 10) / 3
    const fotoH = fotoW * 0.75
    let col = 0

    for (const foto of fotos) {
      if (col === 3) { col = 0; y += fotoH + 12 }
      checkNewPage(fotoH + 14)

      const x = marginL + col * (fotoW + 5)

      // Label
      doc.setFontSize(7)
      doc.setTextColor(CINZA)
      doc.text(foto.label, x, y)

      // Placeholder ou imagem
      const imgData = await loadImageAsBase64(foto.url, dados.downloadFoto)
      if (imgData) {
        try {
          doc.addImage(imgData, 'JPEG', x, y + 2, fotoW, fotoH)
        } catch {
          doc.setDrawColor('#E5E7EB')
          doc.rect(x, y + 2, fotoW, fotoH)
          doc.setFontSize(8)
          doc.setTextColor('#D1D5DB')
          doc.text('Erro ao carregar', x + fotoW / 2, y + 2 + fotoH / 2, { align: 'center' })
        }
      } else {
        doc.setDrawColor('#E5E7EB')
        doc.rect(x, y + 2, fotoW, fotoH)
        doc.setFontSize(8)
        doc.setTextColor('#D1D5DB')
        doc.text('Foto', x + fotoW / 2, y + 2 + fotoH / 2, { align: 'center' })
      }
      col++
    }
    y += fotoH + 14
  }

  // --- Assinaturas ---
  checkNewPage(50)
  drawSectionTitle('ASSINATURAS')

  const assW = (contentW - 10) / 2

  // Assinatura do cliente
  doc.setFontSize(8)
  doc.setTextColor(CINZA)
  doc.text('Assinatura do Cliente', marginL, y)
  if (dados.assCliente) {
    try {
      doc.addImage(dados.assCliente, 'PNG', marginL, y + 2, assW, 25)
    } catch { /* */ }
  } else {
    doc.setDrawColor('#E5E7EB')
    doc.rect(marginL, y + 2, assW, 25)
  }

  // Assinatura do técnico
  doc.text('Assinatura do Técnico', marginL + assW + 10, y)
  if (dados.assTecnico) {
    try {
      doc.addImage(dados.assTecnico, 'PNG', marginL + assW + 10, y + 2, assW, 25)
    } catch { /* */ }
  } else {
    doc.setDrawColor('#E5E7EB')
    doc.rect(marginL + assW + 10, y + 2, assW, 25)
  }

  y += 32

  // Nomes sob assinnaturas
  doc.setDrawColor(PRETO)
  doc.setLineWidth(0.3)
  doc.line(marginL, y, marginL + assW, y)
  doc.line(marginL + assW + 10, y, pageW - marginR, y)

  doc.setFontSize(9)
  doc.setTextColor(PRETO)
  doc.text(dados.nomResp || 'Cliente', marginL + assW / 2, y + 5, { align: 'center' })
  doc.text(dados.tecResp1 || 'Técnico', marginL + assW + 10 + assW / 2, y + 5, { align: 'center' })

  y += 12

  // --- Rodapé ---
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFontSize(7)
  doc.setTextColor(CINZA)
  doc.text(
    'Nova Tratores Máquinas Agrícolas — Av. São Sebastião, 1065 - Vila Campos, Piraju - SP | (14) 3351-1200',
    pageW / 2, pageH - 8, { align: 'center' }
  )
  doc.text(
    `Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
    pageW / 2, pageH - 4, { align: 'center' }
  )

  // Retornar blob e opcionalmente baixar
  const blob = doc.output('blob')
  if (!dados.apenasBlob) {
    doc.save(`Relatorio_OS_${dados.ordemServico}.pdf`)
  }
  return blob
}
