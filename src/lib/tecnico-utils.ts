import { authHeaders } from '@/lib/supabase'

const DIACRITICS = /[̀-ͯ]/g

const RE_PREFIXO_CARGO =
  /^(T[ÉE]CNICOS?(\s+EXTERNO)?|MEC[ÂA]NICOS?|MOTORISTAS?|VENDEDOR(ES)?|AUX(ILIARES)?|PECAS|PEÇAS)[:\s]+/i

export function normName(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '').toLowerCase().trim()
}

export function cleanName(str: string | null | undefined): string | null {
  if (!str) return null
  let s = String(str).toUpperCase().normalize('NFD').replace(DIACRITICS, '').trim()
  s = s.replace(RE_PREFIXO_CARGO, '')
  s = s.replace(/\b(DE|DA|DO|DOS|DAS|E|OU|SR|SRA)\b/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').trim().replace(/\s+/g, ' ')
  if (s.length < 3) return null
  if (s.includes('FINALIZEI') || s.includes('TRANSFERENCIA') || s.includes('VIA API')) return null
  return s
}

export function splitTecnicos(raw: string | null | undefined): string[] {
  if (!raw) return []
  const sem = String(raw).replace(RE_PREFIXO_CARGO, '')
  return sem.split(/[/&]|\sE\s|\/\//).map(p => p.trim()).filter(p => p.length > 2)
}

export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const palA = a.split(' ').filter(w => w.length >= 3)
  const palB = b.split(' ').filter(w => w.length >= 3)
  if (palA.length < 2 || palB.length < 2) return false
  return palA.every(w => palB.includes(w)) || palB.every(w => palA.includes(w))
}

export function nomesBatem(a: string, b: string): boolean {
  if (!a || !b) return false
  const pA = normName(a).replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2)
  const pB = normName(b).replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2)
  if (!pA.length || !pB.length || pA[0] !== pB[0]) return false
  if (pA.length === 1 || pB.length === 1) return true
  const s = new Set(pA.slice(1))
  return pB.slice(1).some(p => s.has(p))
}

/**
 * Data no fuso local do aparelho no formato YYYY-MM-DD.
 * Evita o bug de `toISOString().slice(0,10)` (UTC), que no Brasil (-03:00)
 * devolve o dia seguinte depois das 21h.
 */
export function dataLocalISO(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dia}`
}

/** Mês local no formato YYYY-MM. */
export function mesLocalISO(d: Date = new Date()): string {
  return dataLocalISO(d).slice(0, 7)
}

/** Redimensiona/comprime uma imagem no navegador para JPEG (lado maior <= maxSize). */
export function redimensionarImagem(file: File, maxSize: number, qualidade = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Não foi possível processar a imagem')); return }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Não foi possível comprimir a imagem')),
        'image/jpeg',
        qualidade,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida')) }
    img.src = url
  })
}

/**
 * Envia a foto de perfil pelo /api/avatar (comprimida a 512px) e atualiza o
 * perfil em cache local. Retorna a nova URL.
 */
export async function enviarAvatar(file: File, userId: string): Promise<string> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Sem conexão. Conecte-se à internet para trocar a foto de perfil.')
  }
  const compressed = await redimensionarImagem(file, 512)
  const fd = new FormData()
  fd.append('file', new File([compressed], 'avatar.jpg', { type: 'image/jpeg' }))
  fd.append('userId', userId)
  let res: Response
  try {
    res = await fetch('/api/avatar', { method: 'POST', body: fd, headers: await authHeaders() })
  } catch {
    throw new Error('Não foi possível enviar a foto. Verifique a conexão e tente novamente.')
  }
  const json: { error?: string; avatar_url?: string } = await res.json().catch(() => ({}))
  if (!res.ok || !json.avatar_url) {
    throw new Error('Não foi possível enviar a foto. Tente novamente.')
  }
  try {
    const cached = JSON.parse(localStorage.getItem('nt-mecanicos-profile') || '{}')
    cached.avatar_url = json.avatar_url
    localStorage.setItem('nt-mecanicos-profile', JSON.stringify(cached))
  } catch {}
  return json.avatar_url
}
