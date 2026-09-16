const { app, BrowserWindow, dialog, ipcMain, protocol, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createUpdater } = require('./updater.cjs')

protocol.registerSchemesAsPrivileged([{
  scheme: 'ledgerly',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
}])

const dataPath = () => path.join(app.getPath('userData'), 'ledgerly-data.json')
const backupPath = () => path.join(app.getPath('userData'), 'ledgerly-data.backup.json')

const readJson = async file => {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

let saveQueue = Promise.resolve()

ipcMain.handle('ledgerly:load', async () => {
  const saved = await readJson(dataPath()) || await readJson(backupPath())
  if (!saved) return null
  if (saved.format === 'ledgerly-native-v1' && saved.data) return { established: true, data: saved.data }
  return { established: false, data: saved }
})
ipcMain.handle('ledgerly:save', (_event, data) => {
  if (!data || typeof data !== 'object') throw new Error('Invalid Ledgerly data')
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    const target = dataPath()
    const temporary = `${target}.${process.pid}.tmp`
    await fs.mkdir(path.dirname(target), { recursive: true })
    try { await fs.copyFile(target, backupPath()) } catch {}
    const envelope = { format: 'ledgerly-native-v1', savedAt: new Date().toISOString(), data }
    await fs.writeFile(temporary, JSON.stringify(envelope, null, 2), 'utf8')
    await fs.rename(temporary, target)
  })
  return saveQueue
})

// --- Local frontend update channel (Phase 0) ---
// No autoUpdater here: routine frontend updates are verified local bundles.
// A native shell release remains a separate DMG path.
const UPDATE_HOST = process.env.LEDGERLY_UPDATE_HOST || null
const UPDATE_PUBLIC_KEY = process.env.LEDGERLY_UPDATE_PUBLIC_KEY || null
const BOOT_URL = 'ledgerly://app/'

let updater = null
let updateStatus = { phase: 'current', failure: null, lastCheck: null, pending: null, notes: [], security: false }
let knownFrontend = null
let scheduledCheck = false

const refreshUpdateState = () => {
  if (!updater) return
  const state = updater.readState()
  updateStatus.pending = state.pending
  if (!updateStatus.failure) updateStatus.failure = state.failure?.reason || null
}

const checkNow = async frontend => {
  if (!updater) return updateStatus
  refreshUpdateState()
  if (frontend) knownFrontend = frontend
  if (!UPDATE_HOST || !UPDATE_PUBLIC_KEY) { updateStatus.phase = 'disabled'; return updateStatus }
  if (!knownFrontend) return updateStatus
  updateStatus.phase = 'checking'
  try {
    const result = await updater.checkForUpdate({ host: UPDATE_HOST, publicKey: UPDATE_PUBLIC_KEY, current: knownFrontend })
    updateStatus.lastCheck = new Date().toISOString()
    if (result.status === 'available') {
      updateStatus.phase = 'downloading'
      const staged = await updater.downloadAndStage({ host: UPDATE_HOST, manifest: result.manifest })
      if (!staged.ok) { updateStatus.phase = 'failed'; updateStatus.failure = staged.reason; return updateStatus }
      const committed = await updater.commitStaged(result.manifest.frontendVersion)
      if (!committed.ok) { updateStatus.phase = 'failed'; updateStatus.failure = committed.reason; return updateStatus }
      updateStatus.phase = 'ready'
      updateStatus.failure = null
      updateStatus.pending = result.manifest.frontendVersion
      updateStatus.notes = Array.isArray(result.manifest.releaseNotes) ? result.manifest.releaseNotes : []
      updateStatus.security = result.manifest.security === true
    } else if (result.status === 'current' || result.status === 'ignored') {
      if (updateStatus.phase === 'checking') updateStatus.phase = updater.readState().pending ? 'ready' : 'current'
    } else {
      updateStatus.phase = result.status === 'disabled' ? 'disabled' : 'failed'
      updateStatus.failure = result.reason || 'unknown'
    }
  } catch {
    updateStatus.phase = 'failed'
    updateStatus.failure = 'network'
  }
  return updateStatus
}

