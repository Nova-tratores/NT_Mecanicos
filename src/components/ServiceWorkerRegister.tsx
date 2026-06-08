'use client';

import { useEffect } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function subscribePush(reg: ServiceWorkerRegistration, tecnicoNome: string) {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tecnico_nome: tecnicoNome,
        subscription: sub.toJSON(),
      }),
    });
  } catch (err) {
    console.warn('Push subscription failed:', err);
  }
}

export default function ServiceWorkerRegister() {
  const { user } = useCurrentUser();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update();
        setInterval(() => reg.update(), 60 * 60 * 1000);

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                console.log('[SW] Nova versão ativada. Será usada no próximo acesso.');
              }
            });
          }
        });

        if (user?.tecnico_nome && VAPID_PUBLIC_KEY) {
          const nome = user.nome_pos || user.tecnico_nome;
          subscribePush(reg, nome);
        }

        // Periodic Background Sync — atualiza dados mesmo com app fechado
        if ('periodicSync' in reg) {
          (reg as any).periodicSync.register('bg-prefetch', {
            minInterval: 2 * 60 * 60 * 1000, // a cada 2 horas
          }).catch(() => { /* browser pode negar */ });
        }
      })
      .catch((err) => {
        console.error('SW registration failed:', err);
      });
  }, [user]);

  return null;
}
