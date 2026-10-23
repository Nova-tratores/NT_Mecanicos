'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { instalarAuthFetch } from '@/lib/apiFetch';
import { inscreverPush } from '@/lib/push-cliente';

// token do login em todo fetch para /api do app (José, 23/10/2026) — este componente monta em todas as telas
instalarAuthFetch();

/** há algo sendo digitado/assinado? (não recarrega por cima) */
function formularioAberto() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

// Atualização do app (José, 23/10/2026): o service worker novo fica ESPERANDO; aparece a faixa
// "Atualização pronta · Atualizar" e só recarrega no toque — ou sozinho na tela inicial sem nada digitando.
// Antes recarregava no meio do relatório/assinatura.
export default function ServiceWorkerRegister() {
  const { user } = useCurrentUser();
  const pathname = usePathname();
  const [esperando, setEsperando] = useState<ServiceWorker | null>(null);
  const aplicando = useRef(false);
  const pushNome = user?.nome_pos || user?.tecnico_nome || '';

  // registro do SW: uma vez só (deps estáveis; antes rodava a cada troca de usuário e acumulava setInterval)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Em DESENVOLVIMENTO o service worker so atrapalha: desregistra e limpa os caches.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      if ('caches' in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      }
      return;
    }

    // Safari apaga dados de site sem uso em 7 dias: pede armazenamento persistente (fila offline) (José, 23/10/2026)
    try {
      if (navigator.storage?.persist && !localStorage.getItem('nt-storage-persist')) {
        navigator.storage.persist().then((ok) => { try { localStorage.setItem('nt-storage-persist', ok ? '1' : '0') } catch { /* */ } }).catch(() => {});
      }
    } catch { /* sem localStorage */ }

    // recarrega só quando NÓS mandamos o SW novo assumir (toque em "Atualizar")
    const onControllerChange = () => {
      if (!aplicando.current) return;
      aplicando.current = false;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    let timer: ReturnType<typeof setInterval> | null = null;
    let vivo = true;

    const vigiar = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setEsperando(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const novo = reg.installing;
        if (!novo) return;
        novo.addEventListener('statechange', () => {
          // 'installed' com controller = versão nova esperando (no 1º registro não tem controller)
          if (novo.state === 'installed' && navigator.serviceWorker.controller && vivo) setEsperando(reg.waiting || novo);
        });
      });
    };

    const onVisivel = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.serviceWorker.getRegistration().then((reg) => reg?.update().catch(() => {})).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisivel);

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (!vivo) return;
        vigiar(reg);
        reg.update().catch(() => {}); // ainda instalando = "invalid state": a próxima atualização pega
        timer = setInterval(() => { reg.update().catch(() => {}) }, 60 * 60 * 1000);

        // Periodic Background Sync — atualiza dados mesmo com app fechado (Android/Chrome instalado)
        if ('periodicSync' in reg) {
          (reg as unknown as { periodicSync: { register: (t: string, o: object) => Promise<void> } }).periodicSync
            .register('bg-prefetch', { minInterval: 2 * 60 * 60 * 1000 })
            .catch(() => { /* browser pode negar */ });
        }
      })
      .catch((err) => {
        console.error('SW registration failed:', err);
      });

    return () => {
      vivo = false;
      if (timer) clearInterval(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisivel);
    };
  }, []);

  // push: só inscreve se a permissão JÁ foi dada (o pedido fica no toque — NotificacaoObrigatoria/faixa)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !pushNome || pushNome === 'Usuário') return;
    void inscreverPush(pushNome);
  }, [pushNome]);

  const atualizar = () => {
    if (!esperando) { window.location.reload(); return; }
    aplicando.current = true;
    esperando.postMessage({ type: 'SKIP_WAITING' });
    // se o controllerchange não vier (SW antigo sem a mensagem), recarrega mesmo assim
    setTimeout(() => { if (aplicando.current) window.location.reload(); }, 3000);
  };

  // na tela inicial, sem nada sendo digitado, aplica sozinho
  useEffect(() => {
    if (!esperando || pathname !== '/') return;
    const t = setTimeout(() => { if (!formularioAberto() && document.visibilityState === 'visible') atualizar(); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esperando, pathname]);

  if (!esperando) return null;
  return (
    <div role="status" style={{
      position: 'fixed', left: 16, right: 16, zIndex: 9000,
      bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))',
      maxWidth: 420, margin: '0 auto',
      background: '#FEFEFE', border: '1px solid #E2E8F0', borderRadius: 16,
      boxShadow: '0 12px 32px -12px rgba(15,23,42,0.35)',
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px 10px 16px',
    }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, color: '#0F172A' }}>Atualização pronta</span>
      <button type="button" onClick={atualizar} style={{
        minHeight: 40, padding: '0 16px', borderRadius: 12, border: 'none',
        background: '#1E3A5F', color: '#FEFEFE', fontSize: 14.5, cursor: 'pointer',
      }}>Atualizar</button>
    </div>
  );
}
