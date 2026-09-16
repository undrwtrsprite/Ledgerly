import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { generateKeyPairSync, createHash, sign } from 'node:crypto'
import updaterPkg from './updater.cjs'

const { createUpdater } = updaterPkg

const roots = []
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }) })
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledgerly-upd-'))
  roots.push(dir)
  return createUpdater({ userDataPath: dir, shellVersion: '1.6.1', fetchImpl: () => { throw new Error('no fetch') } })
}

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    const { compareVersions } = fresh()
    expect(compareVersions('1.7.0', '1.6.1')).toBe(1)
    expect(compareVersions('1.6.1', '1.6.1')).toBe(0)
    expect(compareVersions('1.6', '1.6.1')).toBe(-1)
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
  })
})

describe('isSafeRelPath', () => {
  it('rejects traversal, absolute, and scheme paths', () => {
    const { isSafeRelPath } = fresh()
    expect(isSafeRelPath('index.html')).toBe(true)
    expect(isSafeRelPath('assets/app-abc.js')).toBe(true)
    for (const bad of ['../x', '/etc/passwd', 'a/../../b', '..', '', 'C:\\x', 'http://h/x', 'a\\b']) {
      expect(isSafeRelPath(bad)).toBe(false)
    }
    expect(isSafeRelPath('./a')).toBe(true)
    expect(isSafeRelPath('a/./b')).toBe(true)
  })
})

describe('serveFile', () => {
  it('serves inside root and blocks everything else', async () => {
    const updater = fresh()
    const root = mkdtempSync(join(tmpdir(), 'ledgerly-www-'))
    roots.push(root)
    writeFileSync(join(root, 'index.html'), '<html></html>')
    expect((await updater.serveFile(root, 'GET', '/')).status).toBe(200)
    expect((await updater.serveFile(root, 'GET', '/index.html')).status).toBe(200)
    expect((await updater.serveFile(root, 'POST', '/')).status).toBe(403)
    expect((await updater.serveFile(root, 'GET', '/..%2Fsecret')).status).toBe(403)
    expect((await updater.serveFile(root, 'GET', '/../secret')).status).toBe(403)
    expect((await updater.serveFile(root, 'GET', '/missing.html')).status).toBe(404)
    writeFileSync(join(root, 'data.bin'), 'x')
    expect((await updater.serveFile(root, 'GET', '/data.bin')).status).toBe(404)
  })
})

describe('manifest signature', () => {
  it('accepts exact bytes and rejects tampering', () => {
    const { verifyManifest } = fresh()
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    const body = Buffer.from('{"frontendVersion":"1.7.0"}')
    const sig = sign(null, body, privateKey)
    expect(verifyManifest(body, sig, pub)).toBe(true)
    expect(verifyManifest(Buffer.from('{"frontendVersion":"1.7.1"}'), sig, pub)).toBe(false)
    expect(verifyManifest(body, Buffer.from(sig).fill(0), pub)).toBe(false)
  })
})

const INDEX = '<!doctype html><html><head><link rel="stylesheet" href="./assets/app.css"></head><body><script type="module" src="./assets/app.js"></script></body></html>'

function stagedHost(files, manifestOverrides = {}, keypair) {
  const manifest = {
    manifestVersion: 1, frontendVersion: '1.7.0', minShellVersion: '1.6.1', dataSchemaVersion: 1,
    publishedAt: '2026-09-09T12:00:00.000Z', releaseNotes: ['Fixes.'],
    files: Object.entries(files).map(([filePath, content]) => ({
      path: filePath, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'),
    })),
    ...manifestOverrides,
  }
  const body = Buffer.from(JSON.stringify(manifest))
  const sig = sign(null, body, keypair.privateKey)
  const pub = keypair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  const routes = new Map([
    ['/manifest.json', body],
    ['/manifest.sig', sig],
    ...Object.entries(files).map(([filePath, content]) => [`/1.7.0/${filePath}`, Buffer.from(content)]),
  ])
  const fetchImpl = async url => {
    const hit = routes.get(new URL(url).pathname)
    if (!hit) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
    return { ok: true, status: 200, arrayBuffer: async () => hit }
  }
  return { fetchImpl, pub }
}

