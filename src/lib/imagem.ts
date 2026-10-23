// Compressão de imagem comum do app (José, 23/10/2026): lado maior até ~1600 px, JPEG 0,8.
// Mesma ideia do comprimirImagem do preencher da OS; vídeo e PDF passam direto.
// Se o aparelho não conseguir decodificar (HEIC antigo, memória), devolve o arquivo original.

const LADO_MAX = 1600
const QUALIDADE = 0.8
const LIMITE_SEM_MEXER = 400_000 // até ~400 KB já está bom para subir

async function decodificar(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; fechar: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return { img: bmp, w: bmp.width, h: bmp.height, fechar: () => bmp.close?.() }
    } catch { /* cai no <img> abaixo (Safari antigo) */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const el = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('imagem inválida'))
      i.src = url
    })
    return { img: el, w: el.naturalWidth, h: el.naturalHeight, fechar: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

/** Reduz a foto para subir mais rápido. Nunca lança erro: na dúvida devolve o original. */
export async function comprimirImagem(file: File | Blob, ladoMax = LADO_MAX, qualidade = QUALIDADE): Promise<Blob> {
  const tipo = (file as File).type || ''
  if (tipo && !tipo.startsWith('image/')) return file
  if (tipo === 'image/gif' || tipo === 'image/svg+xml') return file
  try {
    const { img, w: w0, h: h0, fechar } = await decodificar(file)
    let w = w0, h = h0
    if (!w || !h) { fechar(); return file }
    if (w <= ladoMax && h <= ladoMax && file.size <= LIMITE_SEM_MEXER) { fechar(); return file }
    if (w > ladoMax || h > ladoMax) {
      if (w >= h) { h = Math.round(h * ladoMax / w); w = ladoMax }
      else { w = Math.round(w * ladoMax / h); h = ladoMax }
    }
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { fechar(); return file }
    ctx.fillStyle = '#fff' // PNG com fundo transparente não fica preto no JPEG
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    fechar()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade))
    canvas.width = 0; canvas.height = 0 // libera memória no iPhone
    if (!blob || blob.size >= file.size) return file
    return blob
  } catch {
    return file
  }
}

/** Comprime e devolve como File .jpg (mantém o nome base) — para quem precisa de File. */
export async function comprimirArquivo(file: File, ladoMax = LADO_MAX, qualidade = QUALIDADE): Promise<File> {
  const b = await comprimirImagem(file, ladoMax, qualidade)
  if (b === file) return file
  const base = (file.name || 'foto').replace(/\.[^.]+$/, '')
  return new File([b], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}

/** Extensão certa para o caminho no Storage depois da compressão. */
export function extensaoDe(b: Blob, nomeOriginal?: string): string {
  if (b.type === 'image/jpeg') return 'jpg'
  if (b.type === 'image/png') return 'png'
  if (b.type === 'image/webp') return 'webp'
  if (b.type === 'application/pdf') return 'pdf'
  const ext = (nomeOriginal || '').split('.').pop()?.toLowerCase()
  return ext && ext.length <= 5 ? ext : 'jpg'
}

/** Blob → data URL (base64), para guardar na fila offline. */
export function blobParaBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error || new Error('falha ao ler o arquivo'))
    r.readAsDataURL(b)
  })
}

/** data URL (base64) → Blob, para subir quando voltar o sinal. */
export async function base64ParaBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}
