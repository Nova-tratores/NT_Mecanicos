'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import { getCachedVeiculos, getCachedOSList } from '@/lib/prefetch'
import { ArrowLeft, Send, CheckCircle, Wrench, Utensils, Package, Truck, Car, Fuel, Tractor, Bike, Search, Building2 } from 'lucide-react'
import Link from 'next/link'
import type { OrdemServico } from '@/lib/types'
import { notificarPortalReq } from '@/lib/notificarPortal'

const TIPOS = [
  { value: 'Peças', label: 'Peças', icon: Wrench, color: '#C41E2A' },
  { value: 'Alimentação', label: 'Alimentação', icon: Utensils, color: '#F59E0B' },
  { value: 'Ferramenta', label: 'Ferramenta', icon: Package, color: '#1E3A5F' },
  { value: 'Serviço de Terceiros', label: 'Serv. Terceiros', icon: Truck, color: '#8B5CF6' },
  { value: 'Almoxarifado', label: 'Almoxarifado', icon: Package, color: '#10B981' },
  { value: 'Insumo Infra', label: 'Insumo Infra', icon: Wrench, color: '#6B7280' },
  { value: 'Frota-Veiculos', label: 'Frota Veículos', icon: Car, color: '#3B82F6' },
  { value: 'Veicular Abastecimento', label: 'Veicular Abastecimento', icon: Fuel, color: '#C41E2A' },
  { value: 'Veicular Manutenção', label: 'Veicular Manutenção', icon: Truck, color: '#3B82F6' },
  { value: 'Trator Abastecimento', label: 'Trator Abastecimento', icon: Fuel, color: '#D97706' },
  { value: 'Quadri Abastecimento', label: 'Quadri Abastecimento', icon: Bike, color: '#10B981' },
]

const SETORES = [
  { value: 'Oficina', label: 'Oficina', icon: Wrench, color: '#C41E2A' },
  { value: 'Trator-Cliente', label: 'Trator Cliente', icon: Tractor, color: '#D97706' },
  { value: 'Trator-Loja', label: 'Trator Loja', icon: Tractor, color: '#1E3A5F' },
  { value: 'Comercial', label: 'Comercial', icon: Building2, color: '#8B5CF6' },
]

// Tipos/setores que precisam de campos extras
const TIPOS_VEICULAR = ['Frota-Veiculos', 'Veicular Abastecimento', 'Veicular Manutenção']
const TIPOS_HORIMETRO = ['Trator Abastecimento', 'Quadri Abastecimento']
const TIPOS_FERRAMENTA = ['Ferramenta']

interface OSComDetalhes {
  Id_Ordem: string
  Os_Cliente: string
  Endereco_Cliente: string
  Tipo_Servico: string
  ID_PPV: string
}

