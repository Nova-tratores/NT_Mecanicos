'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { use } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import { supabase } from '@/lib/supabase'
import { getCachedRequisicoes, getCachedFornecedores } from '@/lib/prefetch'
import { comprimirImagem, blobParaBase64 } from '@/lib/imagem'
import { CheckCircle, Store, Camera, ClipboardList, Receipt } from 'lucide-react'
import { COR, T, cartao, campo, rotulo, botaoPrincipal, Icone, Voltar, TelaSucesso, EstiloCampos } from '../../_ui'
import { lerValor, moeda, dataBR, erroDeRede, enviarAtualizacao, guardarPendente, enviarPendentes } from '../../_util'

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

// Regras (José, 23/10/2026): confere cada erro; sem sinal guarda no celular (comprovante em base64) e não
// apaga o digitado; sem comprovante não vira "completa" (continua pendente); valor aceita 150,00 e precisa ser > 0.
export default function AtualizarRequisicao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useCurrentUser()

  const [req, setReq] = useState<RequisicaoInfo | null>(null)
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // 'ok' foi; 'guardado' sem sinal, vai depois; 'sem-comprovante' foi, mas segue pendente
  const [sucesso, setSucesso] = useState<null | 'ok' | 'guardado' | 'sem-comprovante'>(null)
  const [erro, setErro] = useState('')
  const [filtroFornecedor, setFiltroFornecedor] = useState('')
  const [showFornecedores, setShowFornecedores] = useState(false)
  const [preparandoFoto, setPreparandoFoto] = useState(false)

  const [form, setForm] = useState({
    valor: '',
    fornecedor: '',
    foto: null as Blob | null,
    fotoNome: '',
    fotoPreview: '',
  })

  // trava contra toque duplo + marca de enviado (o backup não regrava depois de enviar)
  const enviandoRef = useRef(false)
  const enviadoRef = useRef(false)

  // Backup automático do formulário
  const getFormData = useCallback(() => (enviadoRef.current ? {} : {
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

  // manda o que ficou guardado sem sinal
  useEffect(() => {
    const mandar = () => { enviarPendentes().catch(() => {}) }
    mandar()
    window.addEventListener('online', mandar)
    return () => window.removeEventListener('online', mandar)
  }, [])

  useEffect(() => {
    const doCache = async () => {
      const [reqs, forns] = await Promise.all([getCachedRequisicoes(), getCachedFornecedores()])
      const r = (reqs || []).find((x) => String(x.id) === String(id))
      if (r) setReq(r as unknown as RequisicaoInfo)
      if (forns) setFornecedores(forns as unknown as Fornecedor[])
    }
    const carregar = async () => {
      if (!navigator.onLine) { await doCache(); setLoading(false); return }
      try {
        const [{ data: reqData, error: e1 }, { data: fornData }] = await Promise.all([
          supabase.from('Requisicao').select('id, titulo, tipo, data, obs, fornecedor, valor_despeza').eq('id', id).maybeSingle(),
          supabase.from('Fornecedores').select('*').order('nome'),
        ])
        if (e1) throw e1
        if (reqData) setReq(reqData as RequisicaoInfo)
        if (fornData) setFornecedores(fornData as Fornecedor[])
        else await doCache()
      } catch {
        await doCache()
      }
      setLoading(false)
    }
    carregar()
  }, [id])

  // libera a prévia da foto da memória
  useEffect(() => () => { if (form.fotoPreview) URL.revokeObjectURL(form.fotoPreview) }, [form.fotoPreview])

  const handleFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    input.value = '' // deixa escolher a mesma foto de novo
    if (!file) return
    setPreparandoFoto(true)
    const comprimida = await comprimirImagem(file)
    setPreparandoFoto(false)
    setForm(prev => ({ ...prev, foto: comprimida, fotoNome: file.name, fotoPreview: URL.createObjectURL(comprimida) }))
  }

  const valorNum = lerValor(form.valor)
  const valorOk = Number.isFinite(valorNum) && valorNum > 0

  const terminar = (r: 'ok' | 'guardado' | 'sem-comprovante') => {
    enviadoRef.current = true
    clearBackup()
    setSucesso(r)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!req || enviandoRef.current) return
    setErro('')
    if (!valorOk) { setErro('Informe um valor maior que zero, por exemplo 150,00.'); return }
    if (!form.fornecedor.trim()) { setErro('Informe o fornecedor.'); return }
    if (!form.foto && !window.confirm('Sem a foto do comprovante a requisição continua pendente — só o valor e o fornecedor vão para o escritório. Enviar assim mesmo?')) return
    enviandoRef.current = true
    setSaving(true)

    const nomeTecnico = user?.nome_pos || user?.tecnico_nome || 'Técnico'
    const valor = moeda(valorNum)
    const fornecedor = form.fornecedor.trim()
    const guardar = async () => {
      await guardarPendente({
        reqId: req.id, titulo: req.titulo, valor, fornecedor,
        comprovante: form.foto ? await blobParaBase64(form.foto) : null,
        tecnico: nomeTecnico, criadoEm: Date.now(),
      })
      terminar('guardado')
    }

    try {
      if (!navigator.onLine) {
        await guardar()
      } else {
        try {
          await enviarAtualizacao({
            reqId: req.id, titulo: req.titulo, valor, fornecedor,
            comprovante: form.foto, nomeArquivo: form.fotoNome, tecnico: nomeTecnico,
          })
          terminar(form.foto ? 'ok' : 'sem-comprovante')
        } catch (err) {
          if (erroDeRede(err)) await guardar()
          else setErro(`${(err as Error)?.message || 'Erro ao enviar.'} Seus dados continuam aqui — tente de novo.`)
        }
      }
    } catch (err) {
      setErro(`Não deu para guardar no celular: ${(err as Error)?.message || err}. Tente de novo.`)
    } finally {
      enviandoRef.current = false
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!req) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Voltar href="/requisicoes" />
      <div style={{ ...cartao, padding: 32, textAlign: 'center', color: T.textoFraco }}>
        {typeof navigator !== 'undefined' && !navigator.onLine
          ? 'Sem internet, e esta requisição não está guardada no celular. Abra de novo quando tiver sinal.'
          : 'Requisição não encontrada'}
      </div>
    </div>
  )

  if (sucesso) {
    return (
      <TelaSucesso
        icon={CheckCircle}
        titulo={sucesso === 'guardado' ? 'Salvo no celular' : 'Requisição atualizada'}
        texto={
          sucesso === 'guardado' ? 'Salvo no celular, vai quando tiver sinal. Não precisa fazer de novo.'
            : sucesso === 'sem-comprovante' ? 'Valor e fornecedor enviados. Falta a foto do comprovante — a requisição continua em Pendentes.'
              : 'Os dados foram enviados com sucesso.'
        }
        href="/requisicoes"
        botao="Voltar às requisições"
      />
    )
  }

  const fornecedoresFiltrados = fornecedores.filter((f) =>
    (f.nome || '').toLowerCase().includes(filtroFornecedor.toLowerCase())
  )

  const inputStyle: React.CSSProperties = campo

  const labelStyle: React.CSSProperties = rotulo

  const desligado = saving || preparandoFoto || !valorOk || !form.fornecedor.trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <EstiloCampos />
      <Voltar href="/requisicoes" />

      {/* Info da requisição — faixa laranja no topo: está esperando você atualizar */}
      <div style={{ ...cartao, padding: 0, overflow: 'hidden' }}>
        <div style={{ background: COR.pendente, color: '#fff', padding: '7px 14px', fontSize: 13, fontWeight: 500 }}>
          Requisição #{req.id}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}>
          <Icone icon={ClipboardList} cor={COR.pendente} cheio />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: T.texto, overflowWrap: 'anywhere' }}>{req.titulo}</div>
            <div style={{ fontSize: 13, color: T.textoMedio, marginTop: 3 }}>
              {req.tipo} · {dataBR(req.data)}
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ ...cartao, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icone icon={Receipt} cor={COR.principal} tam={36} />
          <div style={{ fontSize: 15, fontWeight: 500, color: T.texto }}>Atualizar dados</div>
        </div>

        {/* Valor — aceita 150,00 ou 150.00; arruma ao sair do campo */}
        <div>
          <label style={labelStyle}>Valor do serviço / material *</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: T.textoFraco, fontSize: 15, pointerEvents: 'none' }}>R$</span>
            <input
              className="rq-campo"
              type="text"
              value={form.valor}
              onChange={(e) => { const v = e.target.value.replace(/[^\d.,]/g, ''); setForm(prev => ({ ...prev, valor: v })) }}
              onBlur={() => { if (valorOk) setForm(prev => ({ ...prev, valor: moeda(valorNum) })) }}
              required
              placeholder="150,00"
              style={{ ...inputStyle, paddingLeft: 42 }}
              inputMode="decimal"
              autoComplete="off"
            />
          </div>
          {form.valor.trim() && !valorOk && (
            <div style={{ fontSize: 13, color: COR.erro, marginTop: 6 }}>Valor inválido — use, por exemplo, 150,00.</div>
          )}
        </div>

        {/* Fornecedor */}
        <div>
          <label style={labelStyle}>Fornecedor *</label>
          <div style={{ position: 'relative' }}>
            <input
              className="rq-campo"
              type="text"
              value={form.fornecedor}
              onChange={(e) => {
                const v = e.target.value
                setForm(prev => ({ ...prev, fornecedor: v }))
                setFiltroFornecedor(v)
                setShowFornecedores(true)
              }}
              onFocus={() => { setFiltroFornecedor(form.fornecedor); setShowFornecedores(true) }}
              required
              placeholder="Digite ou selecione o fornecedor..."
              style={inputStyle}
            />
            {showFornecedores && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                background: T.cartao, borderRadius: 12, marginTop: 4,
                boxShadow: '0 12px 28px -14px rgba(15,23,42,0.35)',
                maxHeight: 220, overflowY: 'auto',
                border: `1px solid ${T.borda}`,
              }}>
                {fornecedoresFiltrados.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 13, color: T.textoFraco, textAlign: 'center' }}>
                    Nenhum fornecedor encontrado — pode digitar o nome
                  </div>
                ) : fornecedoresFiltrados.slice(0, 10).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setForm(prev => ({ ...prev, fornecedor: f.nome }))
                      setShowFornecedores(false)
                    }}
                    style={{
                      width: '100%', padding: '10px 12px', border: 'none',
                      background: 'transparent', cursor: 'pointer',
                      textAlign: 'left', borderBottom: '1px solid #F1F5F9',
                      display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit',
                    }}
                  >
                    <Icone icon={Store} cor={COR.principal} tam={30} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: T.texto, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nome}</div>
                      {f.descricao && <div style={{ fontSize: 12, color: T.textoFraco, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.descricao}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Foto do comprovante (sai comprimida) */}
        <div>
          <label style={labelStyle}>Foto do comprovante</label>
          <label style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            background: form.fotoPreview ? T.cartao : T.fundo, borderRadius: 14, padding: form.fotoPreview ? 8 : 26,
            border: `1px dashed ${T.fantasma}`, cursor: 'pointer',
            textAlign: 'center', marginBottom: 0,
          }}>
            {preparandoFoto ? (
              <span style={{ fontSize: 14, color: T.textoMedio }}>Preparando a foto...</span>
            ) : form.fotoPreview ? (
              <img
                src={form.fotoPreview}
                alt="Comprovante"
                style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 10 }}
              />
            ) : (
              <>
                <Icone icon={Camera} cor={COR.principal} tam={44} />
                <span style={{ fontSize: 14, color: T.textoMedio }}>
                  Toque para tirar foto ou selecionar
                </span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={handleFoto}
              style={{ display: 'none' }}
            />
          </label>
          {!form.foto && !preparandoFoto && (
            <div style={{ fontSize: 13, color: COR.pendente, marginTop: 6 }}>
              Sem o comprovante a requisição continua pendente.
            </div>
          )}
          {form.fotoPreview && (
            <button
              type="button"
              onClick={() => setForm(prev => ({ ...prev, foto: null, fotoNome: '', fotoPreview: '' }))}
              style={{
                marginTop: 8, fontSize: 14, color: COR.erro, background: 'none',
                border: 'none', cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit',
              }}
            >
              Remover foto
            </button>
          )}
        </div>

        {erro && (
          <div role="alert" style={{ fontSize: 14, color: COR.erro, lineHeight: 1.45 }}>{erro}</div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={desligado}
          style={{ ...botaoPrincipal(desligado), minHeight: 50, fontSize: 16, marginTop: 4 }}
        >
          <CheckCircle size={18} />
          {saving ? 'Enviando...' : 'Confirmar atualização'}
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
