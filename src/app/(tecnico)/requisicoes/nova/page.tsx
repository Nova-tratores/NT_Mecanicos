'use client'
import { hojeBR } from '@/lib/hoje'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import { getCachedVeiculos, getCachedOSList, getCachedOSTec } from '@/lib/prefetch'
import { Send, CheckCircle, Wrench, Utensils, Package, Truck, Car, Fuel, Tractor, Bike, Search, Building2, FilePlus, Link2, User, type LucideIcon } from 'lucide-react'
import type { OrdemServico } from '@/lib/types'
import { notificarPortalReq } from '@/lib/notificarPortal'
import { COR, T, campo, rotulo, cartao, botaoPrincipal, claro, bordaDe, Icone, Cabecalho, Voltar, TelaSucesso, EstiloCampos } from '../_ui'

// Estilo POS NewPortal: as escolhas não têm mais cor própria — selecionada fica no azul do portal.
const TIPOS = [
  { value: 'Peças', label: 'Peças', icon: Wrench },
  { value: 'Alimentação', label: 'Alimentação', icon: Utensils },
  { value: 'Ferramenta', label: 'Ferramenta', icon: Package },
  { value: 'Serviço de Terceiros', label: 'Serv. Terceiros', icon: Truck },
  { value: 'Almoxarifado', label: 'Almoxarifado', icon: Package },
  { value: 'Insumo Infra', label: 'Insumo Infra', icon: Wrench },
  { value: 'Frota-Veiculos', label: 'Frota Veículos', icon: Car },
  { value: 'Veicular Abastecimento', label: 'Veicular Abastecimento', icon: Fuel },
  { value: 'Veicular Manutenção', label: 'Veicular Manutenção', icon: Truck },
  { value: 'Trator Abastecimento', label: 'Trator Abastecimento', icon: Fuel },
  { value: 'Quadri Abastecimento', label: 'Quadri Abastecimento', icon: Bike },
]

const SETORES = [
  { value: 'Oficina', label: 'Oficina', icon: Wrench },
  { value: 'Trator-Cliente', label: 'Trator Cliente', icon: Tractor },
  { value: 'Trator-Loja', label: 'Trator Loja', icon: Tractor },
  { value: 'Comercial', label: 'Comercial', icon: Building2 },
]

