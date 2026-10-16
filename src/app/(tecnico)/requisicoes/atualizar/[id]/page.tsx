'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { use } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import { getCachedRequisicoes, getCachedFornecedores } from '@/lib/prefetch'
import { fmtData } from '@/lib/garantias/format'
import { ArrowLeft, Upload, CheckCircle, Store, WifiOff } from 'lucide-react'
import Link from 'next/link'
import { notificarPortalReq } from '@/lib/notificarPortal'

// Com sinal fraco as consultas podiam ficar penduradas e a tela nunca saía do spinner
const LOAD_TIMEOUT = 10000
const UPLOAD_TIMEOUT = 45000

function comTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms) }),
  ]).finally(() => clearTimeout(timer))
}

interface Fornecedor {
  id: number
  nome: string
  numero: string | null
  'cpf/cnpj': string | null
  descricao: string | null
}

interface RequisicaoInfo {
  id: number
  titulo: string
  tipo: string
  data: string
  obs: string | null
  fornecedor: string | null
  valor_despeza: string | null
}

export default function AtualizarRequisicao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useCurrentUser()
  const router = useRouter()

  const [req, setReq] = useState<RequisicaoInfo | null>(null)
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [sucesso, setSucesso] = useState(false)
  const [enviadaOffline, setEnviadaOffline] = useState(false)
  const [offlineDados, setOfflineDados] = useState(false)
  const [filtroFornecedor, setFiltroFornecedor] = useState('')
  const [showFornecedores, setShowFornecedores] = useState(false)

  const [form, setForm] = useState({
    valor: '',
    fornecedor: '',
    foto: null as File | null,
    fotoPreview: '',
  })

  // Backup automático do formulário
  const getFormData = useCallback(() => ({
    valor: form.valor, fornecedor: form.fornecedor,
  }), [form.valor, form.fornecedor])

  const setFormData = useCallback((data: Record<string, unknown>) => {
    setForm(prev => ({
      ...prev,
      valor: (data.valor as string) || prev.valor,
      fornecedor: (data.fornecedor as string) || prev.fornecedor,
    }))
  }, [])

  const { clear: clearBackup, restore: restoreBackup } = useFormBackup(`req-atualizar-${id}`, getFormData, setFormData)

  const restoredRef = useRef(false)
  useEffect(() => {
    if (!loading && !restoredRef.current) {
      restoredRef.current = true
      restoreBackup()
    }
  }, [loading, restoreBackup])

  useEffect(() => {
    let vivo = true
    const doCache = async () => {
      try {
        const [reqs, forns] = await Promise.all([getCachedRequisicoes(), getCachedFornecedores()])
        const r = (reqs || []).find((x) => String(x.id) === String(id))
        return {
          req: (r as unknown as RequisicaoInfo) || null,
          forn: (forns as unknown as Fornecedor[]) || [],
        }
      } catch {
        return { req: null, forn: [] as Fornecedor[] }
      }
    }
    const carregar = async () => {
      try {
        if (!navigator.onLine) throw new Error('offline')
        const [{ data: reqData, error: reqErr }, { data: fornData }] = await comTimeout(Promise.all([
          supabase.from('Requisicao').select('id, titulo, tipo, data, obs, fornecedor, valor_despeza').eq('id', id).maybeSingle(),
          supabase.from('Fornecedores').select('*').order('nome'),
        ]), LOAD_TIMEOUT)
        if (reqErr) throw reqErr
        if (!vivo) return
        setReq((reqData as RequisicaoInfo) || null)
        if (fornData) setFornecedores(fornData as Fornecedor[])
        else {
          const c = await doCache()
          if (vivo) setFornecedores(c.forn)
        }
      } catch {
        // Offline / sinal fraco: usa o que o prefetch baixou
        const c = await doCache()
        if (!vivo) return
        setReq(c.req)
        setFornecedores(c.forn)
        setOfflineDados(true)
      } finally {
        if (vivo) setLoading(false)
      }
    }
    carregar()
    return () => { vivo = false }
  }, [id])

  // Libera a memória do preview da foto (object URL) ao trocar/remover/sair
  useEffect(() => {
    const url = form.fotoPreview
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [form.fotoPreview])

  const handleFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite escolher a mesma foto de novo
    if (!file) return
    const preview = URL.createObjectURL(file)
    setForm((prev) => ({ ...prev, foto: file, fotoPreview: preview }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Guarda síncrona contra toque duplo (o disabled só vale após o re-render)
    if (savingRef.current) return
    if (!req || !form.valor.trim() || !form.fornecedor.trim()) return
    savingRef.current = true
    setSaving(true)
    try {
      await enviarAtualizacao(req)
    } catch (err) {
      console.error('[req-atualizar] enviar:', err)
      alert('Erro ao enviar. Seus dados continuam salvos — verifique o sinal e tente novamente.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const enviarAtualizacao = async (req: RequisicaoInfo) => {
    let fotoUrl: string | null = null

    // Upload da foto se tiver. A fila offline não sobe arquivos, então sem
    // sinal o técnico escolhe: esperar sinal ou enviar só os dados.
    if (form.foto) {
      let fotoOk = false
      if (navigator.onLine) {
        try {
          const ext = form.foto.name.split('.').pop() || 'jpg'
          const path = `comprovantes/${req.id}_${Date.now()}.${ext}`
          const { error: uploadError } = await comTimeout(
            supabase.storage.from('requisicoes').upload(path, form.foto),
            UPLOAD_TIMEOUT,
          )
          if (!uploadError) {
            const { data: urlData } = supabase.storage.from('requisicoes').getPublicUrl(path)
            fotoUrl = urlData.publicUrl
            fotoOk = true
          } else {
            console.error('[req-atualizar] upload:', uploadError.message)
          }
        } catch (err) {
          console.error('[req-atualizar] upload:', err)
        }
      }
      if (!fotoOk) {
        const seguir = window.confirm(
          'Não foi possível enviar a foto do comprovante (sem sinal ou sinal fraco).\n\n' +
          'OK = enviar só valor e fornecedor agora (mande a foto ao escritório depois)\n' +
          'Cancelar = esperar e tentar de novo com a foto',
        )
        if (!seguir) return
      }
    }

    // Atualiza a Requisicao com fornecedor e valor (enfileira se offline)
    const dadosReq: Record<string, unknown> = {
      fornecedor: form.fornecedor.toUpperCase(),
      valor_despeza: form.valor,
      status: 'completa',
    }
    // Não apaga um comprovante já existente quando a foto não subiu
    if (fotoUrl) dadosReq.recibo_fornecedor = fotoUrl
    const resReq = await offlineWrite({
      table: 'Requisicao', action: 'update', data: dadosReq, match: { id: req.id },
    })
    if (!resReq.ok) {
      console.error('[req-atualizar] update Requisicao:', resReq.error)
      alert('Erro ao atualizar a requisição. Tente novamente.')
      return
    }

    // Insere na tabela Supa-AtualizarReq para o portal receber em tempo real
    const resPortal = await offlineWrite({
      table: 'Supa-AtualizarReq',
      action: 'insert',
      data: {
        ReqREF: String(req.id),
        ReqValor: form.valor,
        ReqFotoNota: fotoUrl,
      },
    })
    if (!resPortal.ok) console.error('[req-atualizar] Supa-AtualizarReq:', resPortal.error)

    // Notifica portal (bell icon)
    const nomeTecnico = user?.nome_pos || user?.tecnico_nome || 'Técnico'
    notificarPortalReq(
      'Requisição Atualizada',
      `${nomeTecnico} atualizou a requisição #${req.id} — ${req.titulo} (R$ ${form.valor})`
    )

    setEnviadaOffline(resReq.queued)
    setSucesso(true)
    clearBackup()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!req) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>
        {offlineDados
          ? 'Sem conexão e esta requisição não está salva no aparelho. Tente de novo quando tiver sinal.'
          : 'Requisição não encontrada'}
        <div style={{ marginTop: 16 }}>
          <Link href="/requisicoes" style={{ color: '#C41E2A', fontWeight: 600, textDecoration: 'none' }}>
            Voltar às Requisições
          </Link>
        </div>
      </div>
    )
  }

  if (sucesso) {
    return (
      <div style={{
        minHeight: '60vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20,
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%', background: '#D1FAE5',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
        }}>
          <CheckCircle size={40} color="#10B981" />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937', marginBottom: 8 }}>
          Requisição Atualizada!
        </h2>
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 24 }}>
          {enviadaOffline
            ? 'Sem sinal agora — os dados ficaram salvos e serão enviados quando a conexão voltar.'
            : 'Os dados foram enviados com sucesso.'}
        </p>
        <Link href="/requisicoes" style={{
          background: '#C41E2A', color: '#fff', borderRadius: 12,
          padding: '14px 32px', fontSize: 15, fontWeight: 700,
          textDecoration: 'none',
        }}>
          Voltar às Requisições
        </Link>
      </div>
    )
  }

  const fornecedoresFiltrados = fornecedores.filter((f) =>
    // nome pode vir null do banco — antes derrubava a tela com TypeError
    (f.nome || '').toLowerCase().includes(filtroFornecedor.toLowerCase())
  )

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '14px 16px', borderRadius: 12,
    border: '1.5px solid #E5E7EB', fontSize: 16, outline: 'none',
    background: '#fff',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: '#374151',
    display: 'block', marginBottom: 6,
  }

  return (
    <div>
      <Link href="/requisicoes" style={{
        display: 'flex', alignItems: 'center', gap: 6,
        color: '#C41E2A', fontSize: 14, fontWeight: 600,
        textDecoration: 'none', marginBottom: 16,
      }}>
        <ArrowLeft size={18} /> Voltar
      </Link>

      {offlineDados && (
        <div role="status" style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          padding: '10px 12px', borderRadius: 12, background: '#FEF3C7',
          color: '#92400E', fontSize: 13, fontWeight: 600,
        }}>
          <WifiOff size={15} style={{ flexShrink: 0 }} />
          <span style={{ minWidth: 0 }}>Sem conexão — dados salvos no aparelho. O envio fica na fila até o sinal voltar.</span>
        </div>
      )}

      {/* Info da requisição */}
      <div style={{
        background: '#1E3A5F', borderRadius: 16, padding: 18, color: '#fff', marginBottom: 20,
      }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Requisição #{req.id}</div>
        <div style={{ fontSize: 17, fontWeight: 700, overflowWrap: 'anywhere' }}>{req.titulo}</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
          {req.tipo} • {fmtData(req.data)}
        </div>
      </div>

      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', marginBottom: 16 }}>
        Atualizar Dados
      </h2>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Valor */}
        <div>
          <label style={labelStyle}>Valor do Serviço / Material *</label>
          <input
            type="text"
            value={form.valor}
            onChange={(e) => { const valor = e.target.value; setForm((prev) => ({ ...prev, valor })) }}
            required
            placeholder="Ex: 150,00"
            style={inputStyle}
            inputMode="decimal"
          />
        </div>

        {/* Fornecedor */}
        <div>
          <label style={labelStyle}>Fornecedor *</label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={form.fornecedor}
              onChange={(e) => {
                const fornecedor = e.target.value
                setForm((prev) => ({ ...prev, fornecedor }))
                setFiltroFornecedor(fornecedor)
                setShowFornecedores(true)
              }}
              onFocus={() => { setFiltroFornecedor(form.fornecedor); setShowFornecedores(true) }}
              required
              placeholder="Digite ou selecione o fornecedor..."
              style={inputStyle}
            />
            {showFornecedores && filtroFornecedor.length >= 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                background: '#fff', borderRadius: 12, marginTop: 4,
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                maxHeight: 200, overflowY: 'auto',
                border: '1px solid #E5E7EB',
              }}>
                {fornecedoresFiltrados.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 13, color: '#9CA3AF', textAlign: 'center' }}>
                    Nenhum fornecedor encontrado
                  </div>
                ) : fornecedoresFiltrados.slice(0, 10).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, fornecedor: f.nome || '' }))
                      setShowFornecedores(false)
                    }}
                    style={{
                      width: '100%', padding: '12px 16px', border: 'none',
                      background: 'transparent', cursor: 'pointer',
                      textAlign: 'left', borderBottom: '1px solid #F3F4F6',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}
                  >
                    <Store size={16} color="#C41E2A" style={{ flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1F2937' }}>{f.nome}</div>
                      {f.descricao && <div style={{ fontSize: 11, color: '#9CA3AF' }}>{f.descricao}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Foto do comprovante */}
        <div>
          <label style={labelStyle}>Foto do Comprovante</label>
          <label style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            background: '#fff', borderRadius: 14, padding: form.fotoPreview ? 8 : 32,
            border: '2px dashed #E5E7EB', cursor: 'pointer',
            textAlign: 'center',
          }}>
            {form.fotoPreview ? (
              <img
                src={form.fotoPreview}
                alt="Comprovante"
                style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 10 }}
              />
            ) : (
              <>
                <Upload size={32} color="#9CA3AF" />
                <span style={{ fontSize: 14, color: '#6B7280' }}>
                  Toque para tirar foto ou selecionar
                </span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFoto}
              style={{ display: 'none' }}
            />
          </label>
          {form.fotoPreview && (
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, foto: null, fotoPreview: '' }))}
              style={{
                marginTop: 8, minHeight: 40, padding: '0 4px', fontSize: 13, color: '#EF4444', background: 'none',
                border: 'none', cursor: 'pointer', fontWeight: 600,
              }}
            >
              Remover foto
            </button>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={saving || !form.valor.trim() || !form.fornecedor.trim()}
          style={{
            width: '100%', padding: '16px 0', borderRadius: 14,
            background: saving ? '#9CA3AF' : '#1E3A5F', color: '#fff',
            fontSize: 16, fontWeight: 700, border: 'none',
            cursor: saving ? 'default' : 'pointer',
            marginTop: 8, display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 8,
          }}
        >
          <CheckCircle size={18} />
          {saving ? 'Enviando...' : 'Confirmar Atualização'}
        </button>
      </form>

      {/* Overlay para fechar dropdown */}
      {showFornecedores && (
        <div
          onClick={() => setShowFornecedores(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 10 }}
        />
      )}

      <div style={{ height: 20 }} />
    </div>
  )
}
