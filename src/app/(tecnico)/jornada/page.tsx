'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { geocodificar, rotaDaOficina } from '@/lib/ors'
import {
  Car, MapPin, Clock, Navigation, Plus, Trash2, Edit3, Check, X,
  Loader2, Wrench, ArrowLeft, Route,
} from 'lucide-react'
import { colors } from '@/lib/ui'
import { PageSpinner } from '@/components/ui'
import Link from 'next/link'

interface CheckinEntry {
  id: number
  placa: string
  id_ordem: string
  cliente: string
  destino: string
  distancia_km: number | null
  tempo_estimado_min: number | null
  lat_destino: number | null
  lng_destino: number | null
}

interface OrdemOption {
  Id_Ordem: string
  Os_Cliente: string
  Endereco_Cliente: string
  Qtd_HR: number | null
}

export default function JornadaPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [entries, setEntries] = useState<CheckinEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [veiculos, setVeiculos] = useState<{ IdPlaca: number; NumPlaca: string }[]>([])
  const [ordens, setOrdens] = useState<OrdemOption[]>([])

  // Form para adicionar/editar
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [placa, setPlaca] = useState('')
  const [ordemId, setOrdemId] = useState('')
  const [saving, setSaving] = useState(false)
  const [calculando, setCalculando] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const tecnicoNome = user?.tecnico_nome || ''
  const nomeBusca = user?.nome_pos || user?.tecnico_nome || ''
  const hoje = new Date().toISOString().split('T')[0]

  const carregar = useCallback(async () => {
    if (!tecnicoNome) return
    setLoading(true)

    const [entriesRes, veicRes, osRes] = await Promise.all([
      supabase
        .from('checkin_diario')
        .select('id, placa, id_ordem, cliente, destino, distancia_km, tempo_estimado_min, lat_destino, lng_destino')
        .eq('tecnico_nome', tecnicoNome)
        .eq('data', hoje)
        .order('id'),
      supabase.from('SupaPlacas').select('IdPlaca, NumPlaca').order('NumPlaca'),
      supabase
        .from('Ordem_Servico')
        .select('Id_Ordem, Os_Cliente, Endereco_Cliente, Qtd_HR')
        .not('Status', 'in', '("Concluida","Cancelada","Concluída","cancelada")')
        .or(`Os_Tecnico.ilike.%${nomeBusca}%,Os_Tecnico2.ilike.%${nomeBusca}%`),
    ])

    setEntries((entriesRes.data || []) as CheckinEntry[])
    if (veicRes.data) setVeiculos(veicRes.data)
    if (osRes.data) setOrdens(osRes.data as OrdemOption[])
    setLoading(false)
  }, [tecnicoNome, nomeBusca, hoje])

  useEffect(() => {
    if (user) carregar()
  }, [user, carregar])

  const getOrdem = (idOrdem: string) => ordens.find(o => o.Id_Ordem === idOrdem)

  const openAdd = () => {
    setEditingId(null)
    setPlaca(entries.length > 0 ? entries[0].placa : '')
    setOrdemId('')
    setShowForm(true)
  }

  const openEdit = (entry: CheckinEntry) => {
    setEditingId(entry.id)
    setPlaca(entry.placa)
    setOrdemId(entry.id_ordem)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setPlaca('')
    setOrdemId('')
  }

  const salvar = async () => {
    if (!placa || !ordemId) return
    setSaving(true)

    const isOficina = ordemId === 'OFICINA'
    const ordem = isOficina ? null : getOrdem(ordemId)
    let distancia_km: number | null = null
    let tempo_estimado_min: number | null = null
    let lat_destino: number | null = null
    let lng_destino: number | null = null

    if (!isOficina && ordem?.Endereco_Cliente) {
      setCalculando(true)
      const coords = await geocodificar(ordem.Endereco_Cliente + ', SP, Brasil')
      if (coords) {
        lat_destino = coords.lat
        lng_destino = coords.lng
        const rota = await rotaDaOficina(coords.lat, coords.lng)
        if (rota) {
          distancia_km = rota.distancia_km
          tempo_estimado_min = rota.tempo_min
        }
      }
      setCalculando(false)
    }

    const payload = {
      tecnico_nome: tecnicoNome,
      data: hoje,
      placa,
      id_ordem: isOficina ? 'OFICINA' : ordemId,
      cliente: isOficina ? 'Oficina' : (ordem?.Os_Cliente || ''),
      destino: isOficina ? 'Oficina - Servico interno' : (ordem?.Endereco_Cliente || ''),
      lat_destino: isOficina ? null : lat_destino,
      lng_destino: isOficina ? null : lng_destino,
      distancia_km: isOficina ? 0 : distancia_km,
      tempo_estimado_min: isOficina ? 0 : tempo_estimado_min,
    }

    if (editingId) {
      await supabase.from('checkin_diario').update(payload).eq('id', editingId)
    } else {
      await supabase.from('checkin_diario').insert(payload)
    }

    closeForm()
    setSaving(false)
    await carregar()
  }

  const deletar = async (id: number) => {
    if (entries.length <= 1) return // Nao pode deletar a unica entrada
    setDeletingId(id)
    await supabase.from('checkin_diario').delete().eq('id', id)
    setDeletingId(null)
    await carregar()
  }

  const formatTempo = (min: number) => {
    if (min >= 60) return `${Math.floor(min / 60)}h${min % 60 > 0 ? `${min % 60}min` : ''}`
    return `${min} min`
  }

  if (userLoading || loading) return <PageSpinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/" style={{
          width: 36, height: 36, borderRadius: 10,
          background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: colors.textSubtle, textDecoration: 'none',
        }}>
          <ArrowLeft size={18} />
        </Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937', margin: 0 }}>Jornada</h1>
          <div style={{ fontSize: 12, color: colors.textMuted, textTransform: 'capitalize' }}>
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
        <button onClick={openAdd} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#C41E2A', color: '#fff', border: 'none',
          borderRadius: 10, padding: '8px 14px', fontSize: 13,
          fontWeight: 700, cursor: 'pointer',
        }}>
          <Plus size={16} /> Adicionar
        </button>
      </div>

      {/* Resumo do dia */}
      {entries.length > 0 && (() => {
        const totalDeslocamento = entries.reduce((sum, e) => sum + (e.tempo_estimado_min || 0), 0)
        const totalExecucao = entries.reduce((sum, e) => {
          const os = getOrdem(e.id_ordem)
          return sum + ((os?.Qtd_HR || 0) * 60)
        }, 0)
        const totalKm = entries.reduce((sum, e) => sum + (e.distancia_km || 0), 0)
        const totalGeral = totalDeslocamento + totalExecucao

        return (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
          }}>
            <div style={{
              background: colors.infoBg, borderRadius: 12, padding: '12px 8px',
              textAlign: 'center', border: `1px solid ${colors.infoBorder}`,
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.info }}>
                {totalKm > 0 ? `${totalKm.toFixed(0)} km` : '--'}
              </div>
              <div style={{ fontSize: 10, color: colors.textMuted }}>Deslocamento</div>
            </div>
            <div style={{
              background: colors.warningBg, borderRadius: 12, padding: '12px 8px',
              textAlign: 'center', border: `1px solid ${colors.warningBorder}`,
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.warning }}>
                {totalDeslocamento > 0 ? formatTempo(totalDeslocamento) : '--'}
              </div>
              <div style={{ fontSize: 10, color: colors.textMuted }}>Viagem</div>
            </div>
            <div style={{
              background: colors.successBg, borderRadius: 12, padding: '12px 8px',
              textAlign: 'center', border: `1px solid ${colors.successBorder}`,
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.success }}>
                {totalGeral > 0 ? formatTempo(totalGeral) : '--'}
              </div>
              <div style={{ fontSize: 10, color: colors.textMuted }}>Total dia</div>
            </div>
          </div>
        )
      })()}

      {/* Lista de destinos */}
      {entries.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: 16, padding: '40px 20px',
          textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          <Route size={36} color={colors.border} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.textSubtle, marginBottom: 4 }}>
            Nenhum destino registrado
          </div>
          <div style={{ fontSize: 13, color: colors.textMuted }}>
            Adicione seu primeiro destino do dia
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {entries.map((entry, idx) => {
            const os = getOrdem(entry.id_ordem)
            const isOficina = entry.id_ordem === 'OFICINA'
            const tempoExecucao = os?.Qtd_HR ? os.Qtd_HR * 60 : 0
            const tempoDeslocamento = entry.tempo_estimado_min || 0
            const tempoTotal = tempoDeslocamento + tempoExecucao
            const isDeleting = deletingId === entry.id

            return (
              <div key={entry.id} style={{
                background: '#fff', borderRadius: 16, overflow: 'hidden',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                borderLeft: `4px solid ${isOficina ? colors.success : colors.primary}`,
                opacity: isDeleting ? 0.5 : 1,
              }}>
                <div style={{ padding: '14px 16px' }}>
                  {/* Header da entry */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 10,
                        background: isOficina ? colors.successBg : colors.primaryBg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isOficina
                          ? <Wrench size={16} color={colors.success} />
                          : <span style={{ fontSize: 14, fontWeight: 800, color: colors.primary }}>{idx + 1}</span>
                        }
                      </div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>
                          {isOficina ? 'Oficina' : entry.cliente || 'Cliente'}
                        </div>
                        {!isOficina && entry.id_ordem && (
                          <div style={{ fontSize: 11, color: colors.primary, fontWeight: 600 }}>
                            OS {entry.id_ordem}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(entry)} style={{
                        width: 32, height: 32, borderRadius: 8, border: `1px solid ${colors.border}`,
                        background: colors.surfaceAlt, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Edit3 size={14} color={colors.textSubtle} />
                      </button>
                      {entries.length > 1 && (
                        <button onClick={() => deletar(entry.id)} disabled={isDeleting} style={{
                          width: 32, height: 32, borderRadius: 8, border: `1px solid ${colors.dangerBorder}`,
                          background: colors.dangerBg, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Trash2 size={14} color={colors.danger} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Car size={13} color={colors.textSubtle} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted }}>{entry.placa}</span>
                    {entry.destino && !isOficina && (
                      <>
                        <span style={{ color: colors.border }}>|</span>
                        <MapPin size={12} color={colors.textSubtle} />
                        <span style={{ fontSize: 11, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {entry.destino}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Tempos */}
                  {!isOficina && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{
                        flex: 1, background: colors.surfaceAlt, borderRadius: 10, padding: '8px 10px',
                        display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${colors.border}`,
                      }}>
                        <Navigation size={13} color={colors.info} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>
                            {tempoDeslocamento > 0 ? formatTempo(tempoDeslocamento) : '--'}
                          </div>
                          <div style={{ fontSize: 9, color: colors.textMuted }}>
                            Deslocamento{entry.distancia_km ? ` (${entry.distancia_km} km)` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{
                        flex: 1, background: colors.surfaceAlt, borderRadius: 10, padding: '8px 10px',
                        display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${colors.border}`,
                      }}>
                        <Wrench size={13} color={colors.warning} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>
                            {tempoExecucao > 0 ? formatTempo(tempoExecucao) : '--'}
                          </div>
                          <div style={{ fontSize: 9, color: colors.textMuted }}>Execucao (OS)</div>
                        </div>
                      </div>
                      <div style={{
                        flex: 1, background: colors.primaryBg, borderRadius: 10, padding: '8px 10px',
                        display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${colors.primary}20`,
                      }}>
                        <Clock size={13} color={colors.primary} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: colors.primary }}>
                            {tempoTotal > 0 ? formatTempo(tempoTotal) : '--'}
                          </div>
                          <div style={{ fontSize: 9, color: colors.textMuted }}>Total</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {isOficina && (
                    <div style={{
                      background: colors.successBg, borderRadius: 10, padding: '8px 12px',
                      display: 'flex', alignItems: 'center', gap: 8,
                      border: `1px solid ${colors.successBorder}`,
                    }}>
                      <Wrench size={14} color={colors.success} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: colors.success }}>
                        Servico interno - sem deslocamento
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Adicionar/Editar */}
      {showForm && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
          onClick={closeForm}
        >
          <div
            style={{
              background: '#fff', borderRadius: '20px 20px 0 0', padding: '20px 20px 32px',
              width: '100%', maxWidth: 500, maxHeight: '80vh', overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              width: 40, height: 4, borderRadius: 2, background: '#D1D5DB',
              margin: '0 auto 16px',
            }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', margin: 0 }}>
                {editingId ? 'Editar Destino' : 'Novo Destino'}
              </h2>
              <button onClick={closeForm} style={{
                width: 32, height: 32, borderRadius: 8, border: 'none',
                background: '#F3F4F6', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={16} color="#6B7280" />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Veiculo */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Car size={14} /> VEICULO
                </label>
                <select value={placa} onChange={(e) => setPlaca(e.target.value)} style={{
                  width: '100%', padding: '13px 14px', borderRadius: 12,
                  border: `2px solid ${placa ? colors.primary : colors.border}`,
                  fontSize: 15, fontWeight: 600, background: '#FAFAFA',
                  outline: 'none', appearance: 'none',
                  color: placa ? colors.text : '#9CA3AF',
                }}>
                  <option value="">Selecione o veiculo...</option>
                  {veiculos.map((v) => (
                    <option key={v.IdPlaca} value={v.NumPlaca}>{v.NumPlaca}</option>
                  ))}
                </select>
              </div>

              {/* Ordem de Servico */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <MapPin size={14} /> DESTINO
                </label>
                <select value={ordemId} onChange={(e) => setOrdemId(e.target.value)} style={{
                  width: '100%', padding: '13px 14px', borderRadius: 12,
                  border: `2px solid ${ordemId ? colors.primary : colors.border}`,
                  fontSize: 14, fontWeight: 600, background: '#FAFAFA',
                  outline: 'none', appearance: 'none',
                  color: ordemId ? colors.text : '#9CA3AF',
                }}>
                  <option value="">Selecione o destino...</option>
                  <option value="OFICINA">Oficina - Servico interno</option>
                  {ordens.map((o) => (
                    <option key={o.Id_Ordem} value={o.Id_Ordem}>
                      OS {o.Id_Ordem} - {o.Os_Cliente}{o.Qtd_HR ? ` (${o.Qtd_HR}h)` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Preview da OS selecionada */}
              {ordemId && ordemId !== 'OFICINA' && (() => {
                const os = getOrdem(ordemId)
                if (!os) return null
                return (
                  <div style={{
                    background: colors.surfaceAlt, borderRadius: 12, padding: '12px 14px',
                    border: `1px solid ${colors.border}`,
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{os.Os_Cliente}</div>
                    {os.Endereco_Cliente && (
                      <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{os.Endereco_Cliente}</div>
                    )}
                    {os.Qtd_HR != null && os.Qtd_HR > 0 && (
                      <div style={{ fontSize: 12, color: colors.info, fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} /> Execucao prevista: {os.Qtd_HR}h
                      </div>
                    )}
                  </div>
                )
              })()}

              <button onClick={salvar} disabled={!placa || !ordemId || saving} style={{
                width: '100%', padding: '16px 20px', borderRadius: 14,
                background: placa && ordemId && !saving ? '#C41E2A' : '#E5E7EB',
                color: placa && ordemId ? '#fff' : '#9CA3AF',
                fontSize: 16, fontWeight: 800, border: 'none',
                cursor: placa && ordemId && !saving ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: saving ? 0.7 : 1,
              }}>
                {saving ? (
                  <>
                    <Loader2 size={18} className="spinner" />
                    {calculando ? 'Calculando rota...' : 'Salvando...'}
                  </>
                ) : (
                  <>
                    <Check size={18} />
                    {editingId ? 'Salvar Alteracao' : 'Adicionar Destino'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
