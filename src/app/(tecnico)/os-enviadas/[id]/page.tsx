'use client'
import { diasDoRegistro, buscarRelatorioDaOS } from '@/lib/diasRelatorio'
import { downloadFotoRelatorio, cidadeDoCliente, fotosExtrasDoRegistro } from '@/lib/gerarEAnexarRelatorio'
import { useEffect, useState } from 'react'
import { use } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import { getCachedOS, getCachedOSTec, getCachedCliente } from '@/lib/prefetch'
import { gerarPdfRelatorio } from '@/lib/gerarPdfRelatorio'
import { ArrowLeft, FileDown, Loader2, FileEdit, Send, CheckCircle2, FileText, User, Tractor, Wrench, CalendarClock, Package, Camera, AlertTriangle, PenLine } from 'lucide-react'
import { colors } from '@/lib/ui'
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
        // Buscar o registro técnico pela Ordem_Servico (a melhor linha: com 2 linhas o .maybeSingle() quebrava)
        const { data: reg } = await buscarRelatorioDaOS(id)

        if (!reg) { await carregarDoCache(); return }

        // Buscar dados da OS original
        const { data: osLinhas } = await Promise.race([
          supabase.from('Ordem_Servico').select('*').eq('Id_Ordem', id).limit(1),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
        ])
        const osData = ((osLinhas || [])[0] as Record<string, unknown> | undefined) || null

        // cidade: cadastro do Omie no portal (a tabela "Clientes" não existe)
        const cidadeCli = await cidadeDoCliente(osData?.Cnpj_Cliente as string | undefined)
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
    const res = await offlineWrite({
      table: 'Ordem_Servico_Tecnicos',
      action: 'update',
      data: { CartaCorrecao: cartaCorrecao.trim() },
      match: { Ordem_Servico: id },
    })
    if (!res.ok) { setSalvandoCarta(false); alert('Erro ao enviar a carta: ' + (res.error || 'tente de novo')); return }
    setCartaSalva(cartaCorrecao.trim())
    setSalvandoCarta(false)
  }

  const handleGerarPdf = async () => {
    if (!registro) return
    setGerandoPdf(true)

    const dias = diasDoRegistro(registro)
    if (dias.length === 0) {
      dias.push({ data: '', horaInicio: '', horaFim: '', kmTotal: '' })
    }

    // aceita todas as formas de URL do storage (antes só a pública)
    const downloadFoto = downloadFotoRelatorio

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
        fotosExtras: fotosExtrasDoRegistro(registro),
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
      <div style={{ padding: '8px 0' }}>
        <Link href="/os-enviadas" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: colors.primary, fontSize: 15, fontWeight: 500, textDecoration: 'none', marginBottom: 16, padding: '8px 0' }}>
          <ArrowLeft size={20} /> Voltar
        </Link>
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: colors.textMuted }}>Relatório não encontrado</div>
        </div>
      </div>
    )
  }

  /* ── Estilo POS NewPortal (22/10/2026): cartões brancos, títulos com ícone em quadradinho, sem negrito ── */
  const sectionStyle: React.CSSProperties = {
    background: colors.surface, borderRadius: 16, padding: 16, minWidth: 0,
    border: `1px solid ${colors.border}`, marginBottom: 12,
    boxShadow: '0 10px 24px -20px rgba(15,23,42,.5)',
  }
  const fieldLabel: React.CSSProperties = { fontSize: 12.5, color: colors.textSubtle, marginBottom: 2 }
  const fieldValue: React.CSSProperties = { fontSize: 15, fontWeight: 400, color: colors.text, marginBottom: 12, overflowWrap: 'anywhere' }
  const duasCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0 14px' }
  const titulo = (Icon: typeof FileDown, texto: string, cor: string = colors.primary, extra?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
        <span style={{
          width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in srgb, ${cor} 9%, #FEFEFE)`, border: `1px solid color-mix(in srgb, ${cor} 16%, transparent)`, color: cor,
        }}>
          <Icon size={18} />
        </span>
        <span style={{ fontSize: 16, fontWeight: 500, color: colors.text }}>{texto}</span>
      </div>
      {extra}
    </div>
  )

  const dias = diasDoRegistro(registro).map((d) => ({ data: d.data, hi: d.horaInicio, hf: d.horaFim, kmTotal: d.kmTotal }))

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
    // fotos/vídeos do serviço (FotosExtras) e as notas de almoço de cada dia (AlmocosFotos) — 23/10/2026
    ...fotosExtrasDoRegistro(registro).map((url, i) => ({ label: `Serviço ${i + 1}`, url })),
    ...(() => {
      let alm = registro.AlmocosFotos as unknown
      if (typeof alm === 'string') { try { alm = JSON.parse(alm) } catch { alm = null } }
      const lista = (Array.isArray(alm) ? alm : []) as { data?: string; valor?: number; foto?: string }[]
      if (lista.length === 0) return [{ label: 'Nota alimentação', url: registro.FotoAlmoco as string }]
      return lista.filter((a) => a?.foto).map((a) => ({
        label: `Almoço ${String(a.data || '').slice(8, 10)}/${String(a.data || '').slice(5, 7)}${a.valor ? ` · R$ ${Number(a.valor).toFixed(2)}` : ''}`,
        url: String(a.foto),
      }))
    })(),
  ].filter(f => f.url)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0 }}>
      <style>{`.ose-campo:focus { border-color: #38BDF8 !important; box-shadow: 0 0 0 3px rgba(14,165,233,.15) }`}</style>
      <Link href="/os-enviadas" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, justifySelf: 'start',
        color: colors.primary, fontSize: 15, fontWeight: 500,
        textDecoration: 'none', marginBottom: 10, padding: '8px 0',
      }}>
        <ArrowLeft size={20} /> Voltar
      </Link>

      {/* Cabeçalho: faixa verde no topo (relatório enviado) + etiqueta da OS */}
      <div style={{ ...sectionStyle, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 16px', background: colors.osFeita, color: '#FEFEFE' }}>
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>Relatório enviado</span>
          {(registro.Data as string) && <span style={{ fontSize: 12.5, opacity: 0.9 }}>em {formatarDataBR((registro.Data as string) || '')}</span>}
        </div>
        <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: colors.osFeita, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle2 size={22} />
          </span>
          <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
            <span style={{
              justifySelf: 'start', fontSize: 14, padding: '1px 9px', borderRadius: 8, color: colors.text, fontVariantNumeric: 'tabular-nums',
              background: colors.successBg, border: `1px solid ${colors.successBorder}`,
            }}>
              <span style={{ fontSize: 11.5, color: colors.osFeita, marginRight: 5 }}>OS</span>{String(id).replace(/^OS-?/i, '')}
            </span>
            <span style={{ fontSize: 18, fontWeight: 500, color: colors.text, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
              {(osInfo?.Os_Cliente as string) || 'Relatório OS'}
            </span>
            {cidade && <span style={{ fontSize: 13.5, color: colors.textMuted }}>{cidade}</span>}
          </div>
        </div>
      </div>

      {/* Botões: Editar + Gerar PDF */}
      {(() => {
        const dataEnvio = (registro.Data as string) || ''
        const envio = dataEnvio ? new Date(dataEnvio + 'T00:00:00') : null
        const dentroPrazo = envio ? (Date.now() - envio.getTime()) < 48 * 60 * 60 * 1000 : false
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8, marginBottom: 14 }}>
            {dentroPrazo ? (
              <Link href={`/os/${id}/preencher`} style={{
                minHeight: 48, padding: '0 10px', borderRadius: 12,
                background: colors.surface, color: colors.text, border: `1px solid ${colors.border}`,
                fontSize: 15.5, fontWeight: 500, textDecoration: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <FileEdit size={19} color={colors.osPecas} /> Editar OS
              </Link>
            ) : (
              <div style={{
                minHeight: 48, padding: '0 10px', borderRadius: 12,
                background: colors.surfaceAlt, color: colors.textSubtle, border: `1px solid ${colors.border}`,
                fontSize: 14.5, fontWeight: 400,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <FileEdit size={18} /> Prazo expirado
              </div>
            )}
            <button onClick={handleGerarPdf} disabled={gerandoPdf} style={{
              minHeight: 48, padding: '0 10px', borderRadius: 12,
              background: gerandoPdf ? colors.textGhost : colors.primary, color: '#fff', border: 'none',
              fontSize: 15.5, fontWeight: 500, cursor: gerandoPdf ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {gerandoPdf ? <Loader2 size={19} className="spin" /> : <FileDown size={19} />}
              {gerandoPdf ? 'Gerando...' : 'Baixar PDF'}
            </button>
          </div>
        )
      })()}

      {/* Dados da Ordem */}
      <div style={sectionStyle}>
        {titulo(FileText, 'Dados da ordem')}
        <div style={duasCol}>
          <div><div style={fieldLabel}>OS</div><div style={fieldValue}>{id}</div></div>
          <div><div style={fieldLabel}>Preenchido em</div><div style={fieldValue}>{formatarDataBR((registro.Data as string) || '')}</div></div>
          <div><div style={fieldLabel}>Tipo de serviço</div><div style={fieldValue}>{(registro.TipoServico as string) || '-'}</div></div>
          <div><div style={fieldLabel}>Projeto</div><div style={fieldValue}>{(registro.Projeto as string) || '-'}</div></div>
        </div>
        {(osInfo?.ID_PPV as string) && (
          <div><div style={fieldLabel}>PPV</div><div style={{ ...fieldValue, marginBottom: 0 }}>{osInfo?.ID_PPV as string}</div></div>
        )}
      </div>

      {/* Técnicos */}
      <div style={sectionStyle}>
        {titulo(User, 'Técnicos')}
        <div style={duasCol}>
          <div><div style={fieldLabel}>Responsável</div><div style={fieldValue}>{(registro.TecResp1 as string) || '-'}</div></div>
          <div><div style={fieldLabel}>Placa</div><div style={fieldValue}>{(registro.NumPlaca as string) || '-'}</div></div>
        </div>
        {Boolean(registro.TemTec) && (
          <div><div style={fieldLabel}>Técnico 2</div><div style={{ ...fieldValue, marginBottom: 0 }}>{(registro.TecResp2 as string) || '-'}</div></div>
        )}
      </div>

      {/* Equipamento */}
      <div style={sectionStyle}>
        {titulo(Tractor, 'Equipamento', colors.primary, (
          <span style={{
            fontSize: 12.5, padding: '3px 10px', borderRadius: 999, flexShrink: 0,
            background: registro.Garantia ? colors.osFeita : colors.surfaceAlt,
            color: registro.Garantia ? '#fff' : colors.textMuted,
            border: registro.Garantia ? 'none' : `1px solid ${colors.border}`,
          }}>
            {registro.Garantia ? 'Garantia: sim' : 'Garantia: não'}
          </span>
        ))}
        <div style={duasCol}>
          <div><div style={fieldLabel}>Chassis</div><div style={fieldValue}>{(registro.Chassis as string) || '-'}</div></div>
          <div><div style={fieldLabel}>Horímetro</div><div style={fieldValue}>{(registro.Horimetro as string) || '-'}</div></div>
        </div>
        {((registro.Fazenda as string) || (registro.Cidade as string)) && (
          <div style={duasCol}>
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
        {titulo(Wrench, 'Diagnóstico e serviço')}
        <div><div style={fieldLabel}>Diagnóstico / motivo</div><div style={{ ...fieldValue, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{(registro.Motivo as string) || '-'}</div></div>
        <div><div style={fieldLabel}>Serviço realizado</div><div style={{ ...fieldValue, whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: (registro.TipoRev as string) ? 12 : 0 }}>{(registro.ServicoRealizado as string) || '-'}</div></div>
        {(registro.TipoRev as string) && (
          <div><div style={fieldLabel}>Tipo de revisão</div><div style={{ ...fieldValue, marginBottom: 0 }}>{registro.TipoRev as string}</div></div>
        )}
      </div>

      {/* Dias */}
      {dias.length > 0 && (
        <div style={sectionStyle}>
          {titulo(CalendarClock, 'Dias de serviço')}
          <div style={{ display: 'grid', gap: 8 }}>
            {dias.map((d, i) => (
              <div key={i} style={{
                background: '#F8FAFC', borderRadius: 12, padding: 12,
                border: `1px solid ${colors.border}`, minWidth: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 12.5, fontWeight: 500, color: colors.primary, padding: '1px 9px', borderRadius: 999,
                    background: colors.primaryBg, border: `1px solid ${colors.primaryBorder}`,
                  }}>Dia {i + 1}</span>
                  <span style={{ fontSize: 14.5, color: colors.text }}>{formatarDataBR(d.data)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, fontSize: 14 }}>
                  <div><div style={fieldLabel}>Início</div><div style={{ color: colors.text, fontWeight: 500 }}>{d.hi || '-'}</div></div>
                  <div><div style={fieldLabel}>Fim</div><div style={{ color: colors.text, fontWeight: 500 }}>{d.hf || '-'}</div></div>
                  <div><div style={fieldLabel}>KM</div><div style={{ color: colors.text, fontWeight: 500, overflowWrap: 'anywhere' }}>{d.kmTotal || '-'}</div></div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8, marginTop: 10 }}>
            <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '10px 12px' }}>
              <div style={{ fontSize: 13, color: colors.textMuted }}>Total de horas</div>
              <div style={{ fontSize: 24, fontWeight: 500, color: colors.text, lineHeight: 1.2 }}>{(registro.TotalHora as string) || '-'}</div>
            </div>
            <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '10px 12px' }}>
              <div style={{ fontSize: 13, color: colors.textMuted }}>Total de KM</div>
              <div style={{ fontSize: 24, fontWeight: 500, color: colors.text, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{(registro.TotalKm as string) || '-'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Peças */}
      {pecas.length > 0 && (
        <div style={sectionStyle}>
          {titulo(Package, 'Peças')}
          <div style={{ display: 'grid', gap: 8 }}>
            {pecas.filter(p => !p.naoUsada).map((p, i) => (
              <div key={i} style={{
                background: '#F8FAFC', borderRadius: 12, padding: 12,
                border: `1px solid ${colors.border}`, fontSize: 13.5, minWidth: 0,
              }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: colors.text, marginBottom: 6, overflowWrap: 'anywhere' }}>{p.descricao}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px', color: colors.textMuted }}>
                  {p.codigo && <span style={{ overflowWrap: 'anywhere' }}>Cód: {p.codigo}</span>}
                  <span>Qtd: {p.qtdUsada}</span>
                  <span style={{
                    fontSize: 12, padding: '1px 9px', borderRadius: 999,
                    background: p.origem === 'ppv' ? colors.primaryBg : colors.warningBg,
                    color: p.origem === 'ppv' ? colors.primary : '#9A3412',
                    border: `1px solid ${p.origem === 'ppv' ? colors.primaryBorder : colors.warningBorder}`,
                  }}>
                    {p.origem === 'ppv' ? 'PPV' : 'Manual'}
                  </span>
                </div>
                {p.devolvida && <div style={{ color: '#9A3412', marginTop: 6 }}>Devolvida: {p.qtdDevolvida}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fotos */}
      {fotos.length > 0 && (
        <div style={sectionStyle}>
          {titulo(Camera, 'Fotos')}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            {fotos.map((f, i) => (
              <div key={i} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: colors.textMuted, marginBottom: 4 }}>{f.label}</div>
                {/\.(mp4|mov|webm|avi|mkv|3gp)(\?|$)/i.test(f.url) ? (
                  <video src={f.url} controls playsInline preload="metadata" style={{
                    width: '100%', borderRadius: 12, objectFit: 'cover', display: 'block',
                    aspectRatio: '4/3', background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
                  }} />
                ) : (
                  <img src={f.url} alt={f.label} style={{
                    width: '100%', borderRadius: 12, objectFit: 'cover', display: 'block',
                    aspectRatio: '4/3', background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
                  }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Justificativa de Atraso */}
      {(registro.JustificativaAtraso as string) && (
        <div style={{ ...sectionStyle, background: colors.dangerBg, border: `1px solid ${colors.dangerBorder}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10 }}>
            <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, background: colors.osAtrasada, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={18} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 500, color: '#991B1B' }}>Justificativa de atraso</span>
          </div>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 12,
            border: `1px solid ${colors.dangerBorder}`, fontSize: 14.5, color: colors.text,
            lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          }}>
            {registro.JustificativaAtraso as string}
          </div>
        </div>
      )}

      {/* Assinaturas */}
      {((registro.AssCliente as string) || (registro.AssTecnico as string)) && (
        <div style={sectionStyle}>
          {titulo(PenLine, 'Assinaturas')}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={fieldLabel}>Cliente</div>
              {(registro.AssCliente as string) ? (
                <img src={registro.AssCliente as string} alt="Assinatura cliente" style={{ width: '100%', borderRadius: 12, border: `1px solid ${colors.border}`, background: '#fff', display: 'block' }} />
              ) : <div style={{ color: colors.textGhost, fontSize: 14 }}>Sem assinatura</div>}
              <div style={{ fontSize: 13, color: colors.text, marginTop: 6, textAlign: 'center', overflowWrap: 'anywhere' }}>{(registro.NomResp as string) || '-'}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={fieldLabel}>Técnico</div>
              {(registro.AssTecnico as string) ? (
                <img src={registro.AssTecnico as string} alt="Assinatura técnico" style={{ width: '100%', borderRadius: 12, border: `1px solid ${colors.border}`, background: '#fff', display: 'block' }} />
              ) : <div style={{ color: colors.textGhost, fontSize: 14 }}>Sem assinatura</div>}
              <div style={{ fontSize: 13, color: colors.text, marginTop: 6, textAlign: 'center', overflowWrap: 'anywhere' }}>{(registro.TecResp1 as string) || '-'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Carta de Correção */}
      <div style={sectionStyle}>
        {titulo(FileEdit, 'Carta de correção', colors.osPecas, cartaSalva ? (
          <span style={{
            fontSize: 12.5, fontWeight: 500, padding: '3px 10px', borderRadius: 999, flexShrink: 0,
            background: colors.osFeita, color: '#fff',
          }}>Enviada</span>
        ) : undefined)}

        {cartaSalva && !mostrarCarta ? (
          <div>
            <div style={{
              background: colors.warningBg, borderRadius: 12, padding: 12,
              border: `1px solid ${colors.warningBorder}`, fontSize: 14.5, color: colors.text,
              lineHeight: 1.55, whiteSpace: 'pre-wrap', marginBottom: 10, overflowWrap: 'anywhere',
            }}>
              {cartaSalva}
            </div>
            <button type="button" onClick={() => setMostrarCarta(true)} style={{
              fontSize: 15, color: colors.primary, background: 'none', border: 'none',
              cursor: 'pointer', fontWeight: 500, padding: '6px 0',
            }}>
              Editar carta
            </button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 14, color: colors.textMuted, margin: '0 0 10px', lineHeight: 1.45 }}>
              Se precisar corrigir alguma informação do relatório, descreva aqui. A carta ficará anexada junto ao relatório no portal.
            </p>
            <textarea
              value={cartaCorrecao}
              onChange={(e) => setCartaCorrecao(e.target.value)}
              placeholder="Descreva a correção necessária..."
              rows={4}
              className="ose-campo"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 12,
                border: `1px solid ${colors.border}`, fontSize: 16, outline: 'none', color: colors.text,
                background: '#fff', boxSizing: 'border-box', resize: 'vertical',
                lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {cartaSalva && (
                <button type="button" onClick={() => { setMostrarCarta(false); setCartaCorrecao(cartaSalva) }} style={{
                  flex: 1, minHeight: 46, borderRadius: 12,
                  background: '#fff', color: colors.text, border: `1px solid ${colors.border}`,
                  fontSize: 15, fontWeight: 500, cursor: 'pointer',
                }}>
                  Cancelar
                </button>
              )}
              <button type="button" onClick={salvarCartaCorrecao} disabled={salvandoCarta || !cartaCorrecao.trim()} style={{
                flex: 1, minHeight: 46, borderRadius: 12,
                background: !cartaCorrecao.trim() ? colors.textGhost : colors.primary, color: '#fff', border: 'none',
                fontSize: 15, fontWeight: 500, cursor: salvandoCarta ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: salvandoCarta ? 0.7 : 1,
              }}>
                <Send size={16} />
                {salvandoCarta ? 'Enviando...' : 'Enviar carta'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Botão PDF no final */}
      <button onClick={handleGerarPdf} disabled={gerandoPdf} style={{
        width: '100%', minHeight: 48, borderRadius: 12,
        background: gerandoPdf ? colors.textGhost : colors.primary, color: '#fff', border: 'none',
        fontSize: 16, fontWeight: 500, cursor: gerandoPdf ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        marginTop: 4, marginBottom: 20,
      }}>
        {gerandoPdf ? <Loader2 size={20} className="spin" /> : <FileDown size={20} />}
        {gerandoPdf ? 'Gerando PDF...' : 'Baixar PDF'}
      </button>
    </div>
  )
}
