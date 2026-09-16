// Builds the publishable frontend update set for Ledgerly Phase 0.
// Reads dist/ (Vite output), stamps the service-worker cache version, and
// writes dist/manifest.json plus a detached dist/manifest.sig when
// LEDGERLY_UPDATE_KEY holds a base64-encoded Ed25519 private-key PEM.
// Never calls electron-builder: frontend releases ship no DMG.
//
// Publish layout on the static host:
//   <host>/manifest.json, <host>/manifest.sig,
//   <host>/<frontendVersion>/<path> for every listed file.
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dist = join(root, 'dist')

const readVersion = (file, pattern, label) => {
  const match = pattern.exec(readFileSync(file, 'utf8'))
  if (!match) throw new Error(`cannot read ${label} from ${file}`)
  return match[1]
}

const frontendVersion = readVersion(join(root, 'src', 'release.ts'), /FRONTEND_VERSION[^=]*=\s*'([^']+)'/, 'FRONTEND_VERSION')
const shellVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const dataSchemaVersion = Number(readVersion(join(root, 'src', 'persistence.ts'), /SCHEMA_VERSION\s*=\s*(\d+)/, 'SCHEMA_VERSION'))

// Stamp the service-worker cache name before hashing so the manifest covers it.
const swPath = join(dist, 'sw.js')
try {
  const sw = readFileSync(swPath, 'utf8')
  writeFileSync(swPath, sw.replace(/const LEDGERLY_FRONTEND = '[^']*'/, `const LEDGERLY_FRONTEND = '${frontendVersion}'`))
} catch {
  throw new Error('dist/sw.js missing — run npm run build first')
}

const walk = dir => readdirSync(dir).flatMap(entry => {
  const full = join(dir, entry)
  if (statSync(full).isDirectory()) return walk(full)
  const rel = relative(dist, full).split(sep).join('/')
  if (rel === 'manifest.json' || rel === 'manifest.sig' || rel === '.DS_Store') return []
  return [rel]
})

const files = walk(dist).sort().map(filePath => {
  const bytes = readFileSync(join(dist, filePath))
  return { path: filePath, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
})
if (!files.some(file => file.path === 'index.html')) {
  throw new Error('dist/index.html missing — refusing to publish an incomplete bundle')
}

const manifest = {
  manifestVersion: 1,
  frontendVersion,
  minShellVersion: shellVersion,
  dataSchemaVersion,
  publishedAt: new Date().toISOString(),
  releaseNotes: (process.env.LEDGERLY_RELEASE_NOTES || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean),
  security: process.env.LEDGERLY_SECURITY_RELEASE === '1',
  files,
}
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2))
writeFileSync(join(dist, 'manifest.json'), manifestBytes)

const key = (process.env.LEDGERLY_UPDATE_KEY || '').trim()
if (!key) {
  console.log(`frontend ${frontendVersion}: manifest.json written unsigned (set LEDGERLY_UPDATE_KEY to sign)`)
} else {
  const pem = key.includes('BEGIN') ? key : Buffer.from(key, 'base64').toString('utf8')
  const privateKey = createPrivateKey(pem)
  writeFileSync(join(dist, 'manifest.sig'), sign(null, manifestBytes, privateKey))
  console.log(`frontend ${frontendVersion}: manifest.json + manifest.sig written (${files.length} files)`)
}
