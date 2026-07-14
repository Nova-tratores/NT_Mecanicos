'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { gerarEAnexarRelatorio } from '@/lib/gerarEAnexarRelatorio'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, FileDown, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import Link from 'next/link'

export default function RegerarPdf() {
  const searchParams = useSearchParams()
  const osParam = searchParams.get('os') || ''
  const [osId, setOsId] = useState(osParam)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const [info, setInfo] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (osParam) setOsId(osParam)
  }, [osParam])

  const carregar = async () => {
    if (!osId.trim()) return
    setStatus('loading')
    setMsg('Buscando OS...')
    const { data } = await supabase
      .from('Ordem_Servico_Tecnicos')
      .select('Ordem_Servico, TecResp1, Status, pdf_criado, Data')
      .eq('Ordem_Servico', osId.trim())
      .maybeSingle()
    if (!data) {
      setStatus('error')
      setMsg(`Nenhum registro de técnico encontrado para ${osId}`)
      setInfo(null)
      return
    }
    setInfo(data)
    setStatus('idle')
    setMsg('')
  }

  const regerar = async () => {
    if (!osId.trim()) return
    setStatus('loading')
    setMsg('Gerando PDF... Isso pode demorar até 30s (fotos).')
    try {
      const ok = await gerarEAnexarRelatorio(osId.trim())
      if (ok) {
        setStatus('success')
        setMsg('PDF gerado e anexado com sucesso!')
        if (info) setInfo({ ...info, pdf_criado: true })
      } else {
        setStatus('error')
        setMsg('Falha ao gerar PDF. Verifique se a OS existe e tem dados do relatório.')
      }
    } catch (err) {
      setStatus('error')
      setMsg(`Erro: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  useEffect(() => {
    if (osParam) carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osParam])

  return (
    <div style={{ padding: 24, maxWidth: 500, margin: '0 auto' }}>
      <Link href="/admin" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 14, marginBottom: 20, textDecoration: 'none' }}>
        <ArrowLeft size={16} /> Voltar
      </Link>

      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Regerar PDF de OS</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={osId}
          onChange={e => setOsId(e.target.value)}
          placeholder="Ex: OS-0524"
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            border: '1.5px solid #e2e8f0', fontSize: 15, outline: 'none',
          }}
          onKeyDown={e => e.key === 'Enter' && carregar()}
        />
        <button
          onClick={carregar}
          disabled={status === 'loading'}
          style={{
            padding: '10px 18px', borderRadius: 10, border: 'none',
            background: '#334155', color: '#fff', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', opacity: status === 'loading' ? 0.6 : 1,
          }}
        >
          Buscar
        </button>
      </div>

      {info && (
        <div style={{
          background: '#f8fafc', borderRadius: 12, padding: 16,
          border: '1px solid #e2e8f0', marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>OS</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>{String(info.Ordem_Servico)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div><span style={{ color: '#64748b' }}>Técnico:</span> {String(info.TecResp1 || '-')}</div>
            <div><span style={{ color: '#64748b' }}>Data:</span> {String(info.Data || '-')}</div>
            <div><span style={{ color: '#64748b' }}>Status:</span> {String(info.Status || '-')}</div>
            <div>
              <span style={{ color: '#64748b' }}>PDF:</span>{' '}
              <span style={{ color: info.pdf_criado ? '#059669' : '#dc2626', fontWeight: 600 }}>
                {info.pdf_criado ? 'Gerado' : 'Não gerado'}
              </span>
            </div>
          </div>
        </div>
      )}

      {info && !info.pdf_criado && (
        <button
          onClick={regerar}
          disabled={status === 'loading'}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
            background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: 15,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: status === 'loading' ? 0.6 : 1,
          }}
        >
          {status === 'loading' ? <Loader2 size={18} className="spinner" /> : <FileDown size={18} />}
          Gerar e Anexar PDF
        </button>
      )}

      {Boolean(info?.pdf_criado) && status !== 'loading' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: 14,
          background: '#ecfdf5', borderRadius: 12, color: '#059669', fontWeight: 600,
        }}>
          <CheckCircle2 size={18} /> PDF já está gerado e anexado
        </div>
      )}

      {msg && (
        <div style={{
          marginTop: 16, padding: 14, borderRadius: 12, fontSize: 14,
          display: 'flex', alignItems: 'center', gap: 8,
          background: status === 'success' ? '#ecfdf5' : status === 'error' ? '#fef2f2' : '#f0f9ff',
          color: status === 'success' ? '#059669' : status === 'error' ? '#dc2626' : '#2563eb',
          fontWeight: 500,
        }}>
          {status === 'success' && <CheckCircle2 size={16} />}
          {status === 'error' && <AlertTriangle size={16} />}
          {status === 'loading' && <Loader2 size={16} className="spinner" />}
          {msg}
        </div>
      )}
    </div>
  )
}
