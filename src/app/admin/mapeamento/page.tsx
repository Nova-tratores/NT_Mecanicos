'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAdmin } from '@/hooks/useAdmin'
import { colors, shadow } from '@/lib/ui'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Car, Users, MapPin, Navigation, RefreshCw, Loader2, ChevronDown,
  X, Clock, Gauge, Route, Eye, EyeOff, Link2, Unlink, Save, AlertTriangle,
} from 'lucide-react'

// ---- Types ----
interface VeiculoMapa {
  id: number; placa: string; descricao: string; modelo: string
  lat: number; lng: number; velocidade: number; ignicao: boolean
  status: string; motorista: string; na_loja: boolean
  paradas_hoje: Parada[]; tempo_ligado_min: number; pontos_hoje: number
}
interface Parada { lat: number; lng: number; inicio: string; fim: string | null; duracao_min: number }
interface Cliente { id: string; nome: string; cnpj: string; cidade: string; estado: string; lat: number; lng: number }
interface RotaPonto { lat: number; lng: number; velocidade: number; ignicao: boolean; dt: string }

const BASE_LAT = -23.2085, BASE_LNG = -49.3710

function fmtHora(iso: string | null) {
  if (!iso) return '--'
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtDuracao(min: number) {
  if (min < 60) return `${min}min`
  const r = min % 60
  return `${Math.floor(min / 60)}h${r > 0 ? r + 'min' : ''}`
}

function veiculoIcon(v: VeiculoMapa): L.DivIcon {
  const cor = v.na_loja ? '#9CA3AF' : v.ignicao ? '#16A34A' : '#F59E0B'
  return L.divIcon({
    className: '', iconSize: [36, 44], iconAnchor: [18, 44], popupAnchor: [0, -44],
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="background:${cor};color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3);max-width:90px;overflow:hidden;text-overflow:ellipsis">${v.placa}</div>
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:6px solid ${cor}"></div>
    </div>`,
  })
}

function paradaIcon(p: Parada): L.DivIcon {
  const cor = p.duracao_min < 30 ? '#EAB308' : p.duracao_min < 60 ? '#F97316' : '#EF4444'
  const ativa = !p.fim
  return L.divIcon({
    className: '', iconSize: [24, 24], iconAnchor: [12, 12],
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${cor};opacity:0.8;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff${ativa ? ';animation:pulse 1.5s infinite' : ''}">${p.duracao_min}</div>`,
  })
}

function clienteIcon(): L.DivIcon {
  return L.divIcon({
    className: '', iconSize: [20, 20], iconAnchor: [10, 10],
    html: `<div style="width:14px;height:14px;border-radius:50%;background:#3B82F6;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.25)"></div>`,
  })
}

// ========== MAIN ==========
type TabType = 'mapa' | 'vinculos'

export default function MapeamentoPage() {
  const [tab, setTab] = useState<TabType>('mapa')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: -8 }}>
      <div style={{ display: 'flex', gap: 0, background: colors.surfaceAlt, borderRadius: 12, padding: 3, marginBottom: 10 }}>
        {([['mapa', 'Mapa GPS', MapPin], ['vinculos', 'Vínculos', Link2]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key as TabType)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '10px 0', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 700,
            background: tab === key ? '#1E3A5F' : 'transparent',
            color: tab === key ? '#fff' : colors.textMuted, transition: 'all .15s',
          }}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === 'mapa' ? <MapaTab /> : <VinculosTab />}
    </div>
  )
}

