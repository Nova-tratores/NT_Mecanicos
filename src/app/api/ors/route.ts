// Rota e endereço (OpenRouteService) pelo servidor (José, 23/10/2026): a chave do ORS saiu do navegador
// (era NEXT_PUBLIC). Exige login (mesmo padrão do /api/feed, via lib/apiAuth).
// POST { acao: 'geocode', texto } → { lat, lng } | { lat: null }
// POST { acao: 'rota', de: {lat,lng}, para: {lat,lng} } → { distancia_km, tempo_min } | { distancia_km: null }
import { NextResponse } from 'next/server'
import { exigirUsuario } from '@/lib/apiAuth'
import { serverEnv } from '@/lib/server-env'

export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 8000
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)

async function buscar(url: string) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try { return await fetch(url, { signal: ctrl.signal, cache: 'no-store' }) } finally { clearTimeout(t) }
}

export async function POST(req: Request) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u

  const chave = serverEnv('ORS_API_KEY') || serverEnv('NEXT_PUBLIC_ORS_API_KEY')
  if (!chave || chave === 'SUA_CHAVE_AQUI') return NextResponse.json({ error: 'ORS não configurado' }, { status: 503 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  try {
    if (body.acao === 'geocode') {
      const texto = String(body.texto || '').slice(0, 300).trim()
      if (!texto) return NextResponse.json({ error: 'texto vazio' }, { status: 400 })
      const r = await buscar(`https://api.openrouteservice.org/geocode/search?api_key=${chave}&text=${encodeURIComponent(texto)}&boundary.country=BR&size=1`)
      if (!r.ok) return NextResponse.json({ lat: null, lng: null })
      const j = await r.json()
      const c = j.features?.[0]?.geometry?.coordinates
      return NextResponse.json(c ? { lat: c[1], lng: c[0] } : { lat: null, lng: null })
    }
    if (body.acao === 'rota') {
      const de = (body.de || {}) as Record<string, unknown>, para = (body.para || {}) as Record<string, unknown>
      const [la1, ln1, la2, ln2] = [num(de.lat), num(de.lng), num(para.lat), num(para.lng)]
      if ([la1, ln1, la2, ln2].some(Number.isNaN)) return NextResponse.json({ error: 'coordenadas inválidas' }, { status: 400 })
      const r = await buscar(`https://api.openrouteservice.org/v2/directions/driving-car?api_key=${chave}&start=${ln1},${la1}&end=${ln2},${la2}`)
      if (!r.ok) return NextResponse.json({ distancia_km: null, tempo_min: null })
      const j = await r.json()
      const seg = j.features?.[0]?.properties?.segments?.[0]
      if (!seg) return NextResponse.json({ distancia_km: null, tempo_min: null })
      return NextResponse.json({ distancia_km: Math.round((seg.distance / 1000) * 10) / 10, tempo_min: Math.round(seg.duration / 60) })
    }
    return NextResponse.json({ error: 'ação inválida' }, { status: 400 })
  } catch (e) {
    const abortou = (e as Error)?.name === 'AbortError'
    return NextResponse.json({ error: abortou ? 'demorou demais' : 'falha no ORS' }, { status: abortou ? 504 : 502 })
  }
}
