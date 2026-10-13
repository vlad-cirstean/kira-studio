import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://vlad-cirstean.github.io',
  base: '/kira-studio',
  trailingSlash: 'ignore',
  output: 'static',
  vite: { plugins: [tailwindcss()] },
});
