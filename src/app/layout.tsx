import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "NT Mecânicos",
  description: "App de campo para técnicos da Nova Tratores",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "NT Mecânicos" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#C41E2A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* Trava de emergencia: subir SW_VERSION apaga os caches e o service worker
            de todos os celulares na proxima abertura com internet (dados offline do
            IndexedDB NAO sao apagados). Atualizacao normal nao precisa disso: o
            /sw.js muda sozinho a cada deploy. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var SW_VERSION = 'v28';
            var key = 'sw_ver';
            try {
              var stored = localStorage.getItem(key);
              if (stored !== SW_VERSION && 'serviceWorker' in navigator) {
                localStorage.setItem(key, SW_VERSION);
                caches.keys().then(function(ks){ ks.forEach(function(k){ caches.delete(k); }); });
                navigator.serviceWorker.getRegistrations().then(function(regs){
                  regs.forEach(function(r){ r.unregister(); });
                  if (stored) setTimeout(function(){ location.reload(); }, 500);
                });
              }
            } catch(e){}
          })();
        `}} />
      </head>
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
