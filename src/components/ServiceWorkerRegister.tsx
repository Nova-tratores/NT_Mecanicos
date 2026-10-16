'use client';

import { useEffect } from 'react';

// A inscricao de notificacoes fica no PushPermissionBanner (layout do tecnico)
// e no AdminLayoutInner. Aqui NAO usamos useCurrentUser: este componente roda
// em todas as paginas e o hook redireciona admin para /admin.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Em DESENVOLVIMENTO o service worker so atrapalha: ele cacheia o bundle e
    // faz o app "voltar" para a versao antiga toda hora. Entao, no dev, em vez de
    // registrar, desregistramos qualquer SW existente e limpamos os caches.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      if ('caches' in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      }
      return;
    }

    // A versao nova e baixada em segundo plano e passa a valer na proxima vez
    // que o app abrir. Nao recarregamos a tela no meio do uso (o tecnico pode
    // estar preenchendo uma OS).
    let intervalo: ReturnType<typeof setInterval> | undefined;
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        intervalo = setInterval(() => { if (navigator.onLine) reg.update().catch(() => {}); }, 60 * 60 * 1000);

        // Periodic Background Sync — atualiza dados mesmo com app fechado (Android)
        if ('periodicSync' in reg) {
          (reg as unknown as { periodicSync: { register: (tag: string, o: object) => Promise<void> } })
            .periodicSync.register('bg-prefetch', { minInterval: 2 * 60 * 60 * 1000 })
            .catch(() => { /* browser pode negar */ });
        }
      })
      .catch((err) => {
        console.error('SW registration failed:', err);
      });

    return () => { if (intervalo) clearInterval(intervalo); };
  }, []);

  return null;
}
