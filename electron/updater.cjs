// Ledgerly local frontend updater (Electron main-process side).
// Pure Node.js: no Electron imports here so the whole flow is unit-testable.
// main.cjs wires real app paths; tests inject temp dirs and stub fetch.
//
// Layout under <userData>/updates/:
//   active.json   { version }            currently known-good frontend
//   pending.json  { version }            staged + committed, awaiting healthy boot
//   failure.json  { version, reason, at }
//   <version>/    verified bundle dir (contains index.html + .complete marker)
//   .staging/<version>/                 in-progress download (safe to delete)
//
// Frontend bundles are published at <host>/<frontendVersion>/<path> with a
// signed manifest.json + detached manifest.sig next to them.

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const MANIFEST_VERSION = 1
const DATA_SCHEMA_VERSION = 1 // must match SCHEMA_VERSION in src/persistence.ts
const CHECK_TIMEOUT_MS = 8000
const BOOT_TIMEOUT_MS = 30000
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_TOTAL_BYTES = 60 * 1024 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function compareVersions(a, b) {
  const pa = String(a || '').split('.').map(Number)
  const pb = String(b || '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0
    const y = Number.isFinite(pb[i]) ? pb[i] : 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function isSafeRelPath(p) {
  if (typeof p !== 'string' || !p || p.length > 256) return false
  if (p.includes('\\') || p.includes('\0')) return false
  if (p.startsWith('/') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return false
  const normalized = path.posix.normalize(p)
  if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) return false
  return normalized.split('/').every(part => part && part !== '.' && part !== '..')
}

function referencedAssets(indexHtml) {
  const refs = new Set()
  const pattern = /(?:src|href)="([^"]+)"/g
  let match
  while ((match = pattern.exec(indexHtml)) !== null) {
    let ref = match[1].split('#')[0].split('?')[0]
    if (!ref || ref.startsWith('data:') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) || ref.startsWith('/')) continue
    if (ref.startsWith('./')) ref = ref.slice(2)
    if (isSafeRelPath(ref)) refs.add(ref)
  }
  return [...refs]
}

