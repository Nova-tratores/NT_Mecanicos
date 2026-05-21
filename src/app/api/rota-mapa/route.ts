import { NextRequest, NextResponse } from 'next/server'

const ORS_KEY = process.env.NEXT_PUBLIC_ORS_API_KEY || ''

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const origemLat = sp.get('origemLat')
  const origemLng = sp.get('origemLng')
  const destinoLat = sp.get('destinoLat')
  const destinoLng = sp.get('destinoLng')

  if (!origemLat || !origemLng || !destinoLat || !destinoLng) {
    return NextResponse.json({ error: 'Params obrigatorios: origemLat, origemLng, destinoLat, destinoLng' }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${ORS_KEY}&start=${origemLng},${origemLat}&end=${destinoLng},${destinoLat}`,
    )
    if (!res.ok) return NextResponse.json({ error: 'Erro ORS' }, { status: 502 })

    const data = await res.json()
    const feature = data.features?.[0]
    if (!feature) return NextResponse.json({ error: 'Rota nao encontrada' }, { status: 404 })

    const coordinates: [number, number][] = feature.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => [lat, lng],
    )
    const seg = feature.properties.segments[0]

    return NextResponse.json({
      coordinates,
      distancia_km: Math.round((seg.distance / 1000) * 10) / 10,
      tempo_min: Math.round(seg.duration / 60),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro ao calcular rota' }, { status: 500 })
  }
}
