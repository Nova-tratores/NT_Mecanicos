'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import {
  WifiOff, RefreshCw, Car, MapPin, Loader2, ArrowLeft,
  User, Briefcase, Search, ChevronUp, ChevronDown, Route, X, AlertTriangle,
} from 'lucide-react'
import { colors } from '@/lib/ui'
import { PageSpinner } from '@/components/ui'
import Link from 'next/link'

interface Veiculo {
  id: number
  placa: string
  descricao: string
  modelo: string
  lat: number
  lng: number
  velocidade: number
  ignicao: number
  dt_posicao: string | null
  motorista: string
  cliente: string
  id_ordem: string
}

interface ClienteMapa {
  id: number
  nome: string
  cidade: string
  estado: string
  lat: number
  lng: number
}

interface PontoRota {
  lat: number
  lng: number
  velocidade: number
  ignicao: number
  dt_posicao: string
}

export default function MapaPage() {
  const { user } = useCurrentUser()
  const [veiculos, setVeiculos] = useState<Veiculo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [offline, setOffline] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedVeiculo, setSelectedVeiculo] = useState<Veiculo | null>(null)

  // Clientes do mapeamento
  const [clientes, setClientes] = useState<ClienteMapa[]>([])
  const [showClientes, setShowClientes] = useState(true)

  // Painel de busca
  const [painelAberto, setPainelAberto] = useState(false)
  const [abaAtiva, setAbaAtiva] = useState<'veiculos' | 'tecnicos' | 'clientes'>('tecnicos')
  const [busca, setBusca] = useState('')

  // Rota do veiculo
  const [rotaVeiculoId, setRotaVeiculoId] = useState<number | null>(null)
  const [loadingRota, setLoadingRota] = useState(false)

  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const clienteMarkersRef = useRef<any[]>([])
  const rotaLayerRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const infracaoMarkerRef = useRef<any>(null)

  // Deep-link: ?placa=X&data=YYYY-MM-DD&infracao=lat,lng — vem do relatório
  const searchParams = useSearchParams()
  const deeplink = useMemo(() => {
    const placa = searchParams.get('placa')
    const data = searchParams.get('data')
    const inf = searchParams.get('infracao')
    if (!inf) return null
    const [latStr, lngStr] = inf.split(',')
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null
    return { placa: placa || '', data: data || '', lat, lng }
  }, [searchParams])

  const carregarVeiculos = useCallback(async (silencioso = false) => {
    if (!navigator.onLine) { setOffline(true); setLoading(false); return }
    setOffline(false)
    if (!silencioso) setLoading(true)
    else setRefreshing(true)

    try {
      const res = await fetch('/api/veiculos-mapa')
      if (!res.ok) throw new Error('Erro ao buscar')
      const data = await res.json()
      if (Array.isArray(data)) setVeiculos(data)
      setErro('')
    } catch (e: any) {
      setErro(e.message || 'Erro ao carregar veiculos')
    }
    setLoading(false)
    setRefreshing(false)
  }, [])

  // Carregar clientes do mapeamento
  const carregarClientes = useCallback(async () => {
    if (!navigator.onLine) return
    try {
      const res = await fetch('/api/clientes-mapa')
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setClientes(data)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    carregarVeiculos()
    carregarClientes()
    const interval = setInterval(() => carregarVeiculos(true), 60000)
    const onOnline = () => { setOffline(false); carregarVeiculos(true); carregarClientes() }
    const onOffline = () => setOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [carregarVeiculos, carregarClientes])

  // Focar no veiculo no mapa
  const focarVeiculo = useCallback((v: Veiculo) => {
    setSelectedVeiculo(v)
    setPainelAberto(false)
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([v.lat, v.lng], 15, { animate: true })
    }
  }, [])

  // Focar no tecnico (acha o veiculo dele)
  const focarTecnico = useCallback((motorista: string) => {
    const v = veiculos.find(x => x.motorista === motorista)
    if (v) focarVeiculo(v)
  }, [veiculos, focarVeiculo])

  // Carregar rota do veiculo
  const carregarRota = useCallback(async (v: Veiculo) => {
    if (rotaVeiculoId === v.id) {
      // Toggle off
      if (rotaLayerRef.current) { rotaLayerRef.current.remove(); rotaLayerRef.current = null }
      setRotaVeiculoId(null)
      return
    }

    setLoadingRota(true)
    setRotaVeiculoId(v.id)
    if (rotaLayerRef.current) { rotaLayerRef.current.remove(); rotaLayerRef.current = null }

    try {
      const res = await fetch(`/api/veiculos-mapa/rota?adesaoId=${v.id}`)
      if (!res.ok) throw new Error('Erro')
      const pontos: PontoRota[] = await res.json()

      if (pontos.length > 1 && mapInstanceRef.current && leafletRef.current) {
        const L = leafletRef.current
        const map = mapInstanceRef.current

        const latlngs = pontos.map(p => [p.lat, p.lng] as [number, number])

        const group = L.layerGroup()

        // Linha da rota
        L.polyline(latlngs, { color: '#1E3A5F', weight: 3, opacity: 0.7 }).addTo(group)

        // Marcador inicio (verde)
        const primeiro = pontos[0]
        L.circleMarker([primeiro.lat, primeiro.lng], {
          radius: 7, fillColor: '#22C55E', fillOpacity: 1, color: '#fff', weight: 2,
        }).addTo(group).bindTooltip(
          `Inicio: ${new Date(primeiro.dt_posicao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
          { permanent: false, direction: 'top' },
        )

        // Marcador fim (vermelho)
        const ultimo = pontos[pontos.length - 1]
        L.circleMarker([ultimo.lat, ultimo.lng], {
          radius: 7, fillColor: '#DC2626', fillOpacity: 1, color: '#fff', weight: 2,
        }).addTo(group).bindTooltip(
          `Atual: ${new Date(ultimo.dt_posicao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
          { permanent: false, direction: 'top' },
        )

        group.addTo(map)
        rotaLayerRef.current = group

        // Ajustar zoom para a rota
        map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] })
      }
    } catch { /* ignore */ }

    setLoadingRota(false)
  }, [rotaVeiculoId])

  // Renderizar mapa
  useEffect(() => {
    if (!mapRef.current || veiculos.length === 0) return

    import('leaflet').then((L) => {
      if (!mapRef.current) return
      leafletRef.current = L

      if (!mapInstanceRef.current) {
        const map = L.map(mapRef.current, { zoomControl: false })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OSM',
        }).addTo(map)
        L.control.zoom({ position: 'bottomright' }).addTo(map)
        mapInstanceRef.current = map
      }

      const map = mapInstanceRef.current
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      const bounds: [number, number][] = []
      veiculos.forEach((v) => {
        bounds.push([v.lat, v.lng])
        const isOn = v.ignicao === 1
        const isMoving = v.velocidade > 0

        const icon = L.divIcon({
          className: '',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
          html: `<div style="
            width:36px;height:36px;border-radius:50%;
            background:${isOn ? (isMoving ? '#22C55E' : '#F59E0B') : '#9CA3AF'};
            border:3px solid ${rotaVeiculoId === v.id ? '#1E3A5F' : '#fff'};
            box-shadow:0 2px 8px rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;
            font-size:10px;font-weight:800;color:#fff;
          ">${v.placa.slice(-4)}</div>`,
        })

        const marker = L.marker([v.lat, v.lng], { icon })
          .addTo(map)
          .on('click', () => {
            setSelectedVeiculo(v)
            setPainelAberto(false)
          })

        const tempoAtras = v.dt_posicao
          ? Math.round((Date.now() - new Date(v.dt_posicao).getTime()) / 60000) : null

        const tooltipLines = [
          `<b>${v.placa}</b>`,
          v.motorista ? `<span style="color:#1E3A5F">${v.motorista}</span>` : '',
          v.cliente ? `<small>${v.cliente}</small>` : '',
          isOn ? (isMoving ? `${v.velocidade} km/h` : 'Parado (ligado)') : 'Desligado',
          tempoAtras !== null ? `<small>${tempoAtras < 2 ? 'Agora' : `${tempoAtras}min atras`}</small>` : '',
        ].filter(Boolean)

        marker.bindTooltip(tooltipLines.join('<br/>'), { direction: 'top', offset: [0, -20] })
        markersRef.current.push(marker)
      })

      if (bounds.length > 0 && !(markersRef.current as any)._fitted) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
        ;(markersRef.current as any)._fitted = true
      }
    })
  }, [veiculos, rotaVeiculoId])

  // Renderizar clientes no mapa
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return

    // Limpar markers anteriores
    clienteMarkersRef.current.forEach((m) => m.remove())
    clienteMarkersRef.current = []

    if (!showClientes || clientes.length === 0) return

    const L = leafletRef.current
    const map = mapInstanceRef.current

    clientes.forEach((c) => {
      const icon = L.divIcon({
        className: '',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        html: `<div style="
          width:12px;height:12px;border-radius:50%;
          background:#3B82F6;border:2px solid #fff;
          box-shadow:0 1px 4px rgba(0,0,0,0.3);
        "></div>`,
      })

      const marker = L.marker([c.lat, c.lng], { icon, zIndexOffset: -100 })
        .addTo(map)
        .bindTooltip(
          `<b>${c.nome}</b><br/><small>${c.cidade}${c.estado ? ` - ${c.estado}` : ''}</small>`,
          { direction: 'top', offset: [0, -8] }
        )

      clienteMarkersRef.current.push(marker)
    })
  }, [clientes, showClientes])

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null }
    }
  }, [])

  // Deep-link de infração: foca no ponto + marker pulsante vermelho
  useEffect(() => {
    if (!deeplink || !mapInstanceRef.current || !leafletRef.current) return
    const L = leafletRef.current
    const map = mapInstanceRef.current

    if (infracaoMarkerRef.current) infracaoMarkerRef.current.remove()

    const icon = L.divIcon({
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      html: `<div style="
        width:40px;height:40px;border-radius:50%;
        background:rgba(220,38,38,0.25);
        display:flex;align-items:center;justify-content:center;
        animation: pulse-infracao 1.5s ease-in-out infinite;
      ">
        <div style="
          width:20px;height:20px;border-radius:50%;
          background:#DC2626;border:3px solid #fff;
          box-shadow:0 2px 8px rgba(0,0,0,0.4);
        "></div>
      </div>
      <style>@keyframes pulse-infracao{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:0.6}}</style>`,
    })

    const marker = L.marker([deeplink.lat, deeplink.lng], { icon, zIndexOffset: 1000 })
      .addTo(map)
      .bindTooltip('Infração de velocidade aqui', { permanent: true, direction: 'top', offset: [0, -15] })
    infracaoMarkerRef.current = marker

    // Foca com zoom alto e atrasa pra dar tempo dos tiles carregarem
    setTimeout(() => map.setView([deeplink.lat, deeplink.lng], 17, { animate: true }), 200)

    return () => {
      if (infracaoMarkerRef.current) {
        infracaoMarkerRef.current.remove()
        infracaoMarkerRef.current = null
      }
    }
  }, [deeplink, veiculos])

  // Listas filtradas
  const tecnicos = [...new Map(
    veiculos.filter(v => v.motorista).map(v => [v.motorista, v])
  ).values()]

  const buscaLower = busca.toLowerCase()
  const tecnicosFiltrados = tecnicos.filter(v =>
    v.motorista.toLowerCase().includes(buscaLower) ||
    v.placa.toLowerCase().includes(buscaLower) ||
    v.cliente.toLowerCase().includes(buscaLower)
  )
  const veiculosFiltrados = veiculos.filter(v =>
    v.placa.toLowerCase().includes(buscaLower) ||
    v.motorista.toLowerCase().includes(buscaLower) ||
    (v.descricao || v.modelo).toLowerCase().includes(buscaLower)
  )
  const clientesFiltrados = clientes.filter(c =>
    c.nome.toLowerCase().includes(buscaLower) ||
    c.cidade.toLowerCase().includes(buscaLower)
  )

  if (offline) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '60vh', gap: 16, padding: 32, textAlign: 'center',
      }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: colors.warningBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <WifiOff size={32} color={colors.warning} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: colors.text }}>Sem conexao</div>
        <div style={{ fontSize: 14, color: colors.textMuted, lineHeight: 1.6 }}>O mapa precisa de internet.</div>
        <button onClick={() => carregarVeiculos()} style={{
          marginTop: 8, padding: '12px 24px', borderRadius: 12,
          background: colors.primary, color: '#fff', border: 'none',
          fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <RefreshCw size={16} /> Tentar novamente
        </button>
        <Link href="/" style={{ fontSize: 13, color: colors.textSubtle, marginTop: 8 }}>Voltar</Link>
      </div>
    )
  }

  if (loading) return <PageSpinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, margin: -16 }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: colors.surface, borderBottom: `1px solid ${colors.border}`, zIndex: 500,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/" style={{
            width: 34, height: 34, borderRadius: 10,
            background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: colors.textSubtle, textDecoration: 'none',
          }}>
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>Mapa de Veiculos</div>
            <div style={{ fontSize: 10, color: colors.textMuted }}>
              {veiculos.length} veiculo{veiculos.length !== 1 ? 's' : ''} · {tecnicos.length} tecnico{tecnicos.length !== 1 ? 's' : ''} · {clientes.length} cliente{clientes.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowClientes(!showClientes)} style={{
            background: showClientes ? '#3B82F6' : colors.surfaceAlt,
            border: `1px solid ${showClientes ? '#3B82F6' : colors.border}`,
            borderRadius: 10, padding: '7px 10px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
            color: showClientes ? '#fff' : colors.textSubtle,
          }}>
            <MapPin size={14} /> Clientes
          </button>
          <button onClick={() => { setPainelAberto(!painelAberto); setSelectedVeiculo(null) }} style={{
            background: painelAberto ? colors.primary : colors.surfaceAlt,
            border: `1px solid ${painelAberto ? colors.primary : colors.border}`,
            borderRadius: 10, padding: '7px 10px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
            color: painelAberto ? '#fff' : colors.textSubtle,
          }}>
            <Search size={14} /> Buscar
          </button>
          <button onClick={() => carregarVeiculos(true)} disabled={refreshing} style={{
            background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
            borderRadius: 10, padding: '7px 10px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: colors.textSubtle,
          }}>
            <RefreshCw size={14} className={refreshing ? 'spinner' : ''} />
          </button>
        </div>
      </div>

      {erro && (
        <div style={{ padding: '8px 16px', background: colors.dangerBg, color: colors.danger, fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
          {erro}
        </div>
      )}

      {deeplink && (
        <div style={{
          padding: '10px 16px', background: colors.dangerBg,
          borderBottom: `1px solid ${colors.dangerBorder}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertTriangle size={16} color={colors.danger} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.danger }}>
              Visualizando infração
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>
              {deeplink.placa && `Placa ${deeplink.placa}`}
              {deeplink.data && ` · ${new Date(deeplink.data + 'T00:00:00').toLocaleDateString('pt-BR')}`}
            </div>
          </div>
          <Link href="/relatorios" style={{
            fontSize: 11, fontWeight: 700, color: colors.danger,
            background: '#fff', padding: '5px 10px', borderRadius: 8,
            border: `1px solid ${colors.dangerBorder}`, textDecoration: 'none',
            flexShrink: 0,
          }}>
            Voltar
          </Link>
        </div>
      )}

      {/* Mapa */}
      <div ref={mapRef} style={{ width: '100%', height: 'calc(100vh - 160px)', minHeight: 400 }} />

      {/* Painel de Busca */}
      {painelAberto && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
          background: '#fff', borderRadius: '16px 16px 0 0',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
          maxHeight: '55vh', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D5DB', margin: '0 auto 10px' }} />

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 10, background: colors.surfaceAlt, borderRadius: 10, padding: 3 }}>
              {(['tecnicos', 'veiculos', 'clientes'] as const).map((tab) => (
                <button key={tab} onClick={() => setAbaAtiva(tab)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                  background: abaAtiva === tab ? '#fff' : 'transparent',
                  color: abaAtiva === tab ? colors.primary : colors.textSubtle,
                  boxShadow: abaAtiva === tab ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}>
                  {tab === 'tecnicos' ? `Tec (${tecnicos.length})` : tab === 'veiculos' ? `Veic (${veiculos.length})` : `Cli (${clientes.length})`}
                </button>
              ))}
            </div>

            {/* Busca */}
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <Search size={14} color={colors.textSubtle} style={{ position: 'absolute', left: 12, top: 10 }} />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={abaAtiva === 'tecnicos' ? 'Buscar tecnico...' : 'Buscar placa...'}
                style={{
                  width: '100%', padding: '9px 12px 9px 34px', borderRadius: 10,
                  border: `1.5px solid ${colors.border}`, fontSize: 13, outline: 'none',
                  background: '#FAFAFA', boxSizing: 'border-box',
                }}
              />
              {busca && (
                <button onClick={() => setBusca('')} style={{
                  position: 'absolute', right: 10, top: 8, background: 'none', border: 'none', cursor: 'pointer',
                }}>
                  <X size={14} color={colors.textSubtle} />
                </button>
              )}
            </div>
          </div>

          {/* Lista */}
          <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 16px' }}>
            {abaAtiva === 'clientes' ? (
              clientesFiltrados.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: colors.textMuted, fontSize: 13 }}>
                  {clientes.length === 0 ? 'Carregando clientes...' : 'Nenhum resultado'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {clientesFiltrados.slice(0, 50).map((c) => (
                    <button key={c.id} onClick={() => {
                      if (mapInstanceRef.current) {
                        mapInstanceRef.current.setView([c.lat, c.lng], 15, { animate: true })
                        setPainelAberto(false)
                        if (!showClientes) setShowClientes(true)
                      }
                    }} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                      background: '#fff', borderRadius: 12, border: `1px solid ${colors.border}`,
                      cursor: 'pointer', textAlign: 'left', width: '100%',
                    }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 12,
                        background: '#DBEAFE', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <MapPin size={18} color="#3B82F6" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</div>
                        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                          {c.cidade}{c.estado ? ` - ${c.estado}` : ''}
                        </div>
                      </div>
                    </button>
                  ))}
                  {clientesFiltrados.length > 50 && (
                    <div style={{ textAlign: 'center', padding: 8, color: colors.textSubtle, fontSize: 11 }}>
                      Mostrando 50 de {clientesFiltrados.length} — use a busca para filtrar
                    </div>
                  )}
                </div>
              )
            ) : abaAtiva === 'tecnicos' ? (
              tecnicosFiltrados.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: colors.textMuted, fontSize: 13 }}>
                  {tecnicos.length === 0 ? 'Nenhum tecnico com check-in hoje' : 'Nenhum resultado'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {tecnicosFiltrados.map((v) => {
                    const isOn = v.ignicao === 1
                    const isMoving = v.velocidade > 0
                    return (
                      <button key={v.motorista} onClick={() => focarTecnico(v.motorista)} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                        background: '#fff', borderRadius: 12, border: `1px solid ${colors.border}`,
                        cursor: 'pointer', textAlign: 'left', width: '100%',
                      }}>
                        <div style={{
                          width: 38, height: 38, borderRadius: 12,
                          background: colors.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          <User size={18} color={colors.accent} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{v.motorista}</div>
                          <div style={{ fontSize: 11, color: colors.textMuted, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <Car size={11} /> {v.placa}
                            <span style={{ color: colors.border }}>|</span>
                            {v.cliente || 'Sem destino'}
                          </div>
                        </div>
                        <div style={{
                          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                          background: isOn ? (isMoving ? '#22C55E' : '#F59E0B') : '#D1D5DB',
                        }} />
                      </button>
                    )
                  })}
                </div>
              )
            ) : (
              veiculosFiltrados.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: colors.textMuted, fontSize: 13 }}>Nenhum resultado</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {veiculosFiltrados.map((v) => {
                    const isOn = v.ignicao === 1
                    const isMoving = v.velocidade > 0
                    const temRota = rotaVeiculoId === v.id
                    return (
                      <div key={v.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                        background: temRota ? colors.accentBg : '#fff', borderRadius: 12,
                        border: `1px solid ${temRota ? colors.accent : colors.border}`,
                      }}>
                        <button onClick={() => focarVeiculo(v)} style={{
                          display: 'flex', alignItems: 'center', gap: 10, flex: 1,
                          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0,
                        }}>
                          <div style={{
                            width: 38, height: 38, borderRadius: 12, flexShrink: 0,
                            background: isOn ? (isMoving ? colors.successBg : colors.warningBg) : colors.surfaceAlt,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Car size={18} color={isOn ? (isMoving ? colors.success : colors.warning) : colors.textSubtle} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{v.placa}</div>
                            <div style={{ fontSize: 11, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {v.motorista || v.descricao || v.modelo || 'Sem motorista'}
                              {v.cliente ? ` · ${v.cliente}` : ''}
                            </div>
                          </div>
                        </button>
                        <button onClick={() => carregarRota(v)} disabled={loadingRota && rotaVeiculoId !== v.id} style={{
                          padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                          background: temRota ? colors.accent : colors.surfaceAlt,
                          color: temRota ? '#fff' : colors.textSubtle,
                          fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                        }}>
                          {loadingRota && rotaVeiculoId === v.id ? (
                            <Loader2 size={12} className="spinner" />
                          ) : (
                            <><Route size={12} /> {temRota ? 'Ocultar' : 'Rota'}</>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Painel do veiculo selecionado */}
      {selectedVeiculo && !painelAberto && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
          background: '#fff', borderRadius: '16px 16px 0 0', padding: '14px 20px 22px',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
        }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D5DB', margin: '0 auto 10px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 14,
                background: selectedVeiculo.ignicao ? (selectedVeiculo.velocidade > 0 ? colors.successBg : colors.warningBg) : colors.surfaceAlt,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Car size={22} color={selectedVeiculo.ignicao ? (selectedVeiculo.velocidade > 0 ? colors.success : colors.warning) : colors.textSubtle} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: colors.text }}>{selectedVeiculo.placa}</div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>{selectedVeiculo.descricao || selectedVeiculo.modelo}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => carregarRota(selectedVeiculo)} style={{
                padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: rotaVeiculoId === selectedVeiculo.id ? colors.accent : colors.surfaceAlt,
                color: rotaVeiculoId === selectedVeiculo.id ? '#fff' : colors.textSubtle,
                fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {loadingRota ? <Loader2 size={12} className="spinner" /> : <Route size={12} />}
                {rotaVeiculoId === selectedVeiculo.id ? 'Ocultar rota' : 'Ver rota'}
              </button>
              <button onClick={() => setSelectedVeiculo(null)} style={{
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: colors.textSubtle, padding: 4,
              }}>x</button>
            </div>
          </div>

          {(selectedVeiculo.motorista || selectedVeiculo.cliente) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {selectedVeiculo.motorista && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <User size={13} color={colors.primary} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{selectedVeiculo.motorista}</span>
                </div>
              )}
              {selectedVeiculo.cliente && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Briefcase size={13} color={colors.accent} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted }}>
                    {selectedVeiculo.id_ordem && selectedVeiculo.id_ordem !== 'OFICINA' ? `OS ${selectedVeiculo.id_ordem} - ` : ''}
                    {selectedVeiculo.cliente}
                  </span>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <div style={{
              flex: 1, background: colors.surfaceAlt, borderRadius: 10, padding: '8px 10px',
              textAlign: 'center', border: `1px solid ${colors.border}`,
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: selectedVeiculo.ignicao ? colors.success : colors.textSubtle }}>
                {selectedVeiculo.ignicao ? 'Ligado' : 'Desligado'}
              </div>
              <div style={{ fontSize: 9, color: colors.textMuted, marginTop: 2 }}>Ignicao</div>
            </div>
            <div style={{
              flex: 1, background: colors.surfaceAlt, borderRadius: 10, padding: '8px 10px',
              textAlign: 'center', border: `1px solid ${colors.border}`,
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: selectedVeiculo.velocidade > 0 ? colors.primary : colors.textSubtle }}>
                {selectedVeiculo.velocidade} km/h
              </div>
              <div style={{ fontSize: 9, color: colors.textMuted, marginTop: 2 }}>Velocidade</div>
            </div>
            <div style={{
              flex: 1, background: colors.surfaceAlt, borderRadius: 10, padding: '8px 10px',
              textAlign: 'center', border: `1px solid ${colors.border}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: colors.textSubtle }}>
                {selectedVeiculo.dt_posicao
                  ? new Date(selectedVeiculo.dt_posicao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                  : '--'}
              </div>
              <div style={{ fontSize: 9, color: colors.textMuted, marginTop: 2 }}>Ultima pos.</div>
            </div>
          </div>
        </div>
      )}

      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </div>
  )
}
