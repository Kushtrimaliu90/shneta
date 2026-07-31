import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SHNETA — Suplemente dhe Wellness',
    short_name: 'SHNETA',
    description: 'Suplemente origjinale dhe njohuri për shëndetin.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FAF9F5',
    theme_color: '#FAF9F5',
    lang: 'sq',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
