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
  themeColor: "#C41E2A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="apple-touch-icon" href="/Logo_Nova.png" />
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var SW_VERSION = 'v17';
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
