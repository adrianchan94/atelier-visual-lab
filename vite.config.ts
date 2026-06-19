import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import glsl from 'vite-plugin-glsl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Import .glsl/.vert/.frag as strings, with #include support (lygia-style).
    glsl(),
  ],
})
