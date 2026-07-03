import { mkdir, rm, cp } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outdir = resolve(__dirname, 'dist')
const tsconfig = resolve(__dirname, 'tsconfig.json')

const entryPoints = {
  background: resolve(__dirname, 'src/background.ts'),
  'content/x': resolve(__dirname, 'src/content/x.ts'),
  'content/divizero': resolve(__dirname, 'src/content/divizero.ts'),
  'content/gemini': resolve(__dirname, 'src/content/gemini.ts'),
  'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
}

async function main() {
  await rm(outdir, { recursive: true, force: true })
  await mkdir(resolve(outdir, 'popup'), { recursive: true })

  await build({
    entryPoints,
    outdir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    tsconfig,
    sourcemap: false,
    logLevel: 'info',
  })

  await cp(resolve(__dirname, 'manifest.json'), resolve(outdir, 'manifest.json'))
  await cp(resolve(__dirname, 'src/popup/popup.html'), resolve(outdir, 'popup/popup.html'))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
