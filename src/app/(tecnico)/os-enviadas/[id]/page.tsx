'use client'
import { useEffect, useState } from 'react'
import { use } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import { getCachedOS, getCachedOSTec, getCachedCliente } from '@/lib/prefetch'
import { gerarPdfRelatorio } from '@/lib/gerarPdfRelatorio'
import { ArrowLeft, FileDown, Eye, Loader2, FileEdit, Send, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

interface PecaInfo {
  descricao: string
  codigo: string
  qtdUsada: string
  devolvida: boolean
  qtdDevolvida: string
  origem: 'ppv' | 'manual'
  qtdOriginal: string
  naoUsada: boolean
  revisado: boolean
}

export default function OsEnviadaDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useCurrentUser()
  const [loading, setLoading] = useState(true)
  const [gerandoPdf, setGerandoPdf] = useState(false)
  const [registro, setRegistro] = useState<Record<string, unknown> | null>(null)
  const [osInfo, setOsInfo] = useState<Record<string, unknown> | null>(null)
  const [cidade, setCidade] = useState('')
  const [pecas, setPecas] = useState<PecaInfo[]>([])
  const [cartaCorrecao, setCartaCorrecao] = useState('')
  const [cartaSalva, setCartaSalva] = useState('')
  const [mostrarCarta, setMostrarCarta] = useState(false)
  const [salvandoCarta, setSalvandoCarta] = useState(false)

  useEffect(() => {
    if (!user) return
    const aplicar = (
      reg: Record<string, unknown> | null,
      osData: Record<string, unknown> | null,
      cidadeCli?: string,
    ) => {
      if (reg) {
        setRegistro(reg)
        if (reg.CartaCorrecao) {
          setCartaCorrecao(reg.CartaCorrecao as string)
          setCartaSalva(reg.CartaCorrecao as string)
        }
        if (reg.PecasInfo) {
          try { setPecas(JSON.parse(reg.PecasInfo as string)) } catch { /* */ }
        }
      }
      if (osData) setOsInfo(osData)
      if (cidadeCli) setCidade(cidadeCli)
      setLoading(false)
    }

    const carregarDoCache = async () => {
      const reg = await getCachedOSTec(id)
      const osData = await getCachedOS(id)
      let cidadeCli = ''
      if (osData?.Cnpj_Cliente) {
        const cli = await getCachedCliente(osData.Cnpj_Cliente as string)
        cidadeCli = cli?.cidade || ''
      }
      aplicar(reg, osData, cidadeCli)
    }

    const carregar = async () => {
      if (!navigator.onLine) { await carregarDoCache(); return }
      try {
        // Buscar o registro técnico pela Ordem_Servico
        const { data: reg } = await supabase
          .from('Ordem_Servico_Tecnicos')
          .select('*')
          .eq('Ordem_Servico', id)
          .maybeSingle()

        if (!reg) { await carregarDoCache(); return }

        // Buscar dados da OS original
        const { data: osData } = await supabase
          .from('Ordem_Servico')
          .select('*')
          .eq('Id_Ordem', id)
          .maybeSingle()

        let cidadeCli = ''
        if (osData?.Cnpj_Cliente) {
          const { data: cli } = await supabase
            .from('Clientes')
            .select('cidade')
            .eq('cnpj_cpf', osData.Cnpj_Cliente)
            .maybeSingle()
          cidadeCli = cli?.cidade || ''
        }
        aplicar(reg, osData, cidadeCli)
      } catch {
        await carregarDoCache()
      }
    }
    carregar()
  }, [id, user])

  const salvarCartaCorrecao = async () => {
    if (!cartaCorrecao.trim()) {
      alert('Escreva a carta de correção antes de enviar.')
      return
    }
    setSalvandoCarta(true)
    await offlineWrite({
      table: 'Ordem_Servico_Tecnicos',
      action: 'update',
      data: { CartaCorrecao: cartaCorrecao.trim() },
      match: { Ordem_Servico: id },
    })
    setCartaSalva(cartaCorrecao.trim())
    setSalvandoCarta(false)
  }

  const handleGerarPdf = async () => {
    if (!registro) return
    setGerandoPdf(true)

    const dias = []
    if (registro.DataInicio) {
      dias.push({
        data: (registro.DataInicio as string) || '',
        horaInicio: (registro.InicioHora as string) || '',
        horaFim: (registro.FinalHora as string) || '',
        kmTotal: (registro.InicioKm as string) || (registro.TotalKm as string) || '',
      })
    }
    if (registro.AdicionarData2 && registro.DataInicio2) {
      dias.push({
        data: (registro.DataInicio2 as string) || '',
        horaInicio: (registro.InicioHora2 as string) || '',
        horaFim: (registro.FinalHora2 as string) || '',
        kmTotal: (registro.InicioKm2 as string) || '',
      })
    }
    if (registro.AdicionarData3 && registro.DataInicio3) {
      dias.push({
        data: (registro.DataInicio3 as string) || '',
        horaInicio: (registro.InicioHora3 as string) || '',
        horaFim: (registro.FinaHora3 as string) || '',
        kmTotal: (registro.InicioKm3 as string) || '',
      })
    }
    if (dias.length === 0) {
      dias.push({ data: '', horaInicio: '', horaFim: '', kmTotal: '' })
    }

    const downloadFoto = async (url: string): Promise<string | null> => {
      if (!url) return null
      const match = url.match(/\/object\/public\/requisicoes\/(.+?)(\?|$)/)
      if (!match) return null
      const path = decodeURIComponent(match[1])
      const { data: blob, error } = await supabase.storage.from('requisicoes').download(path)
      if (error || !blob) return null
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    }

    try {
      await gerarPdfRelatorio({
        ordemServico: id,
        cliente: (osInfo?.Os_Cliente as string) || '',
        endereco: (osInfo?.Endereco_Cliente as string) || '',
        cidade,
        tipoServico: (registro.TipoServico as string) || '',
        projeto: (registro.Projeto as string) || '',
        idPPV: (osInfo?.ID_PPV as string) || '',
        status: 'Enviado',
        tecResp1: (registro.TecResp1 as string) || '',
        temTec2: (registro.TemTec as boolean) || false,
        tecResp2: (registro.TecResp2 as string) || '',
        chassis: (registro.Chassis as string) || '',
        marca: (registro.Marca as string) || '',
        modelo: (registro.Modelo as string) || '',
        horimetro: (registro.Horimetro as string) || '',
        garantia: (registro.Garantia as boolean) || false,
        numPlaca: (registro.NumPlaca as string) || '',
        tratorLocal1: (registro.TratorLocal1 as string) || '',
        tratorLocal2: (registro.TratorLocal2 as string) || '',
        diagnostico: (registro.Motivo as string) || '',
        servicoRealizado: (registro.ServicoRealizado as string) || '',
        tipoRev: (registro.TipoRev as string) || '',
        dias,
        totalHora: (registro.TotalHora as string) || '',
        totalKm: (registro.TotalKm as string) || '',
        pecas,
        fotoHorimetro: (registro.FotoHorimetro as string) || '',
        fotoChassis: (registro.FotoChassis as string) || '',
        fotoFrente: (registro.FotoFrente as string) || '',
        fotoDireita: (registro.FotoDireita as string) || '',
        fotoEsquerda: (registro.FotoEsquerda as string) || '',
        fotoTraseira: (registro.FotoTraseira as string) || '',
        fotoVolante: (registro.FotoVolante as string) || '',
        fotoFalha1: (registro.FotoFalha1 as string) || '',
        fotoFalha2: (registro.FotoFalha2 as string) || '',
        fotoFalha3: (registro.FotoFalha3 as string) || '',
        fotoFalha4: (registro.FotoFalha4 as string) || '',
        fotoPecaNova1: (registro.FotoPecaNova1 as string) || '',
        fotoPecaNova2: (registro.FotoPecaNova2 as string) || '',
        fotoPecaInstalada1: (registro.FotoPecaInstalada1 as string) || '',
        fotoPecaInstalada2: (registro.FotoPecaInstalada2 as string) || '',
        assCliente: (registro.AssCliente as string) || '',
        assTecnico: (registro.AssTecnico as string) || '',
        nomResp: (registro.NomResp as string) || '',
        fazenda: (registro.Fazenda as string) || '',
        cidadeServico: (registro.Cidade as string) || '',
        data: (registro.Data as string) || '',
        downloadFoto,
      })
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      alert('Erro ao gerar PDF. Tente novamente.')
    }
    setGerandoPdf(false)
  }

  const formatarDataBR = (d: string) => {
    if (!d) return '-'
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    )
  }

  if (!registro) {
    return (
      <div style={{ padding: 20 }}>
        <Link href="/os-enviadas" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#C41E2A', fontSize: 15, fontWeight: 600, textDecoration: 'none', marginBottom: 20 }}>
          <ArrowLeft size={20} /> Voltar
        </Link>
        <div style={{ background: '#fff', borderRadius: 18, padding: 48, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#6B7280' }}>Relatório não encontrado</div>
        </div>
      </div>
    )
  }

  const sectionStyle: React.CSSProperties = {
    background: '#fff', borderRadius: 16, padding: 18,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 14,
  }
  const fieldLabel: React.CSSProperties = { fontSize: 11, color: '#6B7280', marginBottom: 2 }
  const fieldValue: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#1F2937', marginBottom: 10 }

  const dias = []
  if (registro.DataInicio) dias.push({ data: registro.DataInicio as string, hi: registro.InicioHora as string, hf: registro.FinalHora as string, kmTotal: (registro.InicioKm as string) || '' })
  if (registro.AdicionarData2 && registro.DataInicio2) dias.push({ data: registro.DataInicio2 as string, hi: registro.InicioHora2 as string, hf: registro.FinalHora2 as string, kmTotal: (registro.InicioKm2 as string) || '' })
  if (registro.AdicionarData3 && registro.DataInicio3) dias.push({ data: registro.DataInicio3 as string, hi: registro.InicioHora3 as string, hf: registro.FinaHora3 as string, kmTotal: (registro.InicioKm3 as string) || '' })

  const fotos = [
    { label: 'Horímetro', url: registro.FotoHorimetro as string },
    { label: 'Chassis', url: registro.FotoChassis as string },
    { label: 'Frente', url: registro.FotoFrente as string },
    { label: 'Direita', url: registro.FotoDireita as string },
    { label: 'Esquerda', url: registro.FotoEsquerda as string },
    { label: 'Traseira', url: registro.FotoTraseira as string },
    { label: 'Volante', url: registro.FotoVolante as string },
    { label: 'Falha 1', url: registro.FotoFalha1 as string },
    { label: 'Falha 2', url: registro.FotoFalha2 as string },
    { label: 'Falha 3', url: registro.FotoFalha3 as string },
    { label: 'Falha 4', url: registro.FotoFalha4 as string },
    { label: 'Peça Nova 1', url: registro.FotoPecaNova1 as string },
    { label: 'Peça Nova 2', url: registro.FotoPecaNova2 as string },
    { label: 'Peça Instalada 1', url: registro.FotoPecaInstalada1 as string },
    { label: 'Peça Instalada 2', url: registro.FotoPecaInstalada2 as string },
    { label: 'Nota Alimentação', url: registro.FotoAlmoco as string },
  ].filter(f => f.url)

  return (
    <div>
      <Link href="/os-enviadas" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        color: '#C41E2A', fontSize: 15, fontWeight: 600,
        textDecoration: 'none', marginBottom: 16, padding: '8px 0',
      }}>
        <ArrowLeft size={20} /> Voltar
      </Link>

      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#C41E2A', marginBottom: 4 }}>
        Relatório OS — {id}
      </h1>
      <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
        {(osInfo?.Os_Cliente as string) || ''} {cidade ? `• ${cidade}` : ''}
      </p>

      {/* Botões: Editar + Gerar PDF */}
      {(() => {
        const dataEnvio = (registro.Data as string) || ''
        const envio = dataEnvio ? new Date(dataEnvio + 'T00:00:00') : null
        const dentroPrazo = envio ? (Date.now() - envio.getTime()) < 48 * 60 * 60 * 1000 : false
        return (
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            {dentroPrazo ? (
              <Link href={`/os/${id}/preencher`} style={{
                flex: 1, padding: '16px 0', borderRadius: 14,
                background: '#D97706', color: '#fff', border: 'none',
                fontSize: 16, fontWeight: 700, textDecoration: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}>
                <FileEdit size={20} /> Editar OS
              </Link>
            ) : (
              <div style={{
                flex: 1, padding: '16px 0', borderRadius: 14,
                background: '#E5E7EB', color: '#9CA3AF',
                fontSize: 14, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}>
                <FileEdit size={20} /> Prazo expirado
              </div>
            )}
            <button onClick={handleGerarPdf} disabled={gerandoPdf} style={{
              flex: 1, padding: '16px 0', borderRadius: 14,
              background: '#1E3A5F', color: '#fff', border: 'none',
              fontSize: 16, fontWeight: 700, cursor: gerandoPdf ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}>
              {gerandoPdf ? <Loader2 size={20} className="spinner" /> : <FileDown size={20} />}
              {gerandoPdf ? 'Gerando...' : 'Baixar PDF'}
            </button>
          </div>
        )
      })()}

      {/* Preview dos dados */}
      {/* Dados da Ordem */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F', marginBottom: 12 }}>Dados da Ordem</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div><div style={fieldLabel}>OS</div><div style={fieldValue}>{id}</div></div>
          <div><div style={fieldLabel}>Preenchido em</div><div style={fieldValue}>{formatarDataBR((registro.Data as string) || '')}</div></div>
          <div><div style={fieldLabel}>Tipo Serviço</div><div style={fieldValue}>{(registro.TipoServico as string) || '-'}</div></div>
          <div><div style={fieldLabel}>Projeto</div><div style={fieldValue}>{(registro.Projeto as string) || '-'}</div></div>
        </div>
        {(osInfo?.ID_PPV as string) && (
          <div><div style={fieldLabel}>PPV</div><div style={fieldValue}>{osInfo?.ID_PPV as string}</div></div>
        )}
      </div>

      {/* Técnicos */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F', marginBottom: 12 }}>Técnicos</div>
        <div><div style={fieldLabel}>Responsável</div><div style={fieldValue}>{(registro.TecResp1 as string) || '-'}</div></div>
        {Boolean(registro.TemTec) && (
          <div><div style={fieldLabel}>Técnico 2</div><div style={fieldValue}>{(registro.TecResp2 as string) || '-'}</div></div>
        )}
        <div><div style={fieldLabel}>Placa</div><div style={fieldValue}>{(registro.NumPlaca as string) || '-'}</div></div>
      </div>

      {/* Equipamento */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F', marginBottom: 12 }}>Equipamento</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div><div style={fieldLabel}>Chassis</div><div style={fieldValue}>{(registro.Chassis as string) || '-'}</div></div>
          <div><div style={fieldLabel}>Horímetro</div><div style={fieldValue}>{(registro.Horimetro as string) || '-'}</div></div>
          <div><div style={fieldLabel}>Garantia</div><div style={{ ...fieldValue, color: registro.Garantia ? '#059669' : '#6B7280' }}>{registro.Garantia ? 'SIM' : 'NÃO'}</div></div>
        </div>
        {((registro.Fazenda as string) || (registro.Cidade as string)) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px', marginTop: 4 }}>
            <div><div style={fieldLabel}>Fazenda</div><div style={fieldValue}>{(registro.Fazenda as string) || '-'}</div></div>
            <div><div style={fieldLabel}>Cidade</div><div style={fieldValue}>{(registro.Cidade as string) || '-'}</div></div>
          </div>
        )}
        {((registro.TratorLocal1 as string) || (registro.TratorLocal2 as string)) && (
          <div><div style={fieldLabel}>Local/Modelo</div><div style={fieldValue}>{[registro.TratorLocal1, registro.TratorLocal2].filter(Boolean).join(' / ')}</div></div>
        )}
      </div>

      {/* Diagnóstico */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F', marginBottom: 12 }}>Diagnóstico e Serviço</div>
        <div><div style={fieldLabel}>Diagnóstico / Motivo</div><div style={{ ...fieldValue, whiteSpace: 'pre-wrap' }}>{(registro.Motivo as string) || '-'}</div></div>
        <div><div style={fieldLabel}>Serviço Realizado</div><div style={{ ...fieldValue, whiteSpace: 'pre-wrap' }}>{(registro.ServicoRealizado as string) || '-'}</div></div>
        {(registro.TipoRev as string) && (
          <div><div style={fieldLabel}>Tipo Revisão</div><div style={fieldValue}>{registro.TipoRev as string}</div></div>
        )}
      </div>

      {/* Dias */}
      {dias.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F', marginBottom: 12 }}>Dias de Serviço</div>
          {dias.map((d, i) => (
            <div key={i} style={{
              background: '#F9FAFB', borderRadius: 10, padding: 12, marginBottom: 8,
              border: '1px solid #E5E7EB',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>
                Dia {i + 1} — {formatarDataBR(d.data)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 13 }}>
                <div><span style={{ color: '#9CA3AF' }}>Hora início: </span><strong>{d.hi || '-'}</strong></div>
                <div><span style={{ color: '#9CA3AF' }}>Hora fim: </span><strong>{d.hf || '-'}</strong></div>
                <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#9CA3AF' }}>Total KM: </span><strong>{d.kmTotal || '-'}</strong></div>
              </div>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
            <div style={{ background: '#DBEAFE', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#6B7280' }}>Total Horas</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>{(registro.TotalHora as string) || '-'}</div>
            </div>
            <div style={{ background: '#DBEAFE', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#6B7280' }}>Total KM</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>{(registro.TotalKm as string) || '-'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Peças */}
      {pecas.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F', marginBottom: 12 }}>Peças</div>
          {pecas.filter(p => !p.naoUsada).map((p, i) => (
            <div key={i} style={{
              background: '#F9FAFB', borderRadius: 10, padding: 12, marginBottom: 6,
              border: '1px solid #E5E7EB', fontSize: 13,
            }}>
              <div style={{ fontWeight: 700, color: '#1F2937', marginBottom: 4 }}>{p.descricao}</div>
              <div style={{ display: 'flex', gap: 16, color: '#6B7280' }}>
                {p.codigo && <span>Cód: {p.codigo}</span>}
                <span>Qtd: {p.qtdUsada}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: p.origem === 'ppv' ? '#DBEAFE' : '#F3F4F6', color: p.origem === 'ppv' ? '#2563EB' : '#6B7280' }}>
                  {p.origem === 'ppv' ? 'PPV' : 'Manual'}
                </span>
              </div>
              {p.devolvida && <div style={{ color: '#D97706', marginTop: 4 }}>Devolvida: {p.qtdDevolvida}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Fotos */}
      {fotos.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F', marginBottom: 12 }}>Fotos</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {fotos.map((f, i) => (
              <div key={i}>
                <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 4 }}>{f.label}</div>
                <img src={f.url} alt={f.label} style={{
                  width: '100%', borderRadius: 8, objectFit: 'cover',
                  aspectRatio: '4/3', background: '#F3F4F6',
                }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Justificativa de Atraso */}
      {(registro.JustificativaAtraso as string) && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#DC2626', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Justificativa de Atraso
          </div>
          <div style={{
            background: '#FEF2F2', borderRadius: 10, padding: 14,
            border: '1px solid #FECACA', fontSize: 14, color: '#991B1B',
            lineHeight: 1.6, whiteSpace: 'pre-wrap',
          }}>
            {registro.JustificativaAtraso as string}
          </div>
        </div>
      )}

      {/* Assinaturas */}
      {((registro.AssCliente as string) || (registro.AssTecnico as string)) && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F', marginBottom: 12 }}>Assinaturas</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={fieldLabel}>Cliente</div>
              {(registro.AssCliente as string) ? (
                <img src={registro.AssCliente as string} alt="Assinatura cliente" style={{ width: '100%', borderRadius: 8, border: '1px solid #E5E7EB' }} />
              ) : <div style={{ color: '#D1D5DB', fontSize: 13 }}>Sem assinatura</div>}
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1F2937', marginTop: 4, textAlign: 'center' }}>{(registro.NomResp as string) || '-'}</div>
            </div>
            <div>
              <div style={fieldLabel}>Técnico</div>
              {(registro.AssTecnico as string) ? (
                <img src={registro.AssTecnico as string} alt="Assinatura técnico" style={{ width: '100%', borderRadius: 8, border: '1px solid #E5E7EB' }} />
              ) : <div style={{ color: '#D1D5DB', fontSize: 13 }}>Sem assinatura</div>}
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1F2937', marginTop: 4, textAlign: 'center' }}>{(registro.TecResp1 as string) || '-'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Carta de Correção */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileEdit size={18} color="#D97706" />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#D97706' }}>Carta de Correção</span>
          </div>
          {cartaSalva && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
              background: '#D1FAE5', color: '#059669',
            }}>Enviada</span>
          )}
        </div>

        {cartaSalva && !mostrarCarta ? (
          <div>
            <div style={{
              background: '#FFFBEB', borderRadius: 10, padding: 14,
              border: '1px solid #FDE68A', fontSize: 14, color: '#92400E',
              lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 10,
            }}>
              {cartaSalva}
            </div>
            <button type="button" onClick={() => setMostrarCarta(true)} style={{
              fontSize: 13, color: '#D97706', background: 'none', border: 'none',
              cursor: 'pointer', fontWeight: 600, padding: 0,
            }}>
              Editar carta
            </button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
              Se precisar corrigir alguma informação do relatório, descreva aqui. A carta ficará anexada junto ao relatório no portal.
            </p>
            <textarea
              value={cartaCorrecao}
              onChange={(e) => setCartaCorrecao(e.target.value)}
              placeholder="Descreva a correção necessária..."
              rows={4}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 12,
                border: '2px solid #FDE68A', fontSize: 14, outline: 'none',
                background: '#FFFBEB', boxSizing: 'border-box', resize: 'vertical',
                lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {cartaSalva && (
                <button type="button" onClick={() => { setMostrarCarta(false); setCartaCorrecao(cartaSalva) }} style={{
                  flex: 1, padding: '12px 0', borderRadius: 10,
                  background: '#F3F4F6', color: '#6B7280', border: 'none',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>
                  Cancelar
                </button>
              )}
              <button type="button" onClick={salvarCartaCorrecao} disabled={salvandoCarta || !cartaCorrecao.trim()} style={{
                flex: 1, padding: '12px 0', borderRadius: 10,
                background: !cartaCorrecao.trim() ? '#E5E7EB' : '#D97706', color: '#fff', border: 'none',
                fontSize: 14, fontWeight: 700, cursor: salvandoCarta ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: salvandoCarta ? 0.7 : 1,
              }}>
                <Send size={16} />
                {salvandoCarta ? 'Enviando...' : 'Enviar Carta'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Botão PDF fixo no final */}
      <button onClick={handleGerarPdf} disabled={gerandoPdf} style={{
        width: '100%', padding: '16px 0', borderRadius: 14,
        background: '#C41E2A', color: '#fff', border: 'none',
        fontSize: 16, fontWeight: 700, cursor: gerandoPdf ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        marginTop: 8, marginBottom: 20,
      }}>
        {gerandoPdf ? <Loader2 size={20} className="spinner" /> : <FileDown size={20} />}
        {gerandoPdf ? 'Gerando PDF...' : 'Baixar PDF'}
      </button>
    </div>
  )
}
