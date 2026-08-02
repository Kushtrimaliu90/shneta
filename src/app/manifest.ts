import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BIOCODE — Suplemente dhe Wellness',
    short_name: 'BIOCODE',
    description: 'Suplemente origjinale dhe njohuri për shëndetin.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F9FA',
    theme_color: '#0D1620',
    lang: 'sq',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