export default function NovaSolicitacao() {
  const { user } = useCurrentUser()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [sucesso, setSucesso] = useState(false)
  const [ordens, setOrdens] = useState<OSComDetalhes[]>([])
  const [veiculos, setVeiculos] = useState<{ IdPlaca: number; NumPlaca: string }[]>([])
  const [buscaIdManual, setBuscaIdManual] = useState('')
  const [buscandoOS, setBuscandoOS] = useState(false)
  const [osBuscada, setOsBuscada] = useState<OSComDetalhes | null>(null)
  const [erroBusca, setErroBusca] = useState('')
  const [chassisPOS, setChassisPOS] = useState('')
  const [modeloPOS, setModeloPOS] = useState('')

  const [form, setForm] = useState({
    material: '',
    motivo: '',
    tipo: '',
    setor: 'Oficina',
    cliente: '',
    osVinculada: '',
    chassisModelo: '',
    quemFerramenta: '',
    veiculo: '',
    kilometragem: '',
    horimetro: '',
  })

  // Backup automático do formulário
  const getFormData = useCallback(() => ({
    ...form, buscaIdManual, chassisPOS, modeloPOS,
  }), [form, buscaIdManual, chassisPOS, modeloPOS])

  const setFormData = useCallback((data: Record<string, unknown>) => {
    const { buscaIdManual: bid, chassisPOS: cp, modeloPOS: mp, ...rest } = data
    if (bid) setBuscaIdManual(bid as string)
    if (cp) setChassisPOS(cp as string)
    if (mp) setModeloPOS(mp as string)
    setForm(prev => ({ ...prev, ...rest as Partial<typeof prev> }))
  }, [])

  const { clear: clearBackup, restore: restoreBackup } = useFormBackup('req-nova', getFormData, setFormData)

  const restoredRef = useRef(false)
  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true
      restoreBackup()
    }
  }, [restoreBackup])

  useEffect(() => {
    if (!user) return
    const carregar = async () => {
      const nome = user.nome_pos || user.tecnico_nome
      // Offline: le do cache do prefetch
      if (!navigator.onLine) {
        const [osList, veics] = await Promise.all([getCachedOSList(), getCachedVeiculos()])
        if (osList) setOrdens(osList as unknown as OSComDetalhes[])
        if (veics) setVeiculos(veics)
        return
      }
      try {
        const [{ data: osData }, { data: veicData }] = await Promise.all([
          supabase
            .from('Ordem_Servico')
            .select('Id_Ordem, Os_Cliente, Endereco_Cliente, Tipo_Servico, ID_PPV')
            .not('Status', 'in', '("Concluída","Cancelada","Concluida","cancelada")')
            .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
            .order('Id_Ordem', { ascending: false }),
          supabase
            .from('SupaPlacas')
            .select('IdPlaca, NumPlaca')
            .order('NumPlaca'),
        ])
        setOrdens((osData || []) as OSComDetalhes[])
        setVeiculos(veicData || [])
      } catch {
        const [osList, veics] = await Promise.all([getCachedOSList(), getCachedVeiculos()])
        if (osList) setOrdens(osList as unknown as OSComDetalhes[])
        if (veics) setVeiculos(veics)
      }
    }
    carregar()
  }, [user])

  // Buscar OS por ID manual (que não está no nome do técnico)
  const buscarOSPorId = async () => {
    if (!buscaIdManual.trim()) return
    setBuscandoOS(true)
    setErroBusca('')
    setOsBuscada(null)

    const { data, error } = await supabase
      .from('Ordem_Servico')
      .select('Id_Ordem, Os_Cliente, Endereco_Cliente, Tipo_Servico, ID_PPV')
      .eq('Id_Ordem', buscaIdManual.trim())
      .maybeSingle()

    if (error || !data) {
      setErroBusca('OS não encontrada. Verifique o ID.')
    } else {
      setOsBuscada(data as OSComDetalhes)
    }
    setBuscandoOS(false)
  }

  // Ao selecionar uma OS, preencher cliente e buscar chassis/modelo
  const selecionarOS = async (idOrdem: string) => {
    const osLocal = ordens.find(o => o.Id_Ordem === idOrdem)
    const osSelecionada = osLocal || osBuscada

    if (!osSelecionada) {
      setForm(prev2 => ({ ...prev2, osVinculada: idOrdem }))
      return
    }

    // Preencher cliente automaticamente
    setForm(prev2 => ({
      ...prev2,
      osVinculada: idOrdem,
      cliente: osSelecionada.Os_Cliente || prev2.cliente,
    }))

    // Buscar chassis/modelo da OS Técnica se existir
    setChassisPOS('')
    setModeloPOS('')
    const { data: osTec } = await supabase
      .from('Ordem_Servico_Tecnicos')
      .select('Chassis, FotoChassis')
      .eq('Ordem_Servico', idOrdem)
      .maybeSingle()

    if (osTec) {
      const chassis = (osTec.Chassis as string) || ''
      if (chassis) {
        setChassisPOS(chassis)
        setForm(prev2 => ({ ...prev2, chassisModelo: chassis }))
      }
    }
  }

  // Quando seleciona a OS buscada manualmente
  const usarOSBuscada = () => {
    if (!osBuscada) return
    selecionarOS(osBuscada.Id_Ordem)
    setBuscaIdManual('')
  }

  const needsOS = form.setor === 'Trator-Cliente'
  const needsChassisObrigatorio = form.setor === 'Trator-Loja' || TIPOS_HORIMETRO.includes(form.tipo)
  const needsChassis = needsOS || needsChassisObrigatorio
  const needsCliente = form.setor === 'Trator-Cliente'
  const needsVeiculo = TIPOS_VEICULAR.includes(form.tipo)
  const needsHorimetro = TIPOS_HORIMETRO.includes(form.tipo)
  const needsFerramenta = TIPOS_FERRAMENTA.includes(form.tipo)

  // Chassis/modelo obrigatório quando não veio do POS
  const chassisPreenchido = !!form.chassisModelo.trim()

  const canSubmit = () => {
    if (!form.material.trim() || !form.tipo || !form.setor) return false
    if (needsCliente && !form.cliente.trim()) return false
    if (needsOS && !form.osVinculada) return false
    if (needsChassisObrigatorio && !form.chassisModelo.trim()) return false
    if (form.osVinculada && !chassisPOS && !chassisPreenchido) return false
    if (needsVeiculo && (!form.veiculo || !form.kilometragem.trim())) return false
    if (needsHorimetro && !form.horimetro.trim()) return false
    if (needsFerramenta && !form.quemFerramenta) return false
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !canSubmit()) return
    setSaving(true)

    const placaSelecionada = veiculos.find(v => String(v.IdPlaca) === form.veiculo)
    const hoje = new Date().toISOString().split('T')[0]
    const materialUpper = form.material.trim().toUpperCase()
    const idReq = `APP-${Date.now()}`
    const nomePOS = user.nome_pos || user.tecnico_nome

    // 1. Cria na tabela Requisicao (aparece no portal) — enfileira se offline
    const resReq = await offlineWrite({
      table: 'Requisicao',
      action: 'insert',
      data: {
        titulo: materialUpper,
        tipo: form.tipo,
        solicitante: nomePOS,
        setor: form.setor,
        data: hoje,
        status: 'pedido',
        veiculo: placaSelecionada ? String(placaSelecionada.IdPlaca) : null,
        hodometro: form.kilometragem.trim() || form.horimetro.trim() || null,
        cliente: needsCliente ? form.cliente.trim().toUpperCase() : null,
        ordem_servico: form.osVinculada || null,
        Chassis_Modelo: form.chassisModelo.trim().toUpperCase() || null,
        obs: form.motivo.trim() || null,
        quem_ferramenta: needsFerramenta ? form.quemFerramenta : null,
        fornecedor: null,
        valor_despeza: null,
        recibo_fornecedor: null,
        foto_nf: null,
        boleto_fornecedor: null,
      },
    })

    if (!resReq.ok) {
      alert('Erro ao enviar solicitação. Tente novamente.')
      setSaving(false)
      return
    }

    // 2. Notifica portal (bell icon) — so faz sentido online
    if (navigator.onLine) {
      notificarPortalReq(
        'Nova Solicitação de Requisição',
        `${nomePOS} solicitou: ${materialUpper} (${form.tipo})`
      )
    }

    // 3. Insere na Supa-Solicitacao_Req (portal recebe realtime + imprime) — enfileira se offline
    await offlineWrite({
      table: 'Supa-Solicitacao_Req',
      action: 'insert',
      data: {
        IdReq: idReq,
        ReqData: new Date().toISOString(),
        ReqMotivo: form.motivo.trim() || null,
        Material_Serv_Solicitado: materialUpper,
        ReqQuem: form.setor,
        ReqTipo: form.tipo,
        Cliente: needsCliente ? form.cliente.trim().toUpperCase() : null,
        OsVinculada: form.osVinculada || null,
        ModeloChassisTrator: form.chassisModelo.trim().toUpperCase() || null,
        ReqSolicitante: nomePOS,
        ReqVeiculo: placaSelecionada ? placaSelecionada.NumPlaca : null,
        ReqHodometro: form.kilometragem.trim() || form.horimetro.trim() || null,
        ReqEmail: user.tecnico_email,
        StatusPipefy: null,
        NumReq: null,
        ferramenta_quem: needsFerramenta ? form.quemFerramenta : null,
      },
    })

    setSucesso(true)
    clearBackup()
  }

  if (sucesso) {
    return (
      <div style={{
        minHeight: '60vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20,
      }}>
        <div style={{
          width: 90, height: 90, borderRadius: '50%', background: '#D1FAE5',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
        }}>
          <CheckCircle size={48} color="#10B981" />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937', marginBottom: 8 }}>
          Solicitação Enviada!
        </h2>
        <p style={{ fontSize: 15, color: '#6B7280', marginBottom: 28, lineHeight: 1.5 }}>
          O escritório já recebeu seu pedido.
          <br />Você será avisado quando estiver pronto.
        </p>
        <Link href="/requisicoes" style={{
          background: '#C41E2A', color: '#fff', borderRadius: 14,
          padding: '16px 40px', fontSize: 16, fontWeight: 700,
          textDecoration: 'none',
        }}>
          Voltar às Requisições
        </Link>
      </div>
    )
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '16px 18px', borderRadius: 14,
    border: '2px solid #E5E7EB', fontSize: 16, outline: 'none',
    background: '#fff', transition: 'border-color 0.2s',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 15, fontWeight: 700, color: '#1F2937',
    display: 'block', marginBottom: 8,
  }

  return (
    <div>
      <Link href="/requisicoes" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        color: '#C41E2A', fontSize: 15, fontWeight: 600,
        textDecoration: 'none', marginBottom: 16,
        padding: '8px 0',
      }}>
        <ArrowLeft size={20} /> Voltar
      </Link>

      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#C41E2A', marginBottom: 24 }}>
        Nova Solicitação
      </h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* 1. Material / Serviço Solicitado */}
        <div>
          <label style={labelStyle}>O que você precisa? *</label>
          <textarea
            value={form.material}
            onChange={(e) => setForm(prev => ({ ...prev, material: e.target.value }))}
            required
            placeholder="Descreva o material, peça ou serviço..."
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* 2. Motivo */}
        <div>
          <label style={labelStyle}>Motivo</label>
          <textarea
            value={form.motivo}
            onChange={(e) => setForm(prev => ({ ...prev, motivo: e.target.value }))}
            placeholder="Por que precisa? (opcional)"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* 3. Tipo - Grid de botões grandes */}
        <div>
          <label style={labelStyle}>Tipo da solicitação *</label>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}>
            {TIPOS.map((t) => {
              const Icon = t.icon
              const isSelected = form.tipo === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    setForm(prev => ({
                      ...prev, tipo: t.value,
                      quemFerramenta: '', veiculo: '', kilometragem: '', horimetro: '',
                    }))
                    setChassisPOS('')
                    setModeloPOS('')
                    setOsBuscada(null)
                    setBuscaIdManual('')
                    setErroBusca('')
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '14px 12px', borderRadius: 14, cursor: 'pointer',
                    border: `2.5px solid ${isSelected ? t.color : '#E5E7EB'}`,
                    background: isSelected ? `${t.color}10` : '#fff',
                    color: isSelected ? t.color : '#6B7280',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: isSelected ? `${t.color}20` : '#F3F4F6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={20} color={isSelected ? t.color : '#9CA3AF'} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'left', lineHeight: 1.2 }}>
                    {t.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 4. Setor Responsável */}
        <div>
          <label style={labelStyle}>Setor Responsável *</label>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}>
            {SETORES.map((s) => {
              const Icon = s.icon
              const isSelected = form.setor === s.value
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    setForm(prev => ({
                      ...prev, setor: s.value,
                      cliente: '', osVinculada: '', chassisModelo: '',
                    }))
                    setChassisPOS('')
                    setModeloPOS('')
                    setOsBuscada(null)
                    setBuscaIdManual('')
                    setErroBusca('')
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '14px 12px', borderRadius: 14, cursor: 'pointer',
                    border: `2.5px solid ${isSelected ? s.color : '#E5E7EB'}`,
                    background: isSelected ? `${s.color}10` : '#fff',
                    color: isSelected ? s.color : '#6B7280',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: isSelected ? `${s.color}20` : '#F3F4F6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={20} color={isSelected ? s.color : '#9CA3AF'} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'left', lineHeight: 1.2 }}>
                    {s.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* === VINCULAR ORDEM DE SERVIÇO (só para setor Trator-Cliente) === */}
        {form.setor === 'Trator-Cliente' && (
          <div style={{
            background: '#F0FDF4', borderRadius: 16, padding: 18,
            border: '2px solid #BBF7D0', display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>
              Vincular a uma Ordem de Serviço
            </div>

            {/* Minhas OS */}
            <div>
              <label style={{ ...labelStyle, color: '#166534', fontSize: 13 }}>Minhas Ordens de Serviço</label>
              <select
                value={form.osVinculada}
                onChange={(e) => {
                  if (e.target.value) {
                    selecionarOS(e.target.value)
                  } else {
                    setForm(prev2 => ({ ...prev2, osVinculada: '', cliente: '', chassisModelo: '' }))
                    setChassisPOS('')
                  }
                }}
                style={{ ...inputStyle, borderColor: '#BBF7D0' }}
              >
                <option value="">Selecione a OS...</option>
                {ordens.map((os) => (
                  <option key={os.Id_Ordem} value={os.Id_Ordem}>
                    {os.Id_Ordem} - {os.Os_Cliente}
                  </option>
                ))}
              </select>
            </div>

            {/* Buscar OS por ID - só aparece se não tem OS selecionada */}
            {!form.osVinculada && (
              <div>
                <label style={{ ...labelStyle, color: '#166534', fontSize: 13 }}>
                  Ou buscar OS por ID (outra equipe)
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={buscaIdManual}
                    onChange={(e) => { setBuscaIdManual(e.target.value); setErroBusca('') }}
                    placeholder="Digite o ID da OS..."
                    style={{ ...inputStyle, borderColor: '#BBF7D0', flex: 1 }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscarOSPorId() } }}
                  />
                  <button
                    type="button"
                    onClick={buscarOSPorId}
                    disabled={buscandoOS || !buscaIdManual.trim()}
                    style={{
                      background: '#166534', color: '#fff', border: 'none', borderRadius: 14,
                      padding: '0 18px', cursor: buscandoOS ? 'wait' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: !buscaIdManual.trim() ? 0.5 : 1,
                    }}
                  >
                    {buscandoOS ? <div className="spinner" style={{ width: 18, height: 18 }} /> : <Search size={20} />}
                  </button>
                </div>
                {erroBusca && (
                  <div style={{ fontSize: 12, color: '#DC2626', marginTop: 6 }}>{erroBusca}</div>
                )}
                {osBuscada && (
                  <div style={{
                    background: '#fff', borderRadius: 12, padding: 14, marginTop: 8,
                    border: '1.5px solid #BBF7D0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#C41E2A' }}>{osBuscada.Id_Ordem}</div>
                      <div style={{ fontSize: 13, color: '#374151' }}>{osBuscada.Os_Cliente}</div>
                    </div>
                    <button
                      type="button"
                      onClick={usarOSBuscada}
                      style={{
                        background: '#166534', color: '#fff', border: 'none', borderRadius: 10,
                        padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      Selecionar
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* OS selecionada - mostrar info */}
            {form.osVinculada && (
              <div style={{
                background: '#DCFCE7', borderRadius: 10, padding: 12,
                fontSize: 13, color: '#166534', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <CheckCircle size={16} />
                OS vinculada: <strong>{form.osVinculada}</strong>
                {form.cliente && <span> — {form.cliente}</span>}
              </div>
            )}

            {/* Chassis/Modelo - obrigatório se OS vinculada e sem chassis do POS */}
            {form.osVinculada && (
              <div>
                <label style={{ ...labelStyle, color: '#166534', fontSize: 13 }}>
                  Modelo / Chassis {chassisPOS ? '(preenchido do POS)' : '*'}
                </label>
                <input
                  type="text"
                  value={form.chassisModelo}
                  onChange={(e) => setForm(prev => ({ ...prev, chassisModelo: e.target.value }))}
                  placeholder={chassisPOS ? '' : 'Ex: VALTRA BM110 - CHASSIS 123456'}
                  required={!chassisPOS}
                  style={{
                    ...inputStyle, borderColor: '#BBF7D0',
                    background: chassisPOS ? '#F0FDF4' : '#fff',
                  }}
                />
                {!chassisPOS && !chassisPreenchido && (
                  <div style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>
                    Chassis não encontrado no POS. Preencha o modelo ou chassis do equipamento.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* FERRAMENTA: uso pessoal ou geral */}
        {needsFerramenta && (
          <div style={{
            background: '#EFF6FF', borderRadius: 16, padding: 18,
            border: '2px solid #BFDBFE',
          }}>
            <label style={{ ...labelStyle, color: '#1E3A5F' }}>Destinação da Ferramenta *</label>
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                { value: 'Uso Pessoal', label: 'Uso Pessoal' },
                { value: 'Geral', label: 'Uso Geral (Oficina)' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, quemFerramenta: opt.value }))}
                  style={{
                    flex: 1, padding: '16px 8px', borderRadius: 12,
                    border: `2.5px solid ${form.quemFerramenta === opt.value ? '#1E3A5F' : '#BFDBFE'}`,
                    background: form.quemFerramenta === opt.value ? '#1E3A5F' : '#fff',
                    color: form.quemFerramenta === opt.value ? '#fff' : '#374151',
                    fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* TRATOR-CLIENTE: dados extras (cliente já preenchido pela OS) */}
        {form.setor === 'Trator-Cliente' && !form.osVinculada && (
          <div style={{
            background: '#FFF7ED', borderRadius: 16, padding: 18,
            border: '2px solid #FED7AA', display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#D97706', marginBottom: -4 }}>
              Dados do Trator - Cliente
            </div>
            <div>
              <label style={{ ...labelStyle, color: '#92400E' }}>Nome do Cliente *</label>
              <input
                type="text"
                value={form.cliente}
                onChange={(e) => setForm(prev => ({ ...prev, cliente: e.target.value }))}
                required
                placeholder="Digite o nome do cliente..."
                style={{ ...inputStyle, borderColor: '#FED7AA' }}
              />
            </div>
          </div>
        )}

        {/* TRATOR-LOJA: chassis obrigatório (se não vinculou OS) */}
        {form.setor === 'Trator-Loja' && !form.osVinculada && (
          <div style={{
            background: '#EFF6FF', borderRadius: 16, padding: 18,
            border: '2px solid #BFDBFE',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F', marginBottom: 12 }}>
              Dados do Trator - Loja
            </div>
            <label style={{ ...labelStyle, color: '#1E40AF' }}>Modelo / Chassis do Trator *</label>
            <input
              type="text"
              value={form.chassisModelo}
              onChange={(e) => setForm(prev => ({ ...prev, chassisModelo: e.target.value }))}
              required
              placeholder="Ex: VALTRA BM110 - CHASSIS 123456"
              style={{ ...inputStyle, borderColor: '#BFDBFE' }}
            />
          </div>
        )}

        {/* VEICULAR: placa + km */}
        {needsVeiculo && (
          <div style={{
            background: '#FFF1F2', borderRadius: 16, padding: 18,
            border: '2px solid #FECDD3', display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#C41E2A', marginBottom: -4 }}>
              Dados do Veículo
            </div>

            <div>
              <label style={{ ...labelStyle, color: '#9F1239' }}>Veículo / Placa *</label>
              <select
                value={form.veiculo}
                onChange={(e) => setForm(prev => ({ ...prev, veiculo: e.target.value }))}
                required
                style={{ ...inputStyle, borderColor: '#FECDD3' }}
              >
                <option value="">Selecione o veículo...</option>
                {veiculos.map((v) => (
                  <option key={v.IdPlaca} value={v.IdPlaca}>
                    {v.NumPlaca}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ ...labelStyle, color: '#9F1239' }}>Kilometragem Atual *</label>
              <input
                type="text"
                inputMode="numeric"
                value={form.kilometragem}
                onChange={(e) => setForm(prev => ({ ...prev, kilometragem: e.target.value }))}
                required
                placeholder="Ex: 45.200"
                style={{ ...inputStyle, borderColor: '#FECDD3' }}
              />
            </div>
          </div>
        )}

        {/* TRATOR/QUADRI ABASTECIMENTO: chassis + horímetro */}
        {needsHorimetro && (
          <div style={{
            background: '#FFF7ED', borderRadius: 16, padding: 18,
            border: '2px solid #FED7AA', display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#D97706', marginBottom: -4 }}>
              Dados do Equipamento
            </div>

            {!form.osVinculada && (
              <div>
                <label style={{ ...labelStyle, color: '#92400E' }}>Modelo / Chassis *</label>
                <input
                  type="text"
                  value={form.chassisModelo}
                  onChange={(e) => setForm(prev => ({ ...prev, chassisModelo: e.target.value }))}
                  required
                  placeholder="Ex: VALTRA BM110 - CHASSIS 123456"
                  style={{ ...inputStyle, borderColor: '#FED7AA' }}
                />
              </div>
            )}

            <div>
              <label style={{ ...labelStyle, color: '#92400E' }}>Horímetro Atual *</label>
              <input
                type="text"
                inputMode="numeric"
                value={form.horimetro}
                onChange={(e) => setForm(prev => ({ ...prev, horimetro: e.target.value }))}
                required
                placeholder="Ex: 3.500"
                style={{ ...inputStyle, borderColor: '#FED7AA' }}
              />
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={saving || !canSubmit()}
          style={{
            width: '100%', padding: '18px 0', borderRadius: 16,
            background: saving ? '#9CA3AF' : canSubmit() ? '#C41E2A' : '#D1D5DB',
            color: '#fff',
            fontSize: 18, fontWeight: 700, border: 'none',
            cursor: saving || !canSubmit() ? 'default' : 'pointer',
            marginTop: 8, display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 10,
            boxShadow: canSubmit() ? '0 6px 20px rgba(196,30,42,0.3)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          <Send size={20} />
          {saving ? 'Enviando...' : 'Enviar Solicitação'}
        </button>
      </form>

      <div style={{ height: 30 }} />
    </div>
  )
}
