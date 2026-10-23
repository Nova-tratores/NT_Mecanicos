// Rota e endereço via /api/ors (José, 23/10/2026): a chave do ORS fica no servidor, e cada chamada tem
// limite de tempo — antes "Calculando rota..." podia ficar para sempre.
const OFICINA_LAT = parseFloat(process.env.NEXT_PUBLIC_OFICINA_LAT || '-23.6533')
const OFICINA_LNG = parseFloat(process.env.NEXT_PUBLIC_OFICINA_LNG || '-49.3836')

export const OFICINA = { lat: OFICINA_LAT, lng: OFICINA_LNG }

interface RotaResult {
  distancia_km: number
  tempo_min: number
}

const TIMEOUT_MS = 10000

async function chamar(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch('/api/ors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null // sem sinal ou demorou demais
  } finally {
    clearTimeout(t)
  }
}

/** Calcula rota entre dois pontos (null se não deu) */
export async function calcularRota(
  origemLat: number, origemLng: number,
  destinoLat: number, destinoLng: number,
): Promise<RotaResult | null> {
  const j = await chamar({ acao: 'rota', de: { lat: origemLat, lng: origemLng }, para: { lat: destinoLat, lng: destinoLng } })
  if (!j || typeof j.distancia_km !== 'number' || typeof j.tempo_min !== 'number') return null
  return { distancia_km: j.distancia_km, tempo_min: j.tempo_min }
}

/** Calcula rota da oficina até um destino */
export async function rotaDaOficina(destinoLat: number, destinoLng: number) {
  return calcularRota(OFICINA.lat, OFICINA.lng, destinoLat, destinoLng)
}

/** Geocodifica um endereço (null se não achou ou não deu) */
export async function geocodificar(endereco: string): Promise<{ lat: number; lng: number } | null> {
  const j = await chamar({ acao: 'geocode', texto: endereco })
  if (!j || typeof j.lat !== 'number' || typeof j.lng !== 'number') return null
  return { lat: j.lat, lng: j.lng }
}

/** "FARTURA (SP)" → { cidade: 'FARTURA', uf: 'SP' } */
export function cidadeUf(cidadeCliente?: string | null): { cidade: string; uf: string } {
  const s = String(cidadeCliente || '').trim()
  const m = /^(.*?)\s*[(-]\s*([A-Za-z]{2})\s*\)?$/.exec(s)
  return m ? { cidade: m[1].trim(), uf: m[2].toUpperCase() } : { cidade: s, uf: '' }
}

/** link para navegar até o destino (Waze se tiver coordenadas, senão Google Maps pelo endereço) */
export function linkNavegar(dest: { lat?: number | null; lng?: number | null; endereco?: string | null }): string {
  if (dest.lat != null && dest.lng != null) return `https://waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes`
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest.endereco || '')}`
}
