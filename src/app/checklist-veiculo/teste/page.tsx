'use client'
import { useState } from 'react'
import { colors } from '@/lib/ui'
import {
  Check, AlertCircle, Shield, Car, Clock, MapPin,
  Camera, Share2, FileText, ChevronRight,
} from 'lucide-react'
import Link from 'next/link'

const ITEMS = [
  { key: 'crlv', cat: 'Documentação', titulo: 'CRLV', desc: 'Fotografe o documento CRLV do veículo e verifique a validade' },
  { key: 'lataria_frente', cat: 'Exterior', titulo: 'Frente do veículo', desc: 'Fotografe a frente mostrando para-choque, capô e faróis' },
  { key: 'lataria_traseira', cat: 'Exterior', titulo: 'Traseira do veículo', desc: 'Fotografe a traseira mostrando lanternas e para-choque' },
  { key: 'lataria_esquerda', cat: 'Exterior', titulo: 'Lateral esquerda', desc: 'Fotografe toda a lateral esquerda' },
  { key: 'lataria_direita', cat: 'Exterior', titulo: 'Lateral direita', desc: 'Fotografe toda a lateral direita' },
  { key: 'pneu_de', cat: 'Pneus', titulo: 'Pneu dianteiro esquerdo', desc: 'Fotografe mostrando a banda de rodagem' },
  { key: 'pneu_dd', cat: 'Pneus', titulo: 'Pneu dianteiro direito', desc: 'Fotografe mostrando a banda de rodagem' },
  { key: 'pneu_te', cat: 'Pneus', titulo: 'Pneu traseiro esquerdo', desc: 'Fotografe mostrando a banda de rodagem' },
  { key: 'pneu_td', cat: 'Pneus', titulo: 'Pneu traseiro direito', desc: 'Fotografe mostrando a banda de rodagem' },
  { key: 'estepe', cat: 'Pneus', titulo: 'Estepe', desc: 'Fotografe o estepe e verifique estado e calibragem' },
  { key: 'parabrisa', cat: 'Exterior', titulo: 'Para-brisa e limpador', desc: 'Fotografe de dentro para fora mostrando trincas se houver' },
  { key: 'oleo_motor', cat: 'Motor', titulo: 'Nível de óleo', desc: 'Com motor frio, verifique a vareta e fotografe' },
  { key: 'arrefecimento', cat: 'Motor', titulo: 'Fluido de arrefecimento', desc: 'Fotografe o reservatório mostrando o nível' },
  { key: 'bateria', cat: 'Motor', titulo: 'Bateria', desc: 'Fotografe mostrando terminais e fixação' },
  { key: 'painel', cat: 'Interior', titulo: 'Painel de instrumentos', desc: 'Ligue o veículo e fotografe o painel (luzes de alerta)' },
  { key: 'hodometro', cat: 'Interior', titulo: 'Hodômetro', desc: 'Fotografe mostrando a quilometragem atual' },
  { key: 'limpeza_interna', cat: 'Interior', titulo: 'Limpeza interna', desc: 'Fotografe o interior (bancos, tapetes, porta-objetos)' },
  { key: 'extintor', cat: 'Segurança', titulo: 'Extintor de incêndio', desc: 'Fotografe mostrando a etiqueta de validade' },
  { key: 'triangulo', cat: 'Segurança', titulo: 'Triângulo de segurança', desc: 'Fotografe o triângulo' },
  { key: 'macaco_chave', cat: 'Segurança', titulo: 'Macaco e chave de roda', desc: 'Fotografe o macaco e a chave de roda' },
]

const MOCK_ITENS = ITEMS.map((item, i) => ({
  item_key: item.key,
  categoria: item.cat,
  titulo: item.titulo,
  resposta: i === 3 || i === 9 ? 'problema' : 'ok',
  observacao: i === 3 ? 'Amassado no para-lama traseiro esquerdo' : i === 9 ? 'Estepe careca, precisa trocar' : '',
  foto_url: null as string | null,
  respondido_em: new Date(Date.now() - (ITEMS.length - i) * 45000).toISOString(),
}))

const MOCK_CHECKLIST = {
  id: 'teste-123',
  tecnico_nome: 'João Silva',
  placa: 'VW SAVEIRO ROBUST - TKY6E68',
  mes_referencia: '2026-07',
  status: 'completo',
  inicio_em: new Date(Date.now() - 22 * 60000).toISOString(),
  fim_em: new Date().toISOString(),
  duracao_total_seg: 22 * 60,
  score_confianca: 72,
  alertas: [
    'Todos os itens marcados como OK (nenhum problema reportado)',
    'Nenhuma observação em nenhum item',
  ],
  loc_inicio: { lat: -22.9068, lng: -43.1729 },
  loc_fim: { lat: -22.9072, lng: -43.1733 },
}

