'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { WifiOff, RefreshCw, Car, MapPin, Loader2 } from 'lucide-react'
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
}

export default function MapaPage() {
  const { user } = useCurrentUser()
  const [veiculos, setVeiculos] = useState<Veiculo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [offline, setOffline] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedVeiculo, setSelectedVeiculo] = useState<Veiculo | null>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  const carregarVeiculos = useCallback(async (silencioso = false) => {
    if (!navigator.onLine) {
      setOffline(true)
      setLoading(false)
      return
    }
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

  useEffect(() => {
    carregarVeiculos()
    // Auto-refresh a cada 60s
    const interval = setInterval(() => carregarVeiculos(true), 60000)
    // Detectar online/offline
    const onOnline = () => { setOffline(false); carregarVeiculos(true) }
    const onOffline = () => setOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [carregarVeiculos])

  // Renderizar/atualizar mapa
  useEffect(() => {
    if (!mapRef.current || veiculos.length === 0) return

    import('leaflet').then((L) => {
      if (!mapRef.current) return

      // Criar mapa se nao existe
      if (!mapInstanceRef.current) {
        const map = L.map(mapRef.current, { zoomControl: false })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OSM',
        }).addTo(map)
        L.control.zoom({ position: 'bottomright' }).addTo(map)
        mapInstanceRef.current = map
      }

      const map = mapInstanceRef.current

      // Limpar marcadores antigos
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      // Adicionar marcadores dos veiculos
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
            border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;
            font-size:10px;font-weight:800;color:#fff;
          ">${v.placa.slice(-4)}</div>`,
        })

        const marker = L.marker([v.lat, v.lng], { icon })
          .addTo(map)
          .on('click', () => setSelectedVeiculo(v))

        const tempoAtras = v.dt_posicao
          ? Math.round((Date.now() - new Date(v.dt_posicao).getTime()) / 60000)
          : null

        marker.bindTooltip(
          `<b>${v.placa}</b><br/>${v.descricao || v.modelo}` +
          `<br/>${isOn ? (isMoving ? `${v.velocidade} km/h` : 'Parado (ligado)') : 'Desligado'}` +
          (tempoAtras !== null ? `<br/><small>${tempoAtras < 2 ? 'Agora' : `${tempoAtras}min atras`}</small>` : ''),
          { direction: 'top', offset: [0, -20] },
        )

        markersRef.current.push(marker)
      })

      // Ajustar zoom para todos os veiculos (so na primeira carga)
      if (bounds.length > 0 && !markersRef.current.some((m) => (m as any)._fitted)) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
        ;(markersRef.current as any)._fitted = true
      }
    })
  }, [veiculos])

  // Cleanup mapa
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  if (offline) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '60vh', gap: 16, padding: 32, textAlign: 'center',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%', background: colors.warningBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <WifiOff size={32} color={colors.warning} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: colors.text }}>Sem conexao</div>
        <div style={{ fontSize: 14, color: colors.textMuted, lineHeight: 1.6 }}>
          O mapa precisa de internet para mostrar a posicao dos veiculos em tempo real.
        </div>
        <button
          onClick={() => carregarVeiculos()}
          style={{
            marginTop: 8, padding: '12px 24px', borderRadius: 12,
            background: colors.primary, color: '#fff', border: 'none',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <RefreshCw size={16} /> Tentar novamente
        </button>
        <Link href="/" style={{ fontSize: 13, color: colors.textSubtle, marginTop: 8 }}>
          Voltar ao inicio
        </Link>
      </div>
    )
  }

  if (loading) return <PageSpinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, margin: -16 }}>
      {/* Header da pagina */}
      <div style={{
        padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: colors.surface, borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MapPin size={18} color={colors.primary} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>Mapa de Veiculos</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>
              {veiculos.length} veiculo{veiculos.length !== 1 ? 's' : ''} rastreado{veiculos.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
        <button
          onClick={() => carregarVeiculos(true)}
          disabled={refreshing}
          style={{
            background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
            borderRadius: 10, padding: '8px 12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: colors.textSubtle,
          }}
        >
          <RefreshCw size={14} className={refreshing ? 'spinner' : ''} />
          {refreshing ? '' : 'Atualizar'}
        </button>
      </div>

      {erro && (
        <div style={{
          padding: '10px 16px', background: colors.dangerBg, color: colors.danger,
          fontSize: 12, fontWeight: 600, textAlign: 'center',
        }}>
          {erro}
        </div>
      )}

      {/* Mapa */}
      <div ref={mapRef} style={{ width: '100%', height: 'calc(100vh - 180px)', minHeight: 400 }} />

      {/* Painel do veiculo selecionado */}
      {selectedVeiculo && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
          background: '#fff', borderRadius: '16px 16px 0 0', padding: '16px 20px 24px',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
        }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D5DB', margin: '0 auto 12px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: selectedVeiculo.ignicao ? (selectedVeiculo.velocidade > 0 ? colors.successBg : colors.warningBg) : colors.surfaceAlt,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Car size={24} color={selectedVeiculo.ignicao ? (selectedVeiculo.velocidade > 0 ? colors.success : colors.warning) : colors.textSubtle} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: colors.text }}>{selectedVeiculo.placa}</div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>{selectedVeiculo.descricao || selectedVeiculo.modelo}</div>
              </div>
            </div>
            <button
              onClick={() => setSelectedVeiculo(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: colors.textSubtle, padding: 4 }}
            >
              x
            </button>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
            <div style={{
              flex: 1, background: colors.surfaceAlt, borderRadius: 10, padding: '10px 12px',
              textAlign: 'center', border: `1px solid ${colors.border}`,
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: selectedVeiculo.ignicao ? colors.success : colors.textSubtle }}>
                {selectedVeiculo.ignicao ? 'Ligado' : 'Desligado'}
              </div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>Ignicao</div>
            </div>
            <div style={{
              flex: 1, background: colors.surfaceAlt, borderRadius: 10, padding: '10px 12px',
              textAlign: 'center', border: `1px solid ${colors.border}`,
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: selectedVeiculo.velocidade > 0 ? colors.primary : colors.textSubtle }}>
                {selectedVeiculo.velocidade} km/h
              </div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>Velocidade</div>
            </div>
            <div style={{
              flex: 1, background: colors.surfaceAlt, borderRadius: 10, padding: '10px 12px',
              textAlign: 'center', border: `1px solid ${colors.border}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: colors.textSubtle }}>
                {selectedVeiculo.dt_posicao
                  ? new Date(selectedVeiculo.dt_posicao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                  : '--'}
              </div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>Ultima pos.</div>
            </div>
          </div>
        </div>
      )}

      {/* Leaflet CSS */}
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </div>
  )
}
