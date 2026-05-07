'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Search, Download, Image as ImageIcon, Camera, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

interface FotoItem {
  label: string
  url: string
  campo: string
}

const FOTO_LABELS: Record<string, string> = {
  FotoHorimetro: 'Horímetro',
  FotoChassis: 'Chassis',
  FotoFrente: 'Frente',
  FotoDireita: 'Direita',
  FotoEsquerda: 'Esquerda',
  FotoTraseira: 'Traseira',
  FotoVolante: 'Volante',
  FotoFalha1: 'Falha 1',
  FotoFalha2: 'Falha 2',
  FotoFalha3: 'Falha 3',
  FotoFalha4: 'Falha 4',
  FotoPecaNova1: 'Peça Nova 1',
  FotoPecaNova2: 'Peça Nova 2',
  FotoPecaInstalada1: 'Peça Instalada 1',
  FotoPecaInstalada2: 'Peça Instalada 2',
  FotoAlmoco: 'Almoço',
}

const FOTO_CAMPOS = Object.keys(FOTO_LABELS)

export default function FotosPage() {
  const [busca, setBusca] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [fotos, setFotos] = useState<FotoItem[]>([])
  const [osInfo, setOsInfo] = useState<{ tecnico: string; cliente: string; data: string } | null>(null)
  const [buscaFeita, setBuscaFeita] = useState(false)
  const [fotoAberta, setFotoAberta] = useState<FotoItem | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)

  const pesquisar = async () => {
    const termo = busca.trim()
    if (!termo) return
    setBuscando(true)
    setFotos([])
    setOsInfo(null)
    setBuscaFeita(false)

    const { data } = await supabase
      .from('Ordem_Servico_Tecnicos')
      .select(FOTO_CAMPOS.join(', ') + ', TecResp1, Data, Ordem_Servico')
      .ilike('Ordem_Servico', `%${termo}%`)
      .limit(1)
      .maybeSingle()

    if (data) {
      const encontradas: FotoItem[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = data as any
      for (const campo of FOTO_CAMPOS) {
        const url = rec[campo] as string
        if (url) {
          encontradas.push({ label: FOTO_LABELS[campo], url, campo })
        }
      }
      setFotos(encontradas)

      // Buscar info da OS
      const { data: osData } = await supabase
        .from('Ordem_Servico')
        .select('Os_Cliente')
        .eq('Id_Ordem', rec.Ordem_Servico)
        .maybeSingle()

      setOsInfo({
        tecnico: (rec.TecResp1 as string) || '-',
        cliente: osData?.Os_Cliente || '-',
        data: (rec.Data as string) || '-',
      })
    }

    setBuscaFeita(true)
    setBuscando(false)
  }

  const baixarFoto = async (foto: FotoItem) => {
    setBaixando(foto.campo)
    try {
      const resp = await fetch(foto.url)
      const blob = await resp.blob()
      const ext = foto.url.split('.').pop()?.split('?')[0] || 'jpg'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${busca.trim()}_${foto.campo}.${ext}`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      alert('Erro ao baixar foto')
    }
    setBaixando(null)
  }

  const baixarTodas = async () => {
    for (const foto of fotos) {
      await baixarFoto(foto)
    }
  }

  const formatarData = (d: string) => {
    if (!d) return '-'
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E3A5F', margin: '0 0 4px' }}>
          Fotos por OS
        </h1>
        <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
          Pesquise pelo número da OS para ver e baixar as fotos
        </p>
      </div>

      {/* Barra de busca */}
      <form onSubmit={e => { e.preventDefault(); pesquisar() }} style={{
        display: 'flex', gap: 8, marginBottom: 20,
      }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={18} color="#9CA3AF" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Ex: OS-0234"
            style={{
              width: '100%', padding: '12px 12px 12px 40px', borderRadius: 12,
              border: '2px solid #E5E7EB', fontSize: 15, outline: 'none',
              boxSizing: 'border-box', background: '#FAFAFA',
            }}
          />
        </div>
        <button type="submit" disabled={buscando || !busca.trim()} style={{
          padding: '12px 20px', borderRadius: 12,
          background: !busca.trim() ? '#E5E7EB' : '#1E3A5F',
          color: !busca.trim() ? '#9CA3AF' : '#fff',
          fontSize: 14, fontWeight: 700, border: 'none',
          cursor: buscando ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        }}>
          {buscando ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
          Buscar
        </button>
      </form>

      {/* Resultado */}
      {buscaFeita && fotos.length === 0 && (
        <div style={{
          background: '#fff', borderRadius: 16, padding: 40,
          textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <Camera size={40} color="#D1D5DB" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#6B7280' }}>Nenhuma foto encontrada</div>
          <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 4 }}>
            Verifique o número da OS ou se o técnico já enviou o relatório
          </div>
        </div>
      )}

      {fotos.length > 0 && osInfo && (
        <>
          {/* Info da OS */}
          <div style={{
            background: '#fff', borderRadius: 14, padding: 16, marginBottom: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
          }}>
            <div>
              <div style={{ fontSize: 11, color: '#9CA3AF' }}>Técnico</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1F2937' }}>{osInfo.tecnico}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#9CA3AF' }}>Cliente</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1F2937' }}>{osInfo.cliente}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#9CA3AF' }}>Data</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1F2937' }}>{formatarData(osInfo.data)}</div>
            </div>
          </div>

          {/* Header com contador + botão baixar todas */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 12,
          }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
              {fotos.length} foto{fotos.length > 1 ? 's' : ''}
            </span>
            <button onClick={baixarTodas} style={{
              padding: '8px 14px', borderRadius: 8,
              background: '#1E3A5F', color: '#fff', fontSize: 12, fontWeight: 700,
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Download size={14} /> Baixar Todas
            </button>
          </div>

          {/* Grid de fotos */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 10,
          }}>
            {fotos.map(foto => (
              <div key={foto.campo} style={{
                background: '#fff', borderRadius: 12, overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                border: '1px solid #E5E7EB',
              }}>
                <div
                  onClick={() => setFotoAberta(foto)}
                  style={{ cursor: 'pointer', position: 'relative', paddingTop: '75%' }}
                >
                  <img
                    src={foto.url}
                    alt={foto.label}
                    style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                </div>
                <div style={{ padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{foto.label}</span>
                  <button
                    onClick={() => baixarFoto(foto)}
                    disabled={baixando === foto.campo}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                      opacity: baixando === foto.campo ? 0.4 : 1,
                    }}
                  >
                    {baixando === foto.campo
                      ? <Loader2 size={14} color="#6B7280" className="spinner" />
                      : <Download size={14} color="#6B7280" />
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal foto ampliada */}
      {fotoAberta && (
        <div
          onClick={() => setFotoAberta(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', maxWidth: 600, marginBottom: 12,
          }}>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{fotoAberta.label}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={e => { e.stopPropagation(); baixarFoto(fotoAberta) }}
                style={{
                  background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8,
                  padding: '8px 14px', color: '#fff', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <Download size={16} /> Baixar
              </button>
              <button
                onClick={() => setFotoAberta(null)}
                style={{
                  background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8,
                  padding: 8, cursor: 'pointer',
                }}
              >
                <X size={18} color="#fff" />
              </button>
            </div>
          </div>
          <img
            src={fotoAberta.url}
            alt={fotoAberta.label}
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '100%', maxHeight: '80vh',
              borderRadius: 8, objectFit: 'contain',
            }}
          />
        </div>
      )}
    </div>
  )
}
