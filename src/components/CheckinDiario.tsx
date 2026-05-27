'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Car, MapPin, Navigation, Loader2, Clock, Route, Wrench } from 'lucide-react'
import { colors } from '@/lib/ui'

const OFICINA_LAT = parseFloat(process.env.NEXT_PUBLIC_OFICINA_LAT || '-23.6533')
const OFICINA_LNG = parseFloat(process.env.NEXT_PUBLIC_OFICINA_LNG || '-49.3836')

interface OrdemOption {
  Id_Ordem: string
  Os_Cliente: string
  Endereco_Cliente: string
  lat: number | null
  lng: number | null
}

interface RotaData {
  coordinates: [number, number][]
  distancia_km: number
  tempo_min: number
}

interface Props {
  tecnicoNome: string
  nomeBusca: string
  onComplete: () => void
}

export default function CheckinDiario({ tecnicoNome, nomeBusca, onComplete }: Props) {
  const [veiculos, setVeiculos] = useState<{ IdPlaca: number; NumPlaca: string }[]>([])
  const [ordens, setOrdens] = useState<OrdemOption[]>([])
  const [placa, setPlaca] = useState('')
  const [ordemId, setOrdemId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rota, setRota] = useState<RotaData | null>(null)
  const [loadingRota, setLoadingRota] = useState(false)
  const [erroRota, setErroRota] = useState('')
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)

  // Carregar veiculos e ordens
  useEffect(() => {
    async function load() {
      const [veicRes, osRes] = await Promise.all([
        supabase.from('SupaPlacas').select('IdPlaca, NumPlaca').order('NumPlaca'),
        supabase
          .from('Ordem_Servico')
          .select('Id_Ordem, Os_Cliente, Endereco_Cliente')
          .not('Status', 'in', '("Concluida","Cancelada","Concluída","cancelada")')
          .or(`Os_Tecnico.ilike.%${nomeBusca}%,Os_Tecnico2.ilike.%${nomeBusca}%`),
      ])

      if (veicRes.data) setVeiculos(veicRes.data)

      if (osRes.data) {
        // Buscar coordenadas dos clientes
        const clienteNomes = [...new Set(osRes.data.map((o: any) => o.Os_Cliente).filter(Boolean))]
        let coordMap: Record<string, { lat: number; lng: number }> = {}

        if (clienteNomes.length > 0) {
          const { data: clientes } = await supabase
            .from('Clientes')
            .select('nome, latitude, longitude')
            .in('nome', clienteNomes)
          if (clientes) {
            for (const c of clientes) {
              if (c.latitude && c.longitude) {
                coordMap[c.nome] = { lat: c.latitude, lng: c.longitude }
              }
            }
          }
        }

        setOrdens(
          osRes.data.map((os: any) => ({
            Id_Ordem: os.Id_Ordem,
            Os_Cliente: os.Os_Cliente || '',
            Endereco_Cliente: os.Endereco_Cliente || '',
            lat: coordMap[os.Os_Cliente]?.lat || null,
            lng: coordMap[os.Os_Cliente]?.lng || null,
          })),
        )
      }

      setLoading(false)
    }
    load()
  }, [nomeBusca])

  // Carregar rota quando ordem selecionada
  useEffect(() => {
    if (!ordemId || ordemId === 'OFICINA') {
      setRota(null)
      setErroRota('')
      return
    }
    const ordem = ordens.find((o) => o.Id_Ordem === ordemId)
    if (!ordem) return

    let cancelled = false

    async function loadRota() {
      setLoadingRota(true)
      setErroRota('')
      setRota(null)

      let lat = ordem!.lat
      let lng = ordem!.lng

      // Se nao tem coordenadas, tenta geocodificar
      if (!lat || !lng) {
        if (ordem!.Endereco_Cliente) {
          try {
            const ORS_KEY = process.env.NEXT_PUBLIC_ORS_API_KEY || ''
            const geoRes = await fetch(
              `https://api.openrouteservice.org/geocode/search?api_key=${ORS_KEY}&text=${encodeURIComponent(ordem!.Endereco_Cliente + ', SP, Brasil')}&boundary.country=BR&size=1`,
            )
            if (geoRes.ok) {
              const geoData = await geoRes.json()
              const coords = geoData.features?.[0]?.geometry?.coordinates
              if (coords) {
                lat = coords[1]
                lng = coords[0]
              }
            }
          } catch { /* ignore */ }
        }
      }

      if (!lat || !lng) {
        if (!cancelled) {
          setErroRota('Endereco do cliente sem coordenadas')
          setLoadingRota(false)
        }
        return
      }

      try {
        const res = await fetch(
          `/api/rota-mapa?origemLat=${OFICINA_LAT}&origemLng=${OFICINA_LNG}&destinoLat=${lat}&destinoLng=${lng}`,
        )
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setRota(data)
        } else {
          if (!cancelled) setErroRota('Erro ao calcular rota')
        }
      } catch {
        if (!cancelled) setErroRota('Erro de conexao')
      }

      if (!cancelled) setLoadingRota(false)
    }

    loadRota()
    return () => { cancelled = true }
  }, [ordemId, ordens])

  // Renderizar mapa
  useEffect(() => {
    if (!mapRef.current) return

    // Limpar mapa anterior
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove()
      mapInstanceRef.current = null
    }

    if (!rota) return

    import('leaflet').then((L) => {
      if (!mapRef.current) return

      const map = L.map(mapRef.current, { zoomControl: false }).fitBounds(
        L.latLngBounds(rota.coordinates.map(([lat, lng]) => L.latLng(lat, lng))),
        { padding: [30, 30] },
      )

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OSM',
      }).addTo(map)

      // Rota
      L.polyline(rota.coordinates, {
        color: '#1E3A5F',
        weight: 4,
        opacity: 0.8,
      }).addTo(map)

      // Marcador origem (oficina)
      const origemCoord = rota.coordinates[0]
      L.circleMarker(L.latLng(origemCoord[0], origemCoord[1]), {
        radius: 8, fillColor: '#22C55E', fillOpacity: 1,
        color: '#fff', weight: 2,
      }).addTo(map).bindTooltip('Oficina', { permanent: true, direction: 'top', offset: [0, -10] })

      // Marcador destino (cliente)
      const destCoord = rota.coordinates[rota.coordinates.length - 1]
      L.circleMarker(L.latLng(destCoord[0], destCoord[1]), {
        radius: 8, fillColor: '#DC2626', fillOpacity: 1,
        color: '#fff', weight: 2,
      }).addTo(map).bindTooltip(
        ordens.find((o) => o.Id_Ordem === ordemId)?.Os_Cliente || 'Cliente',
        { permanent: true, direction: 'top', offset: [0, -10] },
      )

      L.control.zoom({ position: 'bottomright' }).addTo(map)

      mapInstanceRef.current = map
      setTimeout(() => map.invalidateSize(), 100)
    })
  }, [rota, ordemId, ordens])

  const confirmar = async () => {
    setSaving(true)
    const isOficina = ordemId === 'OFICINA'
    const ordem = isOficina ? null : ordens.find((o) => o.Id_Ordem === ordemId)
    const hoje = new Date().toISOString().split('T')[0]

    await supabase.from('checkin_diario').insert({
      tecnico_nome: tecnicoNome,
      data: hoje,
      placa,
      id_ordem: isOficina ? 'OFICINA' : ordemId,
      cliente: isOficina ? 'Oficina' : (ordem?.Os_Cliente || ''),
      destino: isOficina ? 'Oficina - Servico interno' : (ordem?.Endereco_Cliente || ''),
      lat_destino: isOficina ? OFICINA_LAT : (ordem?.lat || null),
      lng_destino: isOficina ? OFICINA_LNG : (ordem?.lng || null),
      distancia_km: isOficina ? 0 : (rota?.distancia_km || null),
      tempo_estimado_min: isOficina ? 0 : (rota?.tempo_min || null),
    })

    // Sincronizar veiculo com Rota Exata (em background, nao bloqueia)
    if (placa) {
      fetch('/api/sync-veiculo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tecnico_nome: tecnicoNome, placa }),
      }).catch(() => {})
    }

    setSaving(false)
    onComplete()
  }

  const ordemSelecionada = ordens.find((o) => o.Id_Ordem === ordemId)
  const podeSalvar = placa && ordemId

  if (loading) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#fff', zIndex: 10001,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12,
      }}>
        <Loader2 size={32} className="spinner" color={colors.primary} />
        <span style={{ fontSize: 14, color: colors.textMuted }}>Carregando...</span>
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#fff', zIndex: 10001,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        background: '#C41E2A', color: '#fff', padding: '20px 16px',
        textAlign: 'center', flexShrink: 0,
      }}>
        <Route size={28} style={{ marginBottom: 6 }} />
        <div style={{ fontSize: 20, fontWeight: 800 }}>Iniciar Jornada</div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Veiculo */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Car size={14} /> VEICULO
          </label>
          <select
            value={placa}
            onChange={(e) => setPlaca(e.target.value)}
            style={{
              width: '100%', padding: '13px 14px', borderRadius: 12,
              border: `2px solid ${placa ? colors.primary : colors.border}`,
              fontSize: 15, fontWeight: 600, background: '#FAFAFA',
              outline: 'none', appearance: 'none',
              color: placa ? colors.text : '#9CA3AF',
            }}
          >
            <option value="">Selecione o veiculo...</option>
            {veiculos.map((v) => (
              <option key={v.IdPlaca} value={v.NumPlaca}>{v.NumPlaca}</option>
            ))}
          </select>
        </div>

        {/* Ordem de Servico */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <MapPin size={14} /> DESTINO (ORDEM DE SERVICO)
          </label>
          <select
            value={ordemId}
            onChange={(e) => setOrdemId(e.target.value)}
            style={{
              width: '100%', padding: '13px 14px', borderRadius: 12,
              border: `2px solid ${ordemId ? colors.primary : colors.border}`,
              fontSize: 14, fontWeight: 600, background: '#FAFAFA',
              outline: 'none', appearance: 'none',
              color: ordemId ? colors.text : '#9CA3AF',
            }}
          >
            <option value="">Selecione o destino...</option>
            <option value="OFICINA">Oficina - Servico interno</option>
            {ordens.map((o) => (
              <option key={o.Id_Ordem} value={o.Id_Ordem}>
                OS {o.Id_Ordem} - {o.Os_Cliente}
              </option>
            ))}
          </select>
        </div>

        {/* Info do destino */}
        {ordemId === 'OFICINA' && (
          <div style={{
            background: colors.successBg, borderRadius: 12, padding: '16px 14px',
            border: `1px solid ${colors.successBorder}`,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, background: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Wrench size={22} color={colors.success} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>Servico na Oficina</div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>Sem deslocamento - trabalho interno</div>
            </div>
          </div>
        )}
        {ordemSelecionada && ordemId !== 'OFICINA' && (
          <div style={{
            background: colors.surfaceAlt, borderRadius: 12, padding: '12px 14px',
            border: `1px solid ${colors.border}`,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{ordemSelecionada.Os_Cliente}</div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{ordemSelecionada.Endereco_Cliente || 'Endereco nao informado'}</div>
            {loadingRota && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: colors.textSubtle, fontSize: 12 }}>
                <Loader2 size={14} className="spinner" /> Calculando rota...
              </div>
            )}
            {rota && (
              <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Navigation size={14} color={colors.primary} />
                  <span style={{ fontSize: 16, fontWeight: 800, color: colors.primary }}>{rota.distancia_km} km</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Clock size={14} color={colors.accent} />
                  <span style={{ fontSize: 16, fontWeight: 800, color: colors.accent }}>
                    {rota.tempo_min >= 60 ? `${Math.floor(rota.tempo_min / 60)}h${rota.tempo_min % 60}min` : `${rota.tempo_min} min`}
                  </span>
                </div>
              </div>
            )}
            {erroRota && (
              <div style={{ fontSize: 12, color: colors.danger, marginTop: 8 }}>{erroRota}</div>
            )}
          </div>
        )}

        {/* Mapa */}
        <div
          ref={mapRef}
          style={{
            width: '100%',
            minHeight: rota ? 280 : 0,
            maxHeight: rota ? 400 : 0,
            borderRadius: 14,
            overflow: 'hidden',
            border: rota ? `1px solid ${colors.border}` : 'none',
            transition: 'min-height 0.3s, max-height 0.3s',
          }}
        />

        {!ordemId && !placa && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: colors.textSubtle, fontSize: 13, textAlign: 'center', padding: 20,
          }}>
            Selecione o veiculo e o destino para iniciar sua jornada de hoje
          </div>
        )}
      </div>

      {/* Botao confirmar */}
      <div style={{ padding: '12px 16px 24px', flexShrink: 0 }}>
        <button
          onClick={confirmar}
          disabled={!podeSalvar || saving}
          style={{
            width: '100%', padding: '16px 20px', borderRadius: 14,
            background: podeSalvar ? '#C41E2A' : '#E5E7EB',
            color: podeSalvar ? '#fff' : '#9CA3AF',
            fontSize: 16, fontWeight: 800, border: 'none',
            cursor: podeSalvar ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? (
            <><Loader2 size={18} className="spinner" /> Confirmando...</>
          ) : (
            <><Navigation size={18} /> Confirmar e Iniciar Jornada</>
          )}
        </button>
      </div>

      {/* Leaflet CSS */}
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </div>
  )
}