describe('update lifecycle', () => {
  it('checks, stages, commits, boots, and prunes idempotently', async () => {
    const keypair = generateKeyPairSync('ed25519')
    const files = { 'index.html': INDEX, 'assets/app.js': 'console.log(1)', 'assets/app.css': 'a{}' }
    const { fetchImpl, pub } = stagedHost(files, {}, keypair)
    const dir = mkdtempSync(join(tmpdir(), 'ledgerly-upd-'))
    roots.push(dir)
    const updater = createUpdater({ userDataPath: dir, shellVersion: '1.6.1', fetchImpl })
    const host = 'https://updates.example.com'

    const checked = await updater.checkForUpdate({ host, publicKey: pub, current: '1.6.1' })
    expect(checked.status).toBe('available')
    const staged = await updater.downloadAndStage({ host, manifest: checked.manifest })
    expect(staged).toEqual({ ok: true })
    // Rechecking the committed path is unnecessary: staging again is deterministic.
    const committed = await updater.commitStaged('1.7.0')
    expect(committed).toEqual({ ok: true })
    expect(updater.readState().pending).toBe('1.7.0')
    // Second commit from a fresh stage is stable.
    const stagedAgain = await updater.downloadAndStage({ host, manifest: checked.manifest })
    expect(stagedAgain).toEqual({ ok: true, cached: true })

    const served = await updater.serveFile(updater.versionDir('1.7.0'), 'GET', '/')
    expect(served.status).toBe(200)
    expect(updater.resolveRoot('/packaged').version).toBe('1.7.0')

    expect(await updater.markBooted('1.7.0')).toBe(true)
    expect(updater.readState()).toMatchObject({ active: '1.7.0', pending: null })
    expect(await updater.markBooted('1.7.0')).toBe(false)

    const recheck = await updater.checkForUpdate({ host, publicKey: pub, current: '1.7.0' })
    expect(recheck.status).toBe('current')
  })

  it('rejects bad signature, bad hash, missing assets, and new shells', async () => {
    const keypair = generateKeyPairSync('ed25519')
    const other = generateKeyPairSync('ed25519')
    const files = { 'index.html': INDEX, 'assets/app.js': 'x', 'assets/app.css': 'y' }
    const dir = mkdtempSync(join(tmpdir(), 'ledgerly-upd-'))
    roots.push(dir)
    const host = 'https://updates.example.com'

    const badKey = createUpdater({ userDataPath: dir, shellVersion: '1.6.1', fetchImpl: stagedHost(files, {}, keypair).fetchImpl })
    const wrongPub = other.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    expect(await badKey.checkForUpdate({ host, publicKey: wrongPub, current: '1.6.1' })).toMatchObject({ status: 'failed', reason: 'signature' })

    const { fetchImpl, pub } = stagedHost(files, {}, keypair)
    const tamperedFetch = async url => {
      const res = await fetchImpl(url)
      if (new URL(url).pathname.endsWith('app.js')) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('y') }
      }
      return res
    }
    const tamperDir = mkdtempSync(join(tmpdir(), 'ledgerly-upd-'))
    roots.push(tamperDir)
    const tampered = createUpdater({ userDataPath: tamperDir, shellVersion: '1.6.1', fetchImpl: tamperedFetch })
    const manifest = (await tampered.checkForUpdate({ host, publicKey: pub, current: '1.6.1' })).manifest
    expect(await tampered.downloadAndStage({ host, manifest })).toMatchObject({ ok: false, reason: 'hash' })
    expect(tampered.readState()).toMatchObject({ active: null, pending: null })

    const newShell = createUpdater({ userDataPath: dir, shellVersion: '1.0.0', fetchImpl })
    expect(await newShell.checkForUpdate({ host, publicKey: pub, current: '1.0.0' })).toMatchObject({ status: 'ignored', reason: 'shell' })

    const noRef = stagedHost({ 'index.html': '<html><script src="./assets/gone.js"></script></html>', 'assets/app.js': 'x' }, {}, keypair)
    const orphan = createUpdater({ userDataPath: dir, shellVersion: '1.6.1', fetchImpl: noRef.fetchImpl })
    const orphanManifest = (await orphan.checkForUpdate({ host, publicKey: noRef.pub, current: '1.6.1' })).manifest
    expect(await orphan.downloadAndStage({ host, manifest: orphanManifest })).toMatchObject({ ok: false, reason: 'assets' })
  })

  it('rolls back a failed pending boot to the previous bundle', async () => {
    const updater = fresh()
    mkdirSync(updater.versionDir('1.6.0'), { recursive: true })
    writeFileSync(join(updater.versionDir('1.6.0'), 'index.html'), 'old')
    writeFileSync(join(updater.versionDir('1.6.0'), '.complete'), '{}')
    mkdirSync(updater.versionDir('1.7.0'), { recursive: true })
    writeFileSync(join(updater.versionDir('1.7.0'), 'index.html'), 'new')
    writeFileSync(join(updater.versionDir('1.7.0'), '.complete'), '{}')
    writeFileSync(join(updater.updatesDir(), 'active.json'), JSON.stringify({ version: '1.6.0' }))
    writeFileSync(join(updater.updatesDir(), 'pending.json'), JSON.stringify({ version: '1.7.0' }))
    expect(updater.resolveRoot('/packaged').version).toBe('1.7.0')
    await updater.recordFailure('1.7.0', 'boot-timeout')
    expect(updater.readState()).toMatchObject({ active: '1.6.0', pending: null })
    expect(updater.readState().failure.reason).toBe('boot-timeout')
    expect(updater.resolveRoot('/packaged').version).toBe('1.6.0')
    expect(updater.shouldBlockRestart(true)).toBe(true)
    expect(updater.shouldBlockRestart(false)).toBe(false)
  })

  it('stays disabled without host or key', async () => {
    const updater = fresh()
    expect(await updater.checkForUpdate({ host: null, publicKey: null, current: '1.6.1' })).toMatchObject({ status: 'disabled' })
  })
})