ipcMain.handle('ledgerly:updates-status', () => {
  refreshUpdateState()
  return {
    supported: true,
    enabled: Boolean(UPDATE_HOST && UPDATE_PUBLIC_KEY),
    shell: app.getVersion(),
    frontend: knownFrontend,
    phase: updateStatus.phase,
    pending: updateStatus.pending,
    failure: updateStatus.failure,
    lastCheck: updateStatus.lastCheck,
    notes: updateStatus.notes,
    security: updateStatus.security,
  }
})
ipcMain.handle('ledgerly:updates-check', (_event, frontend) => checkNow(frontend))
ipcMain.handle('ledgerly:updates-restart', async event => {
  const window = BrowserWindow.fromWebContents(event.sender)
  let dirty = false
  try {
    dirty = await event.sender.executeJavaScript('window.__ledgerlyEditorDirty === true')
  } catch { dirty = false }
  if (updater && updater.shouldBlockRestart(dirty)) return { ok: false, reason: 'dirty' }
  if (window) window.__ledgerlyForceClose = true
  app.relaunch()
  app.exit(0)
  return { ok: true }
})
ipcMain.handle('ledgerly:updates-booted', async (_event, version) => {
  if (!updater || typeof version !== 'string') return { ok: false }
  knownFrontend = version
  const ok = await updater.markBooted(version)
  if (ok) {
    updateStatus.phase = 'current'
    updateStatus.pending = null
    updateStatus.failure = null
    updateStatus.notes = []
  }
  if (!scheduledCheck) {
    scheduledCheck = true
    setTimeout(() => { checkNow(version).catch(() => undefined) }, 8000)
  }
  return { ok }
})

const createWindow = () => {
  const packagedDist = path.join(__dirname, '..', 'dist')
  const window = new BrowserWindow({
    title: 'Ledgerly',
    width: 1440,
    height: 940,
    minWidth: 360,
    minHeight: 640,
    backgroundColor: '#ffffff',
    show: false,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' }
      : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged, preload: path.join(__dirname, 'preload.cjs') },
  })

  const boot = updater.resolveRoot(packagedDist)
  let bootTimer = null
  const abandonPending = async reason => {
    if (!bootTimer) return
    clearTimeout(bootTimer)
    bootTimer = null
    await updater.recordFailure(boot.version, reason)
    updateStatus.failure = reason
    window.loadURL(BOOT_URL)
  }
  if (boot.kind === 'pending') {
    bootTimer = setTimeout(() => { abandonPending('boot-timeout').catch(() => undefined) }, updater.BOOT_TIMEOUT_MS)
    window.webContents.on('render-process-gone', (_event, details) => { abandonPending(`crash:${details?.reason || 'unknown'}`).catch(() => undefined) })
    window.webContents.on('did-fail-load', (_event, _code, _desc, validatedURL, isMainFrame) => {
      if (isMainFrame && validatedURL === BOOT_URL) abandonPending('load').catch(() => undefined)
    })
  }

  window.once('ready-to-show', () => window.show())
  window.on('close', event => {
    if (window.__ledgerlyForceClose) return
    event.preventDefault()
    window.webContents.executeJavaScript('window.__ledgerlyEditorDirty === true').then(dirty => {
      if (!dirty) { window.__ledgerlyForceClose = true; window.close(); return }
      return dialog.showMessageBox(window, { type: 'warning', buttons: ['Discard changes', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Close Ledgerly?', detail: 'You have unsaved invoice changes. They will be lost.' }).then(({ response }) => {
        if (response === 0) { window.__ledgerlyForceClose = true; window.close() }
      })
    }).catch(() => { window.__ledgerlyForceClose = true; window.close() })
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('mailto:')) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === 'ledgerly://app') return
    } catch { /* fall through to deny */ }
    event.preventDefault()
  })
  window.loadURL(BOOT_URL)
}

app.setName('Ledgerly')
app.whenReady().then(() => {
  updater = createUpdater({
    userDataPath: app.getPath('userData'),
    shellVersion: app.getVersion(),
    allowInsecureLocalhost: process.env.LEDGERLY_ALLOW_INSECURE_LOCALHOST === '1',
  })
  protocol.handle('ledgerly', async request => {
    try {
      const url = new URL(request.url)
      if (url.host !== 'app') return new Response('not found', { status: 404 })
      const { root } = updater.resolveRoot(path.join(__dirname, '..', 'dist'))
      const served = await updater.serveFile(root, request.method, url.pathname)
      return new Response(served.body, { status: served.status, headers: { 'content-type': served.contentType } })
    } catch {
      return new Response('error', { status: 500 })
    }
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