function createUpdater({ userDataPath, shellVersion, fetchImpl, allowInsecureLocalhost = false }) {
  const updatesDir = () => path.join(userDataPath, 'updates')
  const stagingDir = version => path.join(updatesDir(), '.staging', version)
  const versionDir = version => path.join(updatesDir(), version)
  const activeFile = () => path.join(updatesDir(), 'active.json')
  const pendingFile = () => path.join(updatesDir(), 'pending.json')
  const failureFile = () => path.join(updatesDir(), 'failure.json')

  const readJson = file => {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'))
      return value && typeof value === 'object' ? value : null
    } catch {
      return null
    }
  }

  const readState = () => ({
    active: readJson(activeFile())?.version || null,
    pending: readJson(pendingFile())?.version || null,
    failure: readJson(failureFile()),
  })

  const bundleComplete = dir => {
    try {
      return fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, '.complete'))
    } catch {
      return false
    }
  }

  // Pending first (must prove healthy boot), then active, then packaged fallback.
  const resolveRoot = packagedDistDir => {
    const state = readState()
    if (state.pending && bundleComplete(versionDir(state.pending))) {
      return { root: versionDir(state.pending), version: state.pending, kind: 'pending' }
    }
    if (state.active && bundleComplete(versionDir(state.active))) {
      return { root: versionDir(state.active), version: state.active, kind: 'active' }
    }
    return { root: packagedDistDir, version: null, kind: 'packaged' }
  }

  const checkHost = host => {
    try {
      const url = new URL(host)
      if (url.protocol === 'https:') return true
      if (allowInsecureLocalhost && url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) return true
      return false
    } catch {
      return false
    }
  }

  const fetchWithTimeout = async url => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
    try {
      const response = await fetchImpl(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`http ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } finally {
      clearTimeout(timer)
    }
  }

  const verifyManifest = (manifestBytes, sigBytes, publicKeyBase64) => {
    try {
      const key = crypto.createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' })
      return crypto.verify(null, manifestBytes, key, sigBytes)
    } catch {
      return false
    }
  }

  const checkForUpdate = async ({ host, publicKey, current }) => {
    if (!host || !publicKey) return { status: 'disabled', reason: 'unconfigured' }
    if (!checkHost(host)) return { status: 'failed', reason: 'host' }
    let manifestBytes, sigBytes
    try {
      const base = host.replace(/\/$/, '')
      ;[manifestBytes, sigBytes] = await Promise.all([
        fetchWithTimeout(`${base}/manifest.json`),
        fetchWithTimeout(`${base}/manifest.sig`),
      ])
    } catch {
      return { status: 'failed', reason: 'network' }
    }
    if (!verifyManifest(manifestBytes, sigBytes, publicKey)) return { status: 'failed', reason: 'signature' }
    let manifest
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8'))
    } catch {
      return { status: 'failed', reason: 'manifest' }
    }
    if (!manifest || manifest.manifestVersion !== MANIFEST_VERSION || typeof manifest.frontendVersion !== 'string' || !Array.isArray(manifest.files)) {
      return { status: 'failed', reason: 'manifest' }
    }
    if (compareVersions(manifest.minShellVersion || '0.0.0', shellVersion) > 0) return { status: 'ignored', reason: 'shell' }
    if ((manifest.dataSchemaVersion || 0) > DATA_SCHEMA_VERSION) return { status: 'ignored', reason: 'schema' }
    if (compareVersions(manifest.frontendVersion, current) <= 0) return { status: 'current' }
    return { status: 'available', manifest }
  }

  const downloadAndStage = async ({ host, manifest }) => {
    const version = manifest.frontendVersion
    if (bundleComplete(versionDir(version))) return { ok: true, cached: true }
    if (!Array.isArray(manifest.files) || !manifest.files.length) return { ok: false, reason: 'manifest' }
    let total = 0
    for (const file of manifest.files) {
      if (!file || !isSafeRelPath(file.path) || !Number.isFinite(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES || typeof file.sha256 !== 'string') {
        return { ok: false, reason: 'manifest' }
      }
      total += file.bytes
      if (total > MAX_TOTAL_BYTES) return { ok: false, reason: 'size' }
    }
    const base = host.replace(/\/$/, '')
    const staging = stagingDir(version)
    await fsp.rm(staging, { recursive: true, force: true })
    await fsp.mkdir(staging, { recursive: true })
    try {
      for (const file of manifest.files) {
        const bytes = await fetchWithTimeout(`${base}/${version}/${file.path}`)
        if (bytes.length !== file.bytes) throw new Error('bytes')
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256.toLowerCase()) throw new Error('hash')
        const target = path.join(staging, file.path)
        await fsp.mkdir(path.dirname(target), { recursive: true })
        await fsp.writeFile(target, bytes)
      }
      const indexHtml = await fsp.readFile(path.join(staging, 'index.html'), 'utf8').catch(() => null)
      if (!indexHtml) throw new Error('index')
      const listed = new Set(manifest.files.map(file => file.path))
      for (const ref of referencedAssets(indexHtml)) {
        if (!listed.has(ref)) throw new Error('assets')
      }
      await fsp.writeFile(path.join(staging, '.complete'), JSON.stringify({ version, at: new Date().toISOString() }))
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'download' }
    }
  }

  const commitStaged = async version => {
    const staging = stagingDir(version)
    if (!bundleComplete(staging)) return { ok: false, reason: 'incomplete' }
    const target = versionDir(version)
    await fsp.rm(target, { recursive: true, force: true })
    await fsp.rename(staging, target)
    await fsp.mkdir(updatesDir(), { recursive: true })
    await fsp.writeFile(pendingFile(), JSON.stringify({ version }))
    return { ok: true }
  }

  const markBooted = async version => {
    const state = readState()
    if (state.pending !== version || !bundleComplete(versionDir(version))) return false
    const previous = state.active && state.active !== version ? state.active : null
    await fsp.mkdir(updatesDir(), { recursive: true })
    await fsp.writeFile(activeFile(), JSON.stringify({ version, previous }))
    await fsp.rm(pendingFile(), { force: true })
    await fsp.rm(failureFile(), { force: true })
    const entries = await fsp.readdir(updatesDir()).catch(() => [])
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const full = path.join(updatesDir(), entry)
      try {
        if ((await fsp.stat(full)).isDirectory() && entry !== version && entry !== previous) {
          await fsp.rm(full, { recursive: true, force: true })
        }
      } catch { /* keep on error */ }
    }
    return true
  }

  const recordFailure = async (version, reason) => {
    await fsp.mkdir(updatesDir(), { recursive: true })
    await fsp.writeFile(failureFile(), JSON.stringify({ version, reason, at: new Date().toISOString() }))
    await fsp.rm(pendingFile(), { force: true })
  }

  const shouldBlockRestart = editorDirty => editorDirty === true

  const serveFile = async (root, method, urlPath) => {
    if (method !== 'GET') return { status: 403, body: 'forbidden', contentType: MIME['.txt'] }
    let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]).replace(/^\/+/, '')
    if (!rel) rel = 'index.html'
    if (!isSafeRelPath(rel)) return { status: 403, body: 'forbidden', contentType: MIME['.txt'] }
    const ext = path.posix.extname(rel).toLowerCase()
    if (!MIME[ext]) return { status: 404, body: 'not found', contentType: MIME['.txt'] }
    try {
      const body = await fsp.readFile(path.join(root, rel))
      return { status: 200, body, contentType: MIME[ext] }
    } catch {
      return { status: 404, body: 'not found', contentType: MIME['.txt'] }
    }
  }

  return {
    MANIFEST_VERSION, DATA_SCHEMA_VERSION, CHECK_TIMEOUT_MS, BOOT_TIMEOUT_MS,
    compareVersions, isSafeRelPath, referencedAssets, verifyManifest,
    updatesDir, stagingDir, versionDir, readState, resolveRoot,
    checkForUpdate, downloadAndStage, commitStaged, markBooted, recordFailure,
    shouldBlockRestart, serveFile,
  }
}

module.exports = { createUpdater }
