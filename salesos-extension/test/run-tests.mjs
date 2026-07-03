import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const outDir = resolve(__dirname, '.out')

const fixtures = {
  __FIXTURE_SEARCH__: await readFile(resolve(__dirname, 'fixtures/fixture_search.html'), 'utf8'),
  __FIXTURE_FOLLOWERS__: await readFile(resolve(__dirname, 'fixtures/fixture_followers.html'), 'utf8'),
  __FIXTURE_PROFILE__: await readFile(resolve(__dirname, 'fixtures/fixture_profile.html'), 'utf8'),
}

function findBrowserExecutable() {
  const envPath = process.env.CHROME_PATH
  if (envPath && existsSync(envPath)) return envPath

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ]

  return candidates.find(executable => existsSync(executable))
}

async function main() {
  const browserPath = findBrowserExecutable()
  if (!browserPath) {
    throw new Error('Chrome または Edge の実行ファイルを見つけられませんでした')
  }

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const bundlePath = resolve(outDir, 'xExtract.test.js')
  const runnerPath = resolve(outDir, 'runner.html')

  await build({
    entryPoints: [resolve(__dirname, 'xExtract.test.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: bundlePath,
    define: Object.fromEntries(
      Object.entries(fixtures).map(([key, value]) => [key, JSON.stringify(value)]),
    ),
    logLevel: 'silent',
  })

  await writeFile(
    runnerPath,
    `<!doctype html><html><body><script src="${pathToFileURL(bundlePath).href}"></script></body></html>`,
    'utf8',
  )

  const runnerUrl = pathToFileURL(runnerPath).href
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--allow-file-access-from-files',
    '--dump-dom',
    runnerUrl,
  ]

  const output = await new Promise((resolveOutput, reject) => {
    const child = spawn(browserPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || `browser exited with code ${code}`))
        return
      }
      resolveOutput(stdout)
    })
  })

  const text = String(output)
  if (!text.includes('TEST_PASS')) {
    const match = text.match(/TEST_FAIL[\s\S]*?<\/pre>/)
    throw new Error(match ? match[0].replace(/<\/?pre>/g, '').trim() : 'xExtract tests failed')
  }

  const summary = text.match(/TEST_PASS[\s\S]*?<\/pre>/)?.[0].replace(/<\/?pre>/g, '').trim() ?? 'TEST_PASS'
  console.log(summary)
}

await main()