type View = 'resultado' | 'itens' | 'wizard'

export default function ChecklistTestePage() {
  const [view, setView] = useState<View>('resultado')
  const [fotoAberta, setFotoAberta] = useState<string | null>(null)
  const [wizardStep, setWizardStep] = useState(-1)
  const [wizardFoto, setWizardFoto] = useState<string | null>(null)
  const [wizardResp, setWizardResp] = useState('')
  const [wizardObs, setWizardObs] = useState('')

  const checklist = MOCK_CHECKLIST
  const itens = MOCK_ITENS
  const score = checklist.score_confianca
  const scoreColor = score >= 70 ? colors.success : score >= 50 ? colors.warning : colors.danger
  const scoreLabel = score >= 70 ? 'Confiável' : score >= 50 ? 'Atenção' : 'Suspeito'
  const durMin = Math.floor(checklist.duracao_total_seg / 60)
  const durSeg = checklist.duracao_total_seg % 60
  const alertas = checklist.alertas
  const itensMap = new Map(itens.map(i => [i.item_key, i]))
  const categorias = [...new Set(ITEMS.map(i => i.cat))]
  const problemas = itens.filter(i => i.resposta === 'problema').length
  const respondidos = itens.filter(i => i.resposta).length

  // --- WIZARD VIEW (simula o preenchimento de cada item) ---
  if (view === 'wizard') {
    if (wizardStep === -1) {
      return (
        <div style={{ maxWidth: 480, margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <button onClick={() => setView('resultado')} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: colors.textMuted,
            display: 'flex', alignItems: 'center', gap: 4, padding: 0,
          }}>
            ← Voltar ao resultado
          </button>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%', margin: '0 auto 16px',
              background: colors.primaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Shield size={36} color={colors.primary} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: colors.text }}>Checklist do Veículo</div>
            <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>Julho 2026</div>
          </div>
          <div style={{
            background: colors.surfaceAlt, borderRadius: 16, padding: 16,
            border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Car size={24} color={colors.primary} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>VW SAVEIRO ROBUST</div>
              <div style={{ fontSize: 12, color: colors.textMuted }}>TKY6E68</div>
            </div>
          </div>
          <div style={{
            background: colors.surfaceAlt, borderRadius: 16, padding: 16,
            border: `1px solid ${colors.border}`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 8 }}>Como funciona:</div>
            <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.8 }}>
              • São 20 itens para inspecionar{'\n'}
              • Cada item exige uma foto{'\n'}
              • Marque como OK ou Problema{'\n'}
              • Adicione observações quando necessário{'\n'}
              • Tempo estimado: 15-20 minutos
            </div>
          </div>
          <button onClick={() => setWizardStep(0)} style={{
            width: '100%', padding: '14px 20px', borderRadius: 14,
            background: colors.primary, color: '#fff', border: 'none',
            fontSize: 16, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Camera size={20} /> Iniciar Checklist
          </button>
        </div>
      )
    }

    // Summary
    if (wizardStep >= ITEMS.length) {
      return (
        <div style={{ maxWidth: 480, margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Resumo</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: 'Respondidos', value: respondidos, color: colors.success },
              { label: 'Problemas', value: problemas, color: colors.danger },
              { label: 'Faltam', value: 0, color: colors.warning },
            ].map(s => (
              <div key={s.label} style={{
                background: colors.surfaceAlt, borderRadius: 12, padding: 14, textAlign: 'center',
                border: `1px solid ${colors.border}`,
              }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ITEMS.map((item, i) => {
              const saved = itensMap.get(item.key)
              return (
                <button key={item.key} onClick={() => setWizardStep(i)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 10, border: `1px solid ${colors.border}`,
                  background: saved ? colors.surface : colors.warningBg,
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: saved ? (saved.resposta === 'ok' ? colors.successBg : colors.dangerBg) : colors.warningBg,
                  }}>
                    {saved ? (
                      saved.resposta === 'ok'
                        ? <Check size={14} color={colors.success} />
                        : <AlertCircle size={14} color={colors.danger} />
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: colors.warning }}>{i + 1}</span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: colors.text, flex: 1 }}>{item.titulo}</span>
                  <ChevronRight size={14} color={colors.textSubtle} />
                </button>
              )
            })}
          </div>
          <button onClick={() => setView('resultado')} style={{
            width: '100%', padding: '14px 20px', borderRadius: 14,
            background: colors.success, color: '#fff', border: 'none',
            fontSize: 16, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Check size={20} /> Concluir Checklist
          </button>
        </div>
      )
    }

    // Item step
    const item = ITEMS[wizardStep]
    const progresso = Math.round(((wizardStep + 1) / ITEMS.length) * 100)

    return (
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button onClick={() => wizardStep > 0 ? setWizardStep(wizardStep - 1) : setWizardStep(-1)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 13, color: colors.textMuted,
            }}>
              ← {wizardStep > 0 ? 'Anterior' : 'Voltar'}
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle }}>{wizardStep + 1} / {ITEMS.length}</span>
            <button onClick={() => setWizardStep(ITEMS.length)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              fontSize: 13, color: colors.primary, fontWeight: 600,
            }}>
              Resumo
            </button>
          </div>
          <div style={{ height: 4, background: colors.border, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progresso}%`, background: colors.primary, borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
        </div>

        <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
          <div>
            <span style={{
              fontSize: 10, fontWeight: 700, color: colors.primary, background: colors.primaryBg,
              padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: 0.5,
            }}>{item.cat}</span>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>{item.titulo}</div>
            <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 1.5 }}>{item.desc}</div>
          </div>

          {wizardFoto ? (
            <div style={{ position: 'relative' }}>
              <div style={{
                width: '100%', height: 200, borderRadius: 16, background: '#e5e7eb',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `2px solid ${colors.border}`,
              }}>
                <Camera size={40} color={colors.textMuted} />
              </div>
              <button onClick={() => setWizardFoto('sim')} style={{
                position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,0.6)',
                color: '#fff', border: 'none', borderRadius: 10, padding: '6px 12px',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Camera size={12} /> Refazer
              </button>
            </div>
          ) : (
            <button onClick={() => setWizardFoto('sim')} style={{
              width: '100%', padding: '40px 20px', borderRadius: 16,
              border: `2px dashed ${colors.border}`, background: colors.surfaceAlt,
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}>
              <Camera size={32} color={colors.textMuted} />
              <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Tirar foto</span>
              <span style={{ fontSize: 11, color: colors.textMuted }}>Obrigatório</span>
            </button>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, marginBottom: 8 }}>Estado:</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                { val: 'ok', label: 'OK', icon: <Check size={18} />, bg: colors.successBg, clr: colors.success, bdr: '#BBF7D0' },
                { val: 'problema', label: 'Problema', icon: <AlertCircle size={18} />, bg: colors.dangerBg, clr: colors.danger, bdr: '#FECACA' },
              ].map(r => (
                <button key={r.val} onClick={() => setWizardResp(r.val)} style={{
                  flex: 1, padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  border: wizardResp === r.val ? `2px solid ${r.clr}` : `1px solid ${colors.border}`,
                  background: wizardResp === r.val ? r.bg : colors.surface,
                  fontSize: 14, fontWeight: 600, color: wizardResp === r.val ? r.clr : colors.textMuted,
                }}>
                  {r.icon} {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, marginBottom: 8 }}>
              Observação {wizardResp === 'problema' ? '' : '(opcional)'}:
            </div>
            <textarea
              value={wizardObs}
              onChange={e => setWizardObs(e.target.value)}
              placeholder="Descreva o estado ou problema encontrado..."
              rows={3}
              style={{
                width: '100%', padding: 12, borderRadius: 12, border: `1px solid ${colors.border}`,
                background: colors.surfaceAlt, fontSize: 13, color: colors.text, resize: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.border}`, flexShrink: 0 }}>
          <button
            onClick={() => {
              setWizardFoto(null); setWizardResp(''); setWizardObs('')
              setWizardStep(wizardStep + 1)
            }}
            disabled={!wizardFoto || !wizardResp}
            style={{
              width: '100%', padding: '14px 20px', borderRadius: 14,
              background: (wizardFoto && wizardResp) ? colors.primary : colors.border,
              color: (wizardFoto && wizardResp) ? '#fff' : colors.textMuted,
              border: 'none', fontSize: 15, fontWeight: 700,
              cursor: (wizardFoto && wizardResp) ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {wizardStep < ITEMS.length - 1 ? (
              <>Próximo <ChevronRight size={18} /></>
            ) : (
              <>Ver Resumo <Check size={18} /></>
            )}
          </button>
        </div>
      </div>
    )
  }

  // --- ITENS VIEW (relatório completo) ---
  if (view === 'itens') {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <button onClick={() => setView('resultado')} style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: colors.textMuted,
          display: 'flex', alignItems: 'center', gap: 4, padding: 0,
        }}>
          ← Voltar ao resultado
        </button>

        {categorias.map(cat => {
          const catItems = ITEMS.filter(i => i.cat === cat)
          return (
            <div key={cat}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: colors.textSubtle,
                textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
              }}>
                {cat}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {catItems.map(item => {
                  const saved = itensMap.get(item.key)
                  const isOk = saved?.resposta === 'ok'
                  const isProblema = saved?.resposta === 'problema'
                  return (
                    <div key={item.key} style={{
                      background: colors.surfaceAlt, borderRadius: 12,
                      border: `1px solid ${isProblema ? colors.dangerBorder : colors.border}`,
                      padding: 12,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                          background: isOk ? colors.successBg : isProblema ? colors.dangerBg : colors.border,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isOk ? <Check size={14} color={colors.success} /> : isProblema ? <AlertCircle size={14} color={colors.danger} /> : null}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, flex: 1 }}>{item.titulo}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: isOk ? colors.success : colors.danger,
                          padding: '2px 6px', borderRadius: 4,
                          background: isOk ? colors.successBg : colors.dangerBg,
                        }}>
                          {isOk ? 'OK' : 'PROBLEMA'}
                        </span>
                      </div>
                      {saved?.observacao && (
                        <div style={{
                          fontSize: 12, color: colors.textMuted, marginTop: 8,
                          padding: '6px 8px', background: colors.surface, borderRadius: 6,
                        }}>
                          {saved.observacao}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // --- RESULTADO VIEW (tela principal) ---
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', background: colors.surface, minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', background: colors.primary, color: '#fff',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <Shield size={24} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Checklist do Veículo</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Julho 2026</div>
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '4px 10px',
          fontSize: 12, fontWeight: 700,
        }}>
          Concluído
        </div>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Info cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{
            background: colors.surfaceAlt, borderRadius: 12, padding: 14,
            border: `1px solid ${colors.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Car size={14} color={colors.primary} />
              <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600 }}>VEÍCULO</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{checklist.placa}</div>
          </div>
          <div style={{
            background: colors.surfaceAlt, borderRadius: 12, padding: 14,
            border: `1px solid ${colors.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Clock size={14} color={colors.primary} />
              <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600 }}>DURAÇÃO</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{durMin}min {durSeg}s</div>
          </div>
        </div>

        {/* Técnico */}
        <div style={{
          background: colors.surfaceAlt, borderRadius: 12, padding: 14,
          border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: colors.primaryBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileText size={18} color={colors.primary} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{checklist.tecnico_nome}</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>
              {new Date(checklist.fim_em).toLocaleString('pt-BR')}
            </div>
          </div>
        </div>

        {/* Score */}
        <div style={{
          background: colors.surfaceAlt, borderRadius: 16, padding: 20,
          border: `1px solid ${colors.border}`, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, marginBottom: 8, letterSpacing: 0.5 }}>
            ÍNDICE DE CONFIANÇA
          </div>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', margin: '0 auto 12px',
            background: scoreColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{score}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: scoreColor }}>{scoreLabel}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.success }}>{respondidos}</div>
              <div style={{ fontSize: 10, color: colors.textMuted }}>Respondidos</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.danger }}>{problemas}</div>
              <div style={{ fontSize: 10, color: colors.textMuted }}>Problemas</div>
            </div>
          </div>
        </div>

        {/* Alertas */}
        {alertas.length > 0 && (
          <div style={{
            background: colors.warningBg, borderRadius: 12, padding: 14,
            border: `1px solid ${colors.warningBorder}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.warning, marginBottom: 8 }}>
              Alertas da Análise
            </div>
            {alertas.map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: colors.text, padding: '3px 0', display: 'flex', gap: 6 }}>
                <AlertCircle size={13} color={colors.warning} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{a}</span>
              </div>
            ))}
          </div>
        )}

        {/* GPS info */}
        <div style={{
          background: colors.surfaceAlt, borderRadius: 12, padding: 14,
          border: `1px solid ${colors.border}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, marginBottom: 8, letterSpacing: 0.5 }}>
            LOCALIZAÇÃO
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: colors.textMuted }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={12} color={colors.success} />
              Início: {checklist.loc_inicio.lat.toFixed(4)}, {checklist.loc_inicio.lng.toFixed(4)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={12} color={colors.danger} />
              Fim: {checklist.loc_fim.lat.toFixed(4)}, {checklist.loc_fim.lng.toFixed(4)}
            </div>
          </div>
        </div>

        {/* Navigation buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setView('itens')} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 14, border: `1px solid ${colors.border}`,
            background: colors.surface, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: colors.text,
          }}>
            <FileText size={16} /> Ver Itens
          </button>
          <button onClick={() => setView('wizard')} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 14, border: `1px solid ${colors.border}`,
            background: colors.surface, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: colors.text,
          }}>
            <Camera size={16} /> Ver Wizard
          </button>
        </div>

        <button onClick={() => alert('Link copiado!')} style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '12px 16px', borderRadius: 14,
          background: colors.primary, color: '#fff', border: 'none',
          cursor: 'pointer', fontSize: 14, fontWeight: 600,
        }}>
          <Share2 size={16} /> Compartilhar
        </button>

        <Link href="/" style={{
          display: 'block', textAlign: 'center', padding: '10px 0',
          fontSize: 13, color: colors.textMuted, textDecoration: 'none',
        }}>
          ← Voltar para início
        </Link>
      </div>
    </div>
  )
}
