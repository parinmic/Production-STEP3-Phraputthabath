import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PPTB Production',
    short_name: 'PPTB',
    description: 'ระบบจัดการการผลิต PPTB',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f9fafb',
    theme_color: '#1f2937',
    icons: [
      { src: '/icon.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon.png', sizes: 'any', type: 'image/png', purpose: 'any maskable' },
    ],
  }
}