/** bloco extra (aparece conforme o tipo/setor): cartão branco com ícone + título */
function Bloco({ icon, titulo, children }: { icon: LucideIcon; titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ ...cartao, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icone icon={icon} cor={COR.principal} tam={36} />
        <div style={{ fontSize: 15, fontWeight: 500, color: T.texto }}>{titulo}</div>
      </div>
      {children}
    </div>
  )
}

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
  // 'enviado' foi agora; 'guardado' ficou no celular (sem sinal) e sobe sozinho depois
  const [sucesso, setSucesso] = useState<null | 'enviado' | 'guardado'>(null)
  // trava contra toque duplo/Enter + marca de enviado (o backup não regrava o pedido depois de enviar)
  const enviandoRef = useRef(false)
  const enviadoRef = useRef(false)
  // sem internet a OS não dá para conferir: segue com o número digitado e o escritório confere depois
  const [osSemConferir, setOsSemConferir] = useState(false)
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
  const getFormData = useCallback(() => (enviadoRef.current ? {} : {
    ...form, buscaIdManual, chassisPOS, modeloPOS, osSemConferir,
  }), [form, buscaIdManual, chassisPOS, modeloPOS, osSemConferir])

  const setFormData = useCallback((data: Record<string, unknown>) => {
    const { buscaIdManual: bid, chassisPOS: cp, modeloPOS: mp, osSemConferir: osc, ...rest } = data
    if (bid) setBuscaIdManual(bid as string)
    if (cp) setChassisPOS(cp as string)
    if (mp) setModeloPOS(mp as string)
    if (osc) setOsSemConferir(true)
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
    const alvo = buscaIdManual.trim()

    // primeiro no que está guardado no celular (funciona sem sinal)
    const cache = (await getCachedOSList().catch(() => null)) as unknown as OSComDetalhes[] | null
    const local = (cache || []).find(o => String(o.Id_Ordem).toUpperCase() === alvo.toUpperCase())
    if (local) { setOsBuscada(local); setBuscandoOS(false); return }

    if (!navigator.onLine) {
      setErroBusca('sem-internet')
      setBuscandoOS(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('Ordem_Servico')
        .select('Id_Ordem, Os_Cliente, Endereco_Cliente, Tipo_Servico, ID_PPV')
        .eq('Id_Ordem', alvo)
        .maybeSingle()
      if (error) throw error
      if (!data) setErroBusca('OS não encontrada. Verifique o número.')
      else setOsBuscada(data as OSComDetalhes)
    } catch (err) {
      const m = String((err as { message?: string })?.message || err).toLowerCase()
      setErroBusca(/fetch|network|load failed|timeout|aborted/.test(m) ? 'sem-internet' : 'Não deu para buscar a OS. Tente de novo.')
    }
    setBuscandoOS(false)
  }

  // Sem internet: aceita o número digitado para o escritório conferir depois
  const usarOSSemConferir = () => {
    const n = buscaIdManual.trim().toUpperCase()
    if (!n) return
    setForm(prev2 => ({ ...prev2, osVinculada: n, cliente: '' }))
    setChassisPOS('')
    setOsSemConferir(true)
    setErroBusca('')
    setBuscaIdManual('')
  }

  // Ao selecionar uma OS, preencher cliente e buscar chassis/modelo
  const selecionarOS = async (idOrdem: string) => {
    const osLocal = ordens.find(o => o.Id_Ordem === idOrdem)
    const osSelecionada = osLocal || osBuscada
    setOsSemConferir(false)

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
    let osTec: Record<string, unknown> | null = null
    try {
      if (navigator.onLine) {
        const { data } = await supabase
          .from('Ordem_Servico_Tecnicos')
          .select('Chassis, FotoChassis')
          .eq('Ordem_Servico', idOrdem)
          .maybeSingle()
        osTec = data
      }
    } catch { /* sem sinal: tenta o guardado */ }
    if (!osTec) osTec = await getCachedOSTec(idOrdem).catch(() => null)

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

  // O que ainda falta (aparece embaixo do botão cinza). O cliente vem da OS — não é mais digitado à parte.
  const faltando = (): string[] => {
    const f: string[] = []
    if (!form.material.trim()) f.push('o que você precisa')
    if (!form.tipo) f.push('o tipo da solicitação')
    if (!form.setor) f.push('o setor responsável')
    if (needsOS && !form.osVinculada) f.push('a ordem de serviço (Trator Cliente)')
    if ((needsChassisObrigatorio || (form.osVinculada && !chassisPOS)) && !chassisPreenchido) f.push('o modelo / chassi')
    if (needsVeiculo && !form.veiculo) f.push('o veículo / placa')
    if (needsVeiculo && !form.kilometragem.trim()) f.push('a quilometragem')
    if (needsHorimetro && !form.horimetro.trim()) f.push('o horímetro')
    if (needsFerramenta && !form.quemFerramenta) f.push('a destinação da ferramenta')
    return f
  }
  const canSubmit = () => faltando().length === 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !canSubmit() || enviandoRef.current || enviadoRef.current) return
    enviandoRef.current = true
    setSaving(true)
    try {
      await enviar()
    } finally {
      enviandoRef.current = false
      setSaving(false)
    }
  }

  const enviar = async () => {
    if (!user) return

    const placaSelecionada = veiculos.find(v => String(v.IdPlaca) === form.veiculo)
    const hoje = hojeBR()
    const materialUpper = form.material.trim().toUpperCase()
    const idReq = `APP-${Date.now()}`
    const nomePOS = user.nome_pos || user.tecnico_nome
    const obsFinal = [
      form.motivo.trim(),
      osSemConferir && form.osVinculada ? `OS ${form.osVinculada} digitada sem internet — conferir.` : '',
    ].filter(Boolean).join(' ') || null

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
        cliente: needsCliente ? (form.cliente.trim().toUpperCase() || null) : null,
        ordem_servico: form.osVinculada || null,
        Chassis_Modelo: form.chassisModelo.trim().toUpperCase() || null,
        obs: obsFinal,
        quem_ferramenta: needsFerramenta ? form.quemFerramenta : null,
        fornecedor: null,
        valor_despeza: null,
        recibo_fornecedor: null,
        foto_nf: null,
        boleto_fornecedor: null,
      },
    })

    if (!resReq.ok) {
      alert(`Erro ao enviar solicitação${resReq.error ? `: ${resReq.error}` : ''}. Seus dados continuam aqui — tente novamente.`)
      return
    }
    // daqui em diante o pedido já está gravado (ou na fila): não deixa reenviar nem o backup regravar
    enviadoRef.current = true

    // 2. Notifica portal (enfileira offline e sobe ao reconectar)
    notificarPortalReq(
      'Nova Solicitação de Requisição',
      `${nomePOS} solicitou: ${materialUpper} (${form.tipo})`
    )

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
        Cliente: needsCliente ? (form.cliente.trim().toUpperCase() || null) : null,
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

    clearBackup()
    setSucesso(resReq.queued ? 'guardado' : 'enviado')
  }

  if (sucesso) {
    return (
      <TelaSucesso
        icon={CheckCircle}
        titulo={sucesso === 'guardado' ? 'Salvo no celular' : 'Solicitação enviada'}
        texto={sucesso === 'guardado'
          ? <>Salvo no celular, vai quando tiver sinal.<br />Não precisa fazer de novo.</>
          : <>O escritório já recebeu seu pedido.<br />Você será avisado quando estiver pronto.</>}
        href="/requisicoes"
        botao="Voltar às requisições"
      />
    )
  }

  const inputStyle: React.CSSProperties = campo

  const labelStyle: React.CSSProperties = rotulo

  /** botão de escolha (tipo / setor): selecionado fica azul do portal */
  const escolha = (sel: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
    padding: '10px 10px', borderRadius: 14, cursor: 'pointer',
    border: `1px solid ${sel ? COR.principal : T.borda}`,
    background: sel ? claro(COR.principal) : T.cartao,
    color: T.texto, textAlign: 'left', fontFamily: 'inherit',
    transition: 'border-color .15s, background .15s',
  })
  const escolhaIcone = (sel: boolean): React.CSSProperties => ({
    width: 36, height: 36, borderRadius: 11, flex: 'none',
    display: 'grid', placeItems: 'center',
    background: sel ? COR.principal : '#F1F5F9',
    color: sel ? '#fff' : T.textoFraco,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <EstiloCampos />
      <Voltar href="/requisicoes" />

      <Cabecalho icon={FilePlus} titulo="Nova solicitação" subtitulo="Peça, ferramenta, abastecimento ou serviço" />

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        <div style={{ ...cartao, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 1. Material / Serviço Solicitado */}
          <div>
            <label style={labelStyle}>O que você precisa? *</label>
            <textarea
              className="rq-campo"
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
              className="rq-campo"
              value={form.motivo}
              onChange={(e) => setForm(prev => ({ ...prev, motivo: e.target.value }))}
              placeholder="Por que precisa? (opcional)"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>
        </div>

        {/* 3. Tipo - Grid de botões grandes */}
        <div style={cartao}>
          <label style={labelStyle}>Tipo da solicitação *</label>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 8,
          }}>
            {TIPOS.map((t) => {
              const Icon = t.icon
              const isSelected = form.tipo === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  className="rq-toque"
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
                  style={escolha(isSelected)}
                >
                  <span style={escolhaIcone(isSelected)}>
                    <Icon size={18} />
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: isSelected ? 500 : 400, lineHeight: 1.2, minWidth: 0, overflowWrap: 'anywhere' }}>
                    {t.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 4. Setor Responsável */}
        <div style={cartao}>
          <label style={labelStyle}>Setor responsável *</label>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 8,
          }}>
            {SETORES.map((s) => {
              const Icon = s.icon
              const isSelected = form.setor === s.value
              return (
                <button
                  key={s.value}
                  type="button"
                  className="rq-toque"
                  onClick={() => {
                    setForm(prev => ({
                      ...prev, setor: s.value,
                      cliente: '', osVinculada: '', chassisModelo: '',
                    }))
                    setOsSemConferir(false)
                    setChassisPOS('')
                    setModeloPOS('')
                    setOsBuscada(null)
                    setBuscaIdManual('')
                    setErroBusca('')
                  }}
                  style={escolha(isSelected)}
                >
                  <span style={escolhaIcone(isSelected)}>
                    <Icon size={18} />
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: isSelected ? 500 : 400, lineHeight: 1.2, minWidth: 0, overflowWrap: 'anywhere' }}>
                    {s.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* === VINCULAR ORDEM DE SERVIÇO (só para setor Trator-Cliente) === */}
        {form.setor === 'Trator-Cliente' && (
          <Bloco icon={Link2} titulo="Vincular a uma ordem de serviço">

            {/* Minhas OS */}
            <div>
              <label style={labelStyle}>Minhas ordens de serviço</label>
              <select
                className="rq-campo"
                value={form.osVinculada}
                onChange={(e) => {
                  if (e.target.value) {
                    selecionarOS(e.target.value)
                  } else {
                    setForm(prev2 => ({ ...prev2, osVinculada: '', cliente: '', chassisModelo: '' }))
                    setChassisPOS('')
                  }
                }}
                style={inputStyle}
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
                <label style={labelStyle}>
                  Ou buscar OS pelo número (outra equipe)
                </label>
                <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
                  <input
                    className="rq-campo"
                    type="text"
                    value={buscaIdManual}
                    onChange={(e) => { setBuscaIdManual(e.target.value); setErroBusca('') }}
                    placeholder="Digite o número da OS..."
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscarOSPorId() } }}
                  />
                  <button
                    type="button"
                    onClick={buscarOSPorId}
                    disabled={buscandoOS || !buscaIdManual.trim()}
                    aria-label="Buscar OS"
                    style={{
                      background: !buscaIdManual.trim() ? T.fantasma : COR.principal, color: '#fff', border: 'none', borderRadius: 12,
                      width: 46, minHeight: 46, flex: 'none', cursor: buscandoOS ? 'wait' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {buscandoOS ? <div className="spinner" style={{ width: 18, height: 18 }} /> : <Search size={19} />}
                  </button>
                </div>
                {erroBusca === 'sem-internet' ? (
                  <div style={{
                    marginTop: 8, borderRadius: 12, padding: 12, display: 'grid', gap: 8,
                    background: claro(COR.pendente), border: `1px solid ${bordaDe(COR.pendente)}`,
                  }}>
                    <div style={{ fontSize: 13.5, color: T.texto, lineHeight: 1.45 }}>
                      Sem internet — não dá para conferir a OS agora. Pode seguir com o número digitado; o escritório confere depois.
                    </div>
                    <button
                      type="button"
                      onClick={usarOSSemConferir}
                      style={{ ...botaoPrincipal(), minHeight: 40, fontSize: 14 }}
                    >
                      Usar a OS {buscaIdManual.trim().toUpperCase()}
                    </button>
                  </div>
                ) : erroBusca ? (
                  <div style={{ fontSize: 13, color: COR.erro, marginTop: 6 }}>{erroBusca}</div>
                ) : null}
                {osBuscada && (
                  <div style={{
                    background: T.cartao, borderRadius: 12, padding: 12, marginTop: 8,
                    border: `1px solid ${T.borda}`, minWidth: 0,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: COR.principal }}>{osBuscada.Id_Ordem}</div>
                      <div style={{ fontSize: 13, color: T.textoMedio, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{osBuscada.Os_Cliente}</div>
                    </div>
                    <button
                      type="button"
                      onClick={usarOSBuscada}
                      style={{ ...botaoPrincipal(), width: 'auto', minHeight: 38, fontSize: 14, flex: 'none' }}
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
                background: claro(COR.feita), border: `1px solid ${bordaDe(COR.feita)}`,
                borderRadius: 12, padding: '10px 12px',
                fontSize: 14, color: T.texto, minWidth: 0,
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              }}>
                <CheckCircle size={16} color={COR.feita} style={{ flex: 'none' }} />
                OS vinculada: <span style={{ fontWeight: 500 }}>{form.osVinculada}</span>
                {form.cliente && <span style={{ color: T.textoMedio }}>— {form.cliente}</span>}
                {osSemConferir && <span style={{ color: COR.pendente, fontSize: 13 }}>(sem conferir — o escritório confere)</span>}
                <button
                  type="button"
                  onClick={() => {
                    setForm(prev2 => ({ ...prev2, osVinculada: '', cliente: '', chassisModelo: '' }))
                    setChassisPOS('')
                    setOsSemConferir(false)
                  }}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: COR.principal, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0' }}
                >
                  Trocar
                </button>
              </div>
            )}

            {/* Chassis/Modelo - obrigatório se OS vinculada e sem chassis do POS */}
            {form.osVinculada && (
              <div>
                <label style={labelStyle}>
                  Modelo / chassi {chassisPOS ? '(preenchido do POS)' : '*'}
                </label>
                <input
                  className="rq-campo"
                  type="text"
                  value={form.chassisModelo}
                  onChange={(e) => setForm(prev => ({ ...prev, chassisModelo: e.target.value }))}
                  placeholder={chassisPOS ? '' : 'Ex: VALTRA BM110 - CHASSIS 123456'}
                  required={!chassisPOS}
                  style={{
                    ...inputStyle,
                    background: chassisPOS ? T.fundo : T.cartao,
                  }}
                />
                {!chassisPOS && !chassisPreenchido && (
                  <div style={{ fontSize: 13, color: COR.erro, marginTop: 6 }}>
                    Chassi não encontrado no POS. Preencha o modelo ou chassi do equipamento.
                  </div>
                )}
              </div>
            )}
          </Bloco>
        )}

        {/* FERRAMENTA: uso pessoal ou geral */}
        {needsFerramenta && (
          <Bloco icon={Package} titulo="Destinação da ferramenta *">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {[
                { value: 'Uso Pessoal', label: 'Uso pessoal' },
                { value: 'Geral', label: 'Uso geral (oficina)' },
              ].map((opt) => {
                const sel = form.quemFerramenta === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className="rq-toque"
                    onClick={() => setForm(prev => ({ ...prev, quemFerramenta: opt.value }))}
                    style={{
                      minHeight: 46, padding: '10px 8px', borderRadius: 12,
                      border: `1px solid ${sel ? COR.principal : T.borda}`,
                      background: sel ? COR.principal : T.cartao,
                      color: sel ? '#fff' : T.texto,
                      fontSize: 14, fontWeight: sel ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </Bloco>
        )}

        {/* Trator Cliente: o cliente vem da OS. O "Nome do cliente" solto saiu (nunca valia sem OS) — José, 23/10/2026.
            Só com OS digitada sem internet dá para informar o cliente, opcional. */}
        {form.setor === 'Trator-Cliente' && form.osVinculada && osSemConferir && (
          <Bloco icon={User} titulo="Cliente (opcional)">
            <input
              className="rq-campo"
              type="text"
              value={form.cliente}
              onChange={(e) => setForm(prev => ({ ...prev, cliente: e.target.value }))}
              placeholder="Nome do cliente, se souber"
              style={inputStyle}
            />
          </Bloco>
        )}

        {/* TRATOR-LOJA: chassis obrigatório (se não vinculou OS) */}
        {form.setor === 'Trator-Loja' && !form.osVinculada && (
          <Bloco icon={Tractor} titulo="Dados do trator — loja">
            <div>
              <label style={labelStyle}>Modelo / chassi do trator *</label>
              <input
                className="rq-campo"
                type="text"
                value={form.chassisModelo}
                onChange={(e) => setForm(prev => ({ ...prev, chassisModelo: e.target.value }))}
                required
                placeholder="Ex: VALTRA BM110 - CHASSIS 123456"
                style={inputStyle}
              />
            </div>
          </Bloco>
        )}

        {/* VEICULAR: placa + km */}
        {needsVeiculo && (
          <Bloco icon={Car} titulo="Dados do veículo">
            <div>
              <label style={labelStyle}>Veículo / placa *</label>
              <select
                className="rq-campo"
                value={form.veiculo}
                onChange={(e) => setForm(prev => ({ ...prev, veiculo: e.target.value }))}
                required
                style={inputStyle}
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
              <label style={labelStyle}>Quilometragem atual *</label>
              <input
                className="rq-campo"
                type="text"
                inputMode="numeric"
                value={form.kilometragem}
                onChange={(e) => setForm(prev => ({ ...prev, kilometragem: e.target.value }))}
                required
                placeholder="Ex: 45.200"
                style={inputStyle}
              />
            </div>
          </Bloco>
        )}

        {/* TRATOR/QUADRI ABASTECIMENTO: chassis + horímetro */}
        {needsHorimetro && (
          <Bloco icon={Fuel} titulo="Dados do equipamento">
            {!form.osVinculada && (
              <div>
                <label style={labelStyle}>Modelo / chassi *</label>
                <input
                  className="rq-campo"
                  type="text"
                  value={form.chassisModelo}
                  onChange={(e) => setForm(prev => ({ ...prev, chassisModelo: e.target.value }))}
                  required
                  placeholder="Ex: VALTRA BM110 - CHASSIS 123456"
                  style={inputStyle}
                />
              </div>
            )}

            <div>
              <label style={labelStyle}>Horímetro atual *</label>
              <input
                className="rq-campo"
                type="text"
                inputMode="numeric"
                value={form.horimetro}
                onChange={(e) => setForm(prev => ({ ...prev, horimetro: e.target.value }))}
                required
                placeholder="Ex: 3.500"
                style={inputStyle}
              />
            </div>
          </Bloco>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={saving || !canSubmit()}
          style={{ ...botaoPrincipal(saving || !canSubmit()), minHeight: 50, fontSize: 16, marginTop: 4 }}
        >
          <Send size={18} />
          {saving ? 'Enviando...' : 'Enviar solicitação'}
        </button>
        {!saving && faltando().length > 0 && (
          <div style={{ fontSize: 13, color: T.textoMedio, lineHeight: 1.5, marginTop: -4 }}>
            Para enviar, falta: {faltando().join(', ')}.
          </div>
        )}
      </form>

      <div style={{ height: 30 }} />
    </div>
  )
}
