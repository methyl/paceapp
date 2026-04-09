import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'

// Hash the source files that affect how FIT data is parsed and stored.
// When any of these change, the IndexedDB cache is automatically wiped.
const CACHE_SOURCES = [
  'src/parseFit.ts',
  'src/segmenter.ts',
  'src/detectWorkout.ts',
  'src/labeller.ts',
  'src/types.ts',
]

function computeCacheVersion(): number {
  const hash = createHash('md5')
  for (const file of CACHE_SOURCES) {
    try {
      hash.update(readFileSync(file))
    } catch {
      // file might not exist during initial setup
    }
  }
  // Use first 4 bytes as a positive integer for IndexedDB version
  const buf = hash.digest()
  return ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0
}

export default defineConfig({
  base: '/paceapp/',
  plugins: [react(), tailwindcss()],
  define: {
    __CACHE_VERSION__: computeCacheVersion(),
  },
})