// ========== MAPA TAB ==========
function MapaTab() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const veiculosLayer = useRef(L.layerGroup())
  const paradasLayer = useRef(L.layerGroup())
  const clientesLayer = useRef(L.layerGroup())
  const rotaLayer = useRef(L.layerGroup())

  const [veiculos, setVeiculos] = useState<VeiculoMapa[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<VeiculoMapa | null>(null)
  const [rota, setRota] = useState<{ pontos: RotaPonto[]; km: number } | null>(null)
  const [rotaLoading, setRotaLoading] = useState(false)
  const [showClientes, setShowClientes] = useState(false)
  const [showParadas, setShowParadas] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return
    const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([BASE_LAT, BASE_LNG], 9)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    veiculosLayer.current.addTo(map)
    paradasLayer.current.addTo(map)
    clientesLayer.current.addTo(map)
    rotaLayer.current.addTo(map)
    L.marker([BASE_LAT, BASE_LNG], {
      icon: L.divIcon({
        className: '', iconSize: [28, 28], iconAnchor: [14, 14],
        html: `<div style="width:24px;height:24px;border-radius:50%;background:#1E3A5F;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center"><div style="width:8px;height:8px;background:#fff;border-radius:50%"></div></div>`,
      }),
    }).addTo(map).bindPopup('<b>Nova Tratores</b><br>Base')
    mapInstance.current = map
    return () => { map.remove(); mapInstance.current = null }
  }, [])

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [veicRes, cliRes] = await Promise.all([
        fetch('/api/rastreamento?acao=veiculos_mapa').then(r => r.json()),
        fetch('/api/rastreamento?acao=clientes').then(r => r.json()),
      ])
      setVeiculos(Array.isArray(veicRes) ? veicRes : [])
      setClientes(Array.isArray(cliRes) ? cliRes : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const res = await fetch('/api/rastreamento?acao=veiculos_mapa')
        const data = await res.json()
        if (Array.isArray(data)) setVeiculos(data)
      } catch {}
    }, 30000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    veiculosLayer.current.clearLayers()
    for (const v of veiculos) {
      if (!v.lat || !v.lng) continue
      const marker = L.marker([v.lat, v.lng], { icon: veiculoIcon(v) })
      marker.on('click', () => { setSelected(v); setSheetOpen(true); setRota(null) })
      veiculosLayer.current.addLayer(marker)
    }
  }, [veiculos])

  useEffect(() => {
    paradasLayer.current.clearLayers()
    if (!showParadas) return
    for (const v of veiculos) {
      for (const p of v.paradas_hoje) {
        if (!p.lat || !p.lng) continue
        const m = L.marker([p.lat, p.lng], { icon: paradaIcon(p) })
        m.bindPopup(`<b>${v.placa}</b><br>${fmtHora(p.inicio)} → ${fmtHora(p.fim)}<br>${fmtDuracao(p.duracao_min)}`)
        paradasLayer.current.addLayer(m)
      }
    }
  }, [veiculos, showParadas])

  useEffect(() => {
    clientesLayer.current.clearLayers()
    if (!showClientes) return
    for (const c of clientes) {
      const m = L.marker([c.lat, c.lng], { icon: clienteIcon() })
      m.bindPopup(`<b>${c.nome}</b><br>${c.cidade}/${c.estado}`)
      clientesLayer.current.addLayer(m)
    }
  }, [clientes, showClientes])

  const carregarRota = async (veicId: number) => {
    setRotaLoading(true)
    rotaLayer.current.clearLayers()
    try {
      const res = await fetch(`/api/rastreamento?acao=posicoes&adesao_id=${veicId}`)
      const data = await res.json()
      const pontos: RotaPonto[] = data.posicoes || []
      if (pontos.length > 1) {
        const latlngs: L.LatLngExpression[] = pontos.map(p => [p.lat, p.lng])
        L.polyline(latlngs, { color: '#3B82F6', weight: 3, opacity: 0.8 }).addTo(rotaLayer.current)
        L.circleMarker([pontos[0].lat, pontos[0].lng], { radius: 7, fillColor: '#16A34A', fillOpacity: 1, color: '#fff', weight: 2 })
          .bindPopup(`<b>Início</b><br>${fmtHora(pontos[0].dt)}`).addTo(rotaLayer.current)
        const last = pontos[pontos.length - 1]
        L.circleMarker([last.lat, last.lng], { radius: 7, fillColor: '#EF4444', fillOpacity: 1, color: '#fff', weight: 2 })
          .bindPopup(`<b>Última posição</b><br>${fmtHora(last.dt)}`).addTo(rotaLayer.current)
        mapInstance.current?.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] })
      }
      setRota({ pontos, km: data.km_total || 0 })
    } catch (e) { console.error(e) }
    setRotaLoading(false)
  }

  const clearRota = () => { rotaLayer.current.clearLayers(); setRota(null) }
  const flyTo = (lat: number, lng: number) => mapInstance.current?.flyTo([lat, lng], 15, { duration: 0.8 })

  const countOnline = veiculos.filter(v => v.status === 'Online').length

  return (
    <div style={{ position: 'relative' }}>
      {/* Stats */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <div style={{ flex: 1, background: colors.surface, borderRadius: 10, padding: '8px 10px', border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Car size={14} color="#16A34A" />
          <span style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{countOnline}</span>
          <span style={{ fontSize: 10, color: colors.textMuted }}>online</span>
        </div>
        <div style={{ flex: 1, background: colors.surface, borderRadius: 10, padding: '8px 10px', border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Car size={14} color="#6B7280" />
          <span style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{veiculos.length}</span>
          <span style={{ fontSize: 10, color: colors.textMuted }}>veículos</span>
        </div>
        <button onClick={carregar} disabled={loading} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          padding: '8px 12px', borderRadius: 10, border: `1px solid ${colors.border}`,
          background: colors.surface, fontSize: 11, fontWeight: 600, color: colors.textMuted,
        }}>
          {loading ? <Loader2 size={13} className="spinner" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {/* Map */}
      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: `1px solid ${colors.border}`, boxShadow: shadow.sm }}>
        <div ref={mapRef} style={{ width: '100%', height: 'calc(100vh - 240px)', minHeight: 400 }} />
        {loading && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <Loader2 size={32} color="#1E3A5F" className="spinner" />
          </div>
        )}
        {/* Layer toggles */}
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={() => setShowClientes(!showClientes)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px', borderRadius: 8, border: 'none',
            background: showClientes ? '#3B82F6' : 'rgba(255,255,255,0.95)', color: showClientes ? '#fff' : '#374151',
            fontSize: 11, fontWeight: 600, boxShadow: '0 1px 4px rgba(0,0,0,.15)',
          }}>
            {showClientes ? <Eye size={13} /> : <EyeOff size={13} />} Clientes
          </button>
          <button onClick={() => setShowParadas(!showParadas)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px', borderRadius: 8, border: 'none',
            background: showParadas ? '#F59E0B' : 'rgba(255,255,255,0.95)', color: showParadas ? '#fff' : '#374151',
            fontSize: 11, fontWeight: 600, boxShadow: '0 1px 4px rgba(0,0,0,.15)',
          }}>
            {showParadas ? <Eye size={13} /> : <EyeOff size={13} />} Paradas
          </button>
          {rota && (
            <button onClick={clearRota} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px', borderRadius: 8, border: 'none',
              background: '#EF4444', color: '#fff', fontSize: 11, fontWeight: 600, boxShadow: '0 1px 4px rgba(0,0,0,.15)',
            }}>
              <X size={13} /> Limpar rota
            </button>
          )}
        </div>
      </div>

      {/* Vehicle list */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', marginBottom: 6, paddingLeft: 4 }}>Veículos</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {veiculos.map(v => {
            const isSelected = selected?.id === v.id
            const cor = v.na_loja ? '#9CA3AF' : v.ignicao ? '#16A34A' : '#F59E0B'
            return (
              <div key={v.id} onClick={() => { setSelected(v); setSheetOpen(true); setRota(null); flyTo(v.lat, v.lng) }} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
                background: isSelected ? '#EFF6FF' : colors.surface,
                border: `1px solid ${isSelected ? '#3B82F6' : colors.border}`, cursor: 'pointer',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: cor, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: colors.text }}>{v.placa}</div>
                  <div style={{ fontSize: 10, color: colors.textSubtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.motorista || v.descricao || 'Sem motorista'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: cor }}>{v.status}</div>
                  {v.velocidade > 0 && <div style={{ fontSize: 9, color: colors.textSubtle }}>{v.velocidade} km/h</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom sheet overlay */}
      {selected && sheetOpen && (
        <div onClick={() => setSheetOpen(false)} style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.2)', zIndex: 1999,
        }} />
      )}

      {/* Bottom sheet */}
      {selected && sheetOpen && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2000,
          background: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
          boxShadow: '0 -4px 20px rgba(0,0,0,0.15)', maxHeight: '60vh', overflowY: 'auto',
          padding: '12px 16px 24px',
        }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D5DB', margin: '0 auto 12px' }} />
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: selected.na_loja ? '#F3F4F6' : selected.ignicao ? '#DCFCE7' : '#FEF3C7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Car size={22} color={selected.na_loja ? '#9CA3AF' : selected.ignicao ? '#16A34A' : '#F59E0B'} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.text }}>{selected.placa}</div>
              <div style={{ fontSize: 12, color: colors.textSubtle }}>{selected.motorista || selected.descricao || '---'}</div>
            </div>
            <div style={{
              padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
              background: selected.ignicao ? '#DCFCE7' : '#FEE2E2',
              color: selected.ignicao ? '#16A34A' : '#EF4444',
            }}>
              {selected.ignicao ? 'Ligado' : 'Desligado'}
            </div>
            <button onClick={() => setSheetOpen(false)} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}>
              <X size={18} color="#9CA3AF" />
            </button>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            <StatCard icon={<Gauge size={14} color="#3B82F6" />} label="Velocidade" value={`${selected.velocidade} km/h`} />
            <StatCard icon={<Clock size={14} color="#8B5CF6" />} label="Ligado" value={fmtDuracao(selected.tempo_ligado_min)} />
            <StatCard icon={<Navigation size={14} color="#10B981" />} label="Pontos" value={String(selected.pontos_hoje)} />
          </div>

          {/* Route button */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button onClick={() => carregarRota(selected.id)} disabled={rotaLoading} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '11px 0', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 700,
              background: '#1E3A5F', color: '#fff',
            }}>
              {rotaLoading ? <Loader2 size={14} className="spinner" /> : <Route size={14} />}
              {rotaLoading ? 'Carregando...' : 'Ver rota do dia'}
            </button>
            <button onClick={() => flyTo(selected.lat, selected.lng)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 44, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface,
            }}>
              <Navigation size={16} color="#3B82F6" />
            </button>
          </div>

          {rota && (
            <div style={{ padding: '10px 12px', background: '#EFF6FF', borderRadius: 10, border: '1px solid #BFDBFE', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1E40AF' }}>Rota carregada</div>
              <div style={{ fontSize: 11, color: '#3B82F6', marginTop: 2 }}>
                {rota.pontos.length} pontos · {rota.km} km · {fmtHora(rota.pontos[0]?.dt)} → {fmtHora(rota.pontos[rota.pontos.length - 1]?.dt)}
              </div>
            </div>
          )}

          {/* Paradas */}
          {selected.paradas_hoje.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', marginBottom: 6 }}>
                Paradas hoje ({selected.paradas_hoje.length})
              </div>
              {selected.paradas_hoje.map((p, i) => (
                <div key={i} onClick={() => flyTo(p.lat, p.lng)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                  background: colors.surfaceAlt, marginBottom: 4, cursor: 'pointer',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: p.duracao_min < 30 ? '#EAB308' : p.duracao_min < 60 ? '#F97316' : '#EF4444',
                  }} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: colors.text }}>
                    {fmtHora(p.inicio)} → {p.fim ? fmtHora(p.fim) : 'agora'}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: p.duracao_min >= 60 ? '#EF4444' : colors.text }}>
                    {fmtDuracao(p.duracao_min)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.3);opacity:1}}`}</style>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ background: colors.surfaceAlt, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: colors.text }}>{value}</div>
      <div style={{ fontSize: 9, color: colors.textSubtle, fontWeight: 600 }}>{label}</div>
    </div>
  )
}

// ========== VÍNCULOS TAB ==========
function VinculosTab() {
  interface Veiculo { id: number; placa: string; descricao: string; modelo: string }
  interface MotoristaV { _id: string; adesao_id: number; motorista_id: number; nome: string; final: number; dt_inicio: string }
  interface Usuario { id: number; nome: string; cargo: string }
  interface VinculoSupa { tecnico_nome: string; adesao_id: number; placa: string; descricao: string }

  const [veiculos, setVeiculos] = useState<(Veiculo & { motoristaAtual: MotoristaV | null; vinculoSupa: VinculoSupa | null; novoMotoristaId: number | null })[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  const [expandido, setExpandido] = useState<number | null>(null)
  const [filtro, setFiltro] = useState<'todos' | 'vinculados' | 'livres'>('todos')

  const carregar = useCallback(async () => {
    setLoading(true); setMsg(null)
    try {
      const [veicRes, motRes, usrRes, vincRes] = await Promise.all([
        fetch('/api/rastreamento?acao=veiculos').then(r => r.json()),
        fetch('/api/rastreamento?acao=motoristas').then(r => r.json()),
        fetch('/api/rastreamento?acao=usuarios_motoristas').then(r => r.json()),
        fetch('/api/rastreamento?acao=vinculos_supabase').then(r => r.json()),
      ])
      setUsuarios(Array.isArray(usrRes) ? usrRes : [])
      const vinculoMap: Record<number, VinculoSupa> = {}
      for (const v of (Array.isArray(vincRes) ? vincRes : [])) vinculoMap[v.adesao_id] = v
      const montado = (Array.isArray(veicRes) ? veicRes : []).map((v: Veiculo) => {
        const motAtual = (Array.isArray(motRes) ? motRes : [])
          .filter((m: MotoristaV) => m.adesao_id === v.id && m.final !== 1)
          .sort((a: MotoristaV, b: MotoristaV) => (b.dt_inicio || '').localeCompare(a.dt_inicio || ''))[0] || null
        return { ...v, motoristaAtual: motAtual, vinculoSupa: vinculoMap[v.id] || null, novoMotoristaId: null }
      })
      montado.sort((a: any, b: any) => (a.motoristaAtual ? 0 : 1) - (b.motoristaAtual ? 0 : 1) || (a.placa || '').localeCompare(b.placa || ''))
      setVeiculos(montado)
    } catch (e: any) { setMsg({ tipo: 'err', texto: 'Erro: ' + e.message }) }
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const setNovoMotorista = (veiculoId: number, motoristaId: number | null) => {
    setVeiculos(prev => prev.map(v => v.id === veiculoId ? { ...v, novoMotoristaId: motoristaId } : v))
  }

  const salvarAlteracoes = async () => {
    const alterados = veiculos.filter(v => v.novoMotoristaId !== null)
    if (!alterados.length) { setMsg({ tipo: 'err', texto: 'Nenhuma alteração' }); return }
    setSalvando(true); setMsg(null); let count = 0
    try {
      for (const v of alterados) {
        if (v.motoristaAtual?._id) await fetch('/api/rastreamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'desvincular_motorista', vinculo_id: v.motoristaAtual._id }) })
        if (v.novoMotoristaId === -1) {
          await fetch('/api/rastreamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'remover_vinculo_supabase', adesao_id: v.id }) })
        } else {
          await fetch('/api/rastreamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'vincular_motorista', adesao_id: v.id, motorista_id: v.novoMotoristaId }) })
          const usr = usuarios.find(u => u.id === v.novoMotoristaId)
          if (usr) await fetch('/api/rastreamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'salvar_vinculo_supabase', tecnico_nome: usr.nome, adesao_id: v.id, placa: v.placa, descricao: v.descricao }) })
        }
        count++
      }
      setMsg({ tipo: 'ok', texto: `${count} vínculo(s) atualizado(s)!` }); await carregar()
    } catch (e: any) { setMsg({ tipo: 'err', texto: 'Erro: ' + e.message }) }
    setSalvando(false)
  }

  const desvincularDireto = async (v: any) => {
    if (!confirm(`Desvincular motorista de ${v.placa}?`)) return
    setSalvando(true)
    try {
      if (v.motoristaAtual?._id) await fetch('/api/rastreamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'desvincular_motorista', vinculo_id: v.motoristaAtual._id }) })
      await fetch('/api/rastreamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'remover_vinculo_supabase', adesao_id: v.id }) })
      setMsg({ tipo: 'ok', texto: `Desvinculado de ${v.placa}!` }); await carregar()
    } catch (e: any) { setMsg({ tipo: 'err', texto: 'Erro: ' + e.message }) }
    setSalvando(false)
  }

  const temAlteracoes = veiculos.some(v => v.novoMotoristaId !== null)
  const veiculosFiltrados = veiculos.filter(v => filtro === 'vinculados' ? !!v.motoristaAtual : filtro === 'livres' ? !v.motoristaAtual : true)
  const countVinculados = veiculos.filter(v => v.motoristaAtual).length
  const countLivres = veiculos.filter(v => !v.motoristaAtual).length

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={14} color="#D97706" />
        <span style={{ fontSize: 11, color: '#92400E', fontWeight: 500, lineHeight: 1.5 }}>
          Alterações são salvas no <strong>Rota Exata</strong> e no portal simultaneamente.
        </span>
      </div>

      {msg && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 13, textAlign: 'center', fontWeight: 600,
          background: msg.tipo === 'ok' ? colors.successBg : colors.dangerBg,
          color: msg.tipo === 'ok' ? colors.success : colors.danger,
          border: `1px solid ${msg.tipo === 'ok' ? colors.successBorder : colors.dangerBorder}`,
        }}>{msg.texto}</div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        {([['todos', `Todos (${veiculos.length})`], ['vinculados', `Vinculados (${countVinculados})`], ['livres', `Livres (${countLivres})`]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setFiltro(key as any)} style={{
            flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none',
            background: filtro === key ? '#1E3A5F' : colors.surfaceAlt, color: filtro === key ? '#fff' : colors.textMuted,
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {veiculosFiltrados.map(v => {
          const isExp = expandido === v.id
          const temMot = !!v.motoristaAtual
          const changed = v.novoMotoristaId !== null
          return (
            <div key={v.id} style={{ background: colors.surface, borderRadius: 14, overflow: 'hidden', border: `1px solid ${changed ? '#3B82F6' : temMot ? colors.successBorder : colors.border}`, boxShadow: shadow.sm }}>
              <div onClick={() => setExpandido(isExp ? null : v.id)} style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: temMot ? colors.success : '#D1D5DB', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: colors.text }}>{v.placa}</span>
                    {changed && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: '#DBEAFE', color: '#2563EB' }}>ALTERADO</span>}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textSubtle }}>{v.descricao || v.modelo || '---'}</div>
                </div>
                <div style={{ textAlign: 'right', marginRight: 4 }}>
                  {temMot ? <span style={{ fontSize: 12, fontWeight: 600, color: colors.success }}>{v.motoristaAtual!.nome}</span>
                    : <span style={{ fontSize: 11, color: colors.textSubtle, fontStyle: 'italic' }}>Sem motorista</span>}
                </div>
                <ChevronDown size={14} color="#9CA3AF" style={{ transform: isExp ? 'rotate(180deg)' : 'none', transition: '.15s', flexShrink: 0 }} />
              </div>
              {isExp && (
                <div style={{ borderTop: `1px solid ${colors.border}`, padding: 14 }}>
                  {temMot && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: colors.successBg, border: `1px solid ${colors.successBorder}`, borderRadius: 10, marginBottom: 12 }}>
                      <Users size={16} color={colors.success} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: colors.success }}>{v.motoristaAtual!.nome}</div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); desvincularDireto(v) }} disabled={salvando} style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 8,
                        border: `1px solid ${colors.dangerBorder}`, background: colors.surface, fontSize: 11, fontWeight: 600, color: colors.danger,
                      }}>
                        <Unlink size={12} /> Desvincular
                      </button>
                    </div>
                  )}
                  <div style={{ fontSize: 10, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', marginBottom: 6 }}>Vincular Motorista</div>
                  <select value={v.novoMotoristaId ?? ''} onChange={e => setNovoMotorista(v.id, e.target.value === '' ? null : parseInt(e.target.value))} style={{
                    width: '100%', padding: '11px 14px', borderRadius: 10, fontSize: 13, border: `1px solid ${colors.borderStrong}`,
                    background: '#FAFAFA', boxSizing: 'border-box', fontFamily: 'inherit',
                  }}>
                    <option value="">-- manter atual --</option>
                    <option value="-1">Sem motorista (desvincular)</option>
                    {usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}{u.cargo ? ` (${u.cargo})` : ''}</option>)}
                  </select>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {temAlteracoes && (
        <div style={{ position: 'sticky', bottom: 16, zIndex: 100 }}>
          <button onClick={salvarAlteracoes} disabled={salvando} style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: 16, borderRadius: 14, border: 'none', fontSize: 15, fontWeight: 800,
            background: salvando ? '#94a3b8' : '#1E3A5F', color: '#fff',
            boxShadow: '0 4px 20px rgba(30,58,95,0.35)',
          }}>
            {salvando ? <Loader2 size={18} className="spinner" /> : <Save size={18} />}
            {salvando ? 'Salvando...' : `Salvar ${veiculos.filter(v => v.novoMotoristaId !== null).length} alteração(ões)`}
          </button>
        </div>
      )}
    </div>
  )
}
