// Robôs do servidor do app (José, 22/10/2026): push que faz o celular do técnico baixar as OS sozinho.
//  - vigia de OS nova/alterada a cada 5 min;  - "bom dia" às 6h30 de segunda a sábado.
// Só em produção. Desliga com PUSH_VIGIA=off.
// Fica num arquivo separado: o instrumentation.ts só o importa no runtime nodejs, senão o webpack tenta
// empacotar o web-push (http/https) para o edge e o dev quebra com "Can't resolve 'http'" (José, 23/10/2026).
import { vigiarOS, pushDaManha } from './lib/vigia-os-push'
// Opa sem resolver (−3/−5) e sino de OS nova: saíram do celular e rodam aqui (José, 23/10/2026)
import { escalarOpas, avisarOsNovas } from './lib/robos-servidor'

export function ligarRobos() {
  if (process.env.NODE_ENV !== 'production' || process.env.PUSH_VIGIA === 'off') return
  let rodando = false
  const rodar = async () => {
    if (rodando) return
    rodando = true
    try { const r = await vigiarOS(); if (r) console.log('[push]', r) } catch (e) { console.warn('[push] vigia falhou:', e instanceof Error ? e.message : e) }
    try { const r = await pushDaManha(); if (r) console.log('[push]', r) } catch (e) { console.warn('[push] manhã falhou:', e instanceof Error ? e.message : e) }
    try { const r = await escalarOpas(); if (r) console.log('[robô]', r) } catch (e) { console.warn('[robô] opa falhou:', e instanceof Error ? e.message : e) }
    try { const r = await avisarOsNovas(); if (r) console.log('[robô]', r) } catch (e) { console.warn('[robô] OS nova falhou:', e instanceof Error ? e.message : e) }
    rodando = false
  }
  setTimeout(() => { void rodar() }, 30_000)
  setInterval(() => { void rodar() }, 5 * 60_000)
  console.log('[push] vigia de OS ligado (5 min) + bom dia às 6h30')
}
