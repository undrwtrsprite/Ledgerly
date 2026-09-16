import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Activity, Archive, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Banknote, BarChart3, Bell, Building2, CalendarDays, Check, CheckCircle2, ChevronDown, CircleDollarSign, Clock3, Copy, Download, FileArchive, FilePlus2, FileText, Filter, HelpCircle, Home, LayoutGrid, Menu, MoreHorizontal, Package, Palette, PanelLeftClose, PanelLeftOpen, Plus, Receipt, Search, Send, Settings, Share2, Trash2, Upload, UserRound, Users, WalletCards, X } from 'lucide-react'
import { convertMinorUnits, currencyDigits, effectiveStatus, formatCurrencyTotals, formatMoney, invoiceTotals, monthKeyLocal, nextDraftNumber, parseMoney, paymentCurrency, sumByCurrency, uid, type CurrencyTotal } from './domain'
import { downloadInvoicePdf } from './pdf'
import { formatInvoiceDate, invoiceCopy, invoiceLocale, organizationPaymentDetails, type InvoiceDocumentLocale } from './invoiceLocale'
import { accessibilityIssues, INVOICE_FONTS, INVOICE_PALETTES, legacyAppearanceFromColor, makeAccessible, normalizeAppearance, paletteById, resolveAccent, resolveAppearance, resolveTokens, templateDefinition, type InvoiceAccentStyle, type InvoiceAppearance, type InvoiceDensity, type InvoiceFontPair, type InvoiceLogoPosition, type InvoiceLogoScale, type InvoiceTemplate, type ResolvedAccent, type TemplateDefinition } from './appearance'
import { useStore } from './store'
import { blankData } from './seed'
import { FRONTEND_VERSION, SHELL_VERSION } from './release'
import type { AppData, Client, Invoice, InvoiceStatus, LineItem, Organization, Payment, Product, View } from './types'

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => localDate(new Date())
const datePlus = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return localDate(d) }
const formatLocal = (date: string, opts: Intl.DateTimeFormatOptions) => { const d = new Date(`${date}T12:00:00`); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', opts).format(d) }
const shortDate = (date: string) => formatLocal(date, { day: 'numeric', month: 'short', year: 'numeric' })
const compactDate = (date: string) => formatLocal(date, { day: 'numeric', month: 'short' })

function Button({ children, variant = 'primary', icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: ReactNode }) {
  return <button className={`button ${variant}`} {...props}>{icon}{children}</button>
}

function MoneyField({ amount, currency, onChange, ariaLabel, autoFocus = false }: { amount: number; currency: string; onChange: (minor: number) => void; ariaLabel: string; autoFocus?: boolean }) {
  const formatted = () => (amount / (10 ** currencyDigits(currency))).toFixed(currencyDigits(currency))
  const [draft, setDraft] = useState(formatted)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setDraft(formatted()) }, [amount, currency])
  return <input
    aria-label={ariaLabel}
    autoFocus={autoFocus}
    inputMode="decimal"
    value={draft}
    onFocus={event => { focused.current = true; if (amount === 0) setDraft(''); else event.currentTarget.select() }}
    onChange={event => { setDraft(event.target.value); onChange(parseMoney(event.target.value, currency)) }}
    onBlur={() => { focused.current = false; setDraft(formatted()) }}
  />
}

function StatusPill({ status }: { status: InvoiceStatus }) {
  return <span className={`status status-${status}`}><span className="status-dot" />{status === 'partial' ? 'Partially paid' : status[0].toUpperCase() + status.slice(1)}</span>
}

function Modal({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const modalRef = useRef<HTMLElement>(null)
  const returnFocus = useRef(document.activeElement as HTMLElement | null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const modal = modalRef.current
    const controls = () => Array.from(modal?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0)
    if (!modal?.contains(document.activeElement)) (controls().find(element => element.matches('input, select, textarea')) || controls()[0] || modal)?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const elements = controls()
      const first = elements[0]; const last = elements[elements.length - 1]
      if (!first) { event.preventDefault(); modal?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow; returnFocus.current?.focus() }
  }, [])
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}><section ref={modalRef} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>{children}</section></div>
}

function App() {
  const { data } = useStore()
  const [view, setView] = useState<View>('dashboard')
  const [mobileNav, setMobileNav] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => { try { return localStorage.getItem('ledgerly-sidebar-collapsed') === '1' } catch { return false } })
  const toggleSidebar = () => { setSidebarCollapsed(prev => { const next = !prev; try { localStorage.setItem('ledgerly-sidebar-collapsed', next ? '1' : '0') } catch {} return next }) }
  const [editorId, setEditorId] = useState<string | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | null>(null)
  const alert = (message: string) => { setToast(message); if (toastTimer.current) window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 3200) }
  const canLeaveEditor = () => !editorId || !editorDirty || confirm('Discard your unsaved invoice changes?')
  const openNew = () => {
    if (!canLeaveEditor()) return
    if (!data.clients.some(client => !client.archived)) { setView('clients'); alert('Add your first client before creating an invoice.'); return }
    setView('invoices'); setMobileNav(false)
    setEditorDirty(false); setEditorId('new'); setDetailId(null)
  }
  const go = (next: View) => { if (!canLeaveEditor()) return; setView(next); setMobileNav(false); setEditorDirty(false); setEditorId(null); setDetailId(null) }
  const viewLabels: Record<View, string> = { dashboard: 'Overview', invoices: 'Invoices', clients: 'Clients', products: 'Products & services', payments: 'Payments', reports: 'Reports', settings: 'Settings' }
  const organizationName = data.organization.tradingName || data.organization.legalName || 'My business'
  const organizationInitials = organizationName.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase()
  const reminderInvoices = data.organization.reminders.enabled ? data.invoices.filter(invoice => {
    const status = effectiveStatus(invoice, data.payments)
    if (!['sent', 'partial', 'overdue', 'finalized'].includes(status)) return false
    const days = Math.ceil((new Date(`${invoice.dueDate}T12:00:00`).getTime() - new Date(`${today()}T12:00:00`).getTime()) / 864e5)
    return (status === 'overdue' && Math.abs(days) >= data.organization.reminders.overdueFollowUpDays) || (days === 0 && data.organization.reminders.includeDueToday) || (days > 0 && days <= data.organization.reminders.dueSoonDays)
  }) : []

  useEffect(() => { window.__ledgerlyEditorDirty = editorDirty }, [editorDirty])
  const updateReady = useRef(false)
  useEffect(() => {
    const onReady = () => {
      if (window.__ledgerlyEditorDirty) { updateReady.current = true; return }
      alert('A new Ledgerly version is ready. Reload the page to update.')
    }
    window.addEventListener('ledgerly:update-ready', onReady)
    return () => window.removeEventListener('ledgerly:update-ready', onReady)
  }, [])
  useEffect(() => {
    if (!editorDirty && updateReady.current) {
      updateReady.current = false
      alert('A new Ledgerly version is ready. Reload the page to update.')
    }
  }, [editorDirty])
  useEffect(() => { if (!mobileNav) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileNav(false) }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close) }, [mobileNav])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [view, editorId, detailId])
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus() } }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [])

  const isNativeMac = !!window.ledgerlyStorage && (window.ledgerlyStorage.platform || (/Mac/.test(navigator.platform || navigator.userAgent) ? 'darwin' : '')) === 'darwin'

return <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}${isNativeMac ? ' native-mac' : ''}`}>
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 5v14h13M11 5v9h8" stroke="currentColor" strokeWidth="2" /></svg></div><span className="sidebar-label">Ledgerly</span><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><PanelLeftClose size={20} /></button></div>
      <button className="org-switch" onClick={() => go('settings')}><div className="avatar">{organizationInitials}</div><div><strong>{organizationName}</strong><span>Private workspace</span></div><Settings size={15} /></button>
      <div className="sidebar-create"><Button icon={<Plus size={17} />} onClick={openNew}><span className="sidebar-label">New invoice</span></Button></div>
      <nav aria-label="Main navigation">
        <NavButton icon={<Home />} label="Overview" active={view === 'dashboard'} onClick={() => go('dashboard')} />
        <NavButton icon={<FileText />} label="Invoices" active={view === 'invoices'} badge={data.invoices.filter(i => ['sent', 'overdue', 'partial'].includes(effectiveStatus(i, data.payments))).length} onClick={() => go('invoices')} />
        <NavButton icon={<Users />} label="Clients" active={view === 'clients'} onClick={() => go('clients')} />
        <NavButton icon={<Package />} label="Products & services" active={view === 'products'} onClick={() => go('products')} />
        <NavButton icon={<WalletCards />} label="Payments" active={view === 'payments'} onClick={() => go('payments')} />
        <NavButton icon={<BarChart3 />} label="Reports" active={view === 'reports'} onClick={() => go('reports')} />
      </nav>
      <div className="sidebar-bottom"><NavButton icon={<Settings />} label="Settings" active={view === 'settings'} onClick={() => go('settings')} /><NavButton icon={<HelpCircle />} label="Help & support" onClick={() => { setMobileNav(false); setHelpOpen(true) }} /></div>
    </aside>
    {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} />}
    <main className="main">
      <header className="topbar">
        <div className="topbar-context"><button className="icon-button sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed}>{sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open navigation" aria-expanded={mobileNav}><Menu size={20} /></button><span>{viewLabels[editorId || detailId ? 'invoices' : view]}</span>{editorId && <><span className="breadcrumb-divider">/</span><span className="breadcrumb-current">{editorId === 'new' ? 'New invoice' : 'Edit draft'}</span></>}{detailId && !editorId && <><span className="breadcrumb-divider">/</span><span className="breadcrumb-current">{data.invoices.find(invoice => invoice.id === detailId)?.number}</span></>}</div>
        <div className="top-actions"><div className="topbar-search"><Search size={16} /><input ref={searchRef} value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} aria-label="Global search" placeholder="Search invoices or clients" onKeyDown={e => { if (e.key === 'Enter' && globalSearch.trim()) { setInvoiceSearch(globalSearch.trim()); go('invoices') } }} /><kbd>⌘ K</kbd></div><button className="icon-button notification" onClick={() => setNotificationsOpen(true)} aria-label={`Notifications${reminderInvoices.length ? `, ${reminderInvoices.length} due` : ''}`}><Bell size={18} />{reminderInvoices.length > 0 && <span />}</button><button className="icon-button mobile-create" onClick={openNew} aria-label="New invoice"><Plus size={20} /></button></div>
      </header>
      {editorId ? <InvoiceEditor invoiceId={editorId} onDirtyChange={setEditorDirty} onClose={() => { if (canLeaveEditor()) { setEditorDirty(false); setEditorId(null) } }} onOpen={id => { setEditorDirty(false); setEditorId(null); setDetailId(id) }} notify={alert} /> : detailId ? <InvoiceDetail invoiceId={detailId} onBack={() => setDetailId(null)} onEdit={() => { setEditorDirty(false); setEditorId(detailId) }} notify={alert} /> : <>
        {view === 'dashboard' && <Dashboard openInvoice={setDetailId} newInvoice={openNew} openSettings={() => go('settings')} openInvoices={() => go('invoices')} />}
        {view === 'invoices' && <InvoicesPage initialSearch={invoiceSearch} openInvoice={setDetailId} editInvoice={setEditorId} newInvoice={openNew} notify={alert} />}
        {view === 'clients' && <ClientsPage notify={alert} />}
        {view === 'products' && <ProductsPage notify={alert} />}
        {view === 'payments' && <PaymentsPage openInvoice={setDetailId} notify={alert} />}
        {view === 'reports' && <ReportsPage notify={alert} />}
        {view === 'settings' && <SettingsPage notify={alert} />}
      </>}
    </main>
    {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}</div>}
    {notificationsOpen && <Modal title="Notifications" description="Local reminders based on your saved preferences." onClose={() => setNotificationsOpen(false)}><div className="modal-body">{reminderInvoices.length ? reminderInvoices.map(invoice => { const client = data.clients.find(item => item.id === invoice.clientId); return <button className="notification-row" key={invoice.id} onClick={() => { setNotificationsOpen(false); setDetailId(invoice.id) }}><Clock3 size={18} /><div><strong>{invoice.number} · {client?.company}</strong><span>Balance {formatMoney(invoiceTotals(invoice, data.payments).due, invoice.currency)} · Due {shortDate(invoice.dueDate)}</span></div><ArrowRight size={16} /></button> }) : <div className="mini-empty"><CheckCircle2 size={26} /><p>You’re all caught up. No invoices need a reminder.</p></div>}</div><div className="modal-actions"><Button variant="secondary" onClick={() => { setNotificationsOpen(false); go('settings') }}>Reminder settings</Button><Button onClick={() => setNotificationsOpen(false)}>Done</Button></div></Modal>}
    {helpOpen && <Modal title="Help & shortcuts" description="Everything in this personal edition stays on your Mac." onClose={() => setHelpOpen(false)}><div className="modal-body help-list"><div><FilePlus2 /><span><strong>Start an invoice</strong>Add a client first, then use New invoice from any screen.</span></div><div><Download /><span><strong>Back up your data</strong>Open Settings → Data & privacy and download a JSON backup.</span></div><div><Search /><span><strong>Search quickly</strong>Press ⌘K, type an invoice number or client, then press Return.</span></div><div><HelpCircle /><span><strong>Need to recover data?</strong>Import your latest JSON backup from Data & privacy.</span></div></div><div className="modal-actions"><Button onClick={() => setHelpOpen(false)}>Got it</Button></div></Modal>}
  </div>
}

function NavButton({ icon, label, active, badge, onClick }: { icon: ReactNode; label: string; active?: boolean; badge?: number; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} aria-label={label} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span className="sidebar-label">{label}</span>{badge ? <em className="sidebar-badge">{badge}</em> : null}</button>
}

function Dashboard({ openInvoice, newInvoice, openSettings, openInvoices }: { openInvoice: (id: string) => void; newInvoice: () => void; openSettings: () => void; openInvoices: () => void }) {
  const { data } = useStore()
  const rows = useMemo(() => data.invoices.map(invoice => ({ invoice, totals: invoiceTotals(invoice, data.payments), status: effectiveStatus(invoice, data.payments) })), [data])
  const outstandingParts = sumByCurrency(rows.filter(r => ['sent', 'partial', 'overdue', 'finalized'].includes(r.status)).map(r => ({ amount: r.totals.due, currency: r.invoice.currency })))
  const overdueParts = sumByCurrency(rows.filter(r => r.status === 'overdue').map(r => ({ amount: r.totals.due, currency: r.invoice.currency })))
  const currentMonth = today().slice(0, 7)
  const paidMonthParts = sumByCurrency(data.payments.filter(p => p.date.slice(0, 7) === currentMonth).map(p => ({ amount: p.amount, currency: paymentCurrency(p, data.invoices, data.organization.currency) })))
  const months = Array.from({ length: 12 }, (_, index) => { const date = new Date(); return new Date(date.getFullYear(), date.getMonth() - (11 - index), 1, 12) })
  const revenue = months.map(month => sumByCurrency(data.payments.filter(payment => payment.date.slice(0, 7) === monthKeyLocal(month)).map(payment => ({ amount: payment.amount, currency: paymentCurrency(payment, data.invoices, data.organization.currency) }))))
  const revenueMax = Math.max(...revenue.flatMap(parts => parts.map(part => part.amount)), 1)
  const setupFields = [data.organization.legalName || data.organization.tradingName, data.organization.address, data.organization.email, data.organization.bankInstructions]
  const setupComplete = setupFields.filter(Boolean).length
  const [setupDismissed, setSetupDismissed] = useState(() => { try { return localStorage.getItem('ledgerly-setup-banner-dismissed') === '1' } catch { return false } })
  return <div className="page dashboard-page">
    <div className="page-heading"><div><h1>Overview</h1><p>Your invoices, payments, and work in progress.</p></div><time className="overview-date" dateTime={today()}><CalendarDays size={15} />{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</time></div>
    {setupComplete < setupFields.length && !setupDismissed && <section className="setup-banner"><div className="setup-icon"><Building2 size={20} /></div><div><strong>Set up your business details</strong><span>Add the information that should appear on your invoices.</span></div><button onClick={openSettings}>Continue setup <ArrowRight size={16} /></button><button className="banner-close" onClick={() => { setSetupDismissed(true); try { localStorage.setItem('ledgerly-setup-banner-dismissed', '1') } catch {} }} aria-label="Dismiss setup reminder"><X size={16} /></button></section>}
    <section className="metrics-grid">
      <Metric label="Outstanding" value={formatCurrencyTotals(outstandingParts, data.organization.currency)} detail={`${rows.filter(r => r.totals.due > 0 && r.status !== 'draft').length} ${rows.filter(r => r.totals.due > 0 && r.status !== 'draft').length === 1 ? 'invoice' : 'invoices'}`} trend={outstandingParts.length ? 'Awaiting payment' : 'All clear'} />
      <Metric label="Overdue" value={formatCurrencyTotals(overdueParts, data.organization.currency)} detail={`${rows.filter(r => r.status === 'overdue').length} ${rows.filter(r => r.status === 'overdue').length === 1 ? 'invoice' : 'invoices'}`} trend={overdueParts.length ? 'Needs attention' : 'All clear'} warning={overdueParts.length > 0} />
      <Metric label="Paid this month" value={formatCurrencyTotals(paidMonthParts, data.organization.currency)} detail="By payment date" trend={paidMonthParts.length ? 'Received' : 'No payments'} up={paidMonthParts.length > 0} />
      <Metric label="Draft invoices" value={rows.filter(r => r.status === 'draft').length.toString()} detail="Ready to finish" trend={rows.some(r => r.status === 'draft') ? 'Not issued' : 'None yet'} />
    </section>
    <section className="dashboard-grid">
      <article className="card revenue-card">
        <div className="card-head"><div><h2>Revenue</h2><p>Payments received</p></div><span className="period-label">Last 12 months</span></div>
        <div className="revenue-total"><strong>{formatCurrencyTotals(sumByCurrency(revenue.flat()), data.organization.currency)}</strong></div>
        <div className="chart" role="group" aria-label="Payments received over the last 12 months">
          {!revenue.some(parts => parts.length > 0) && <p className="chart-empty">Your revenue will appear as payments come in.</p>}
          {revenue.map((parts, i) => <div className="bar-wrap" key={monthKeyLocal(months[i])} tabIndex={0} role="img" aria-label={`${new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(months[i])}: ${formatCurrencyTotals(parts, data.organization.currency)}`}>
            <div className="bar-track"><div className={`bar ${i === revenue.length - 1 ? 'current' : ''}`} style={{ height: `${Math.max(...parts.map(part => part.amount), 0) / revenueMax * 100}%` }} /><span className="chart-tooltip" aria-hidden="true">{formatCurrencyTotals(parts, data.organization.currency)}</span></div>
            <span aria-hidden="true">{new Intl.DateTimeFormat('en', { month: 'short' }).format(months[i])}</span>
          </div>)}
        </div>
      </article>
      <article className="card attention-card"><div className="card-head"><div><h2>Needs attention</h2><p>Open balances to follow up</p></div><span className="count-badge">{rows.filter(r => ['overdue', 'partial', 'sent'].includes(r.status)).length}</span></div>{rows.filter(r => ['overdue', 'partial', 'sent'].includes(r.status)).slice(0, 3).map(row => { const c = data.clients.find(x => x.id === row.invoice.clientId); return <button className="attention-row" key={row.invoice.id} onClick={() => openInvoice(row.invoice.id)}><div className={`row-icon ${row.status}`}><Clock3 size={17} /></div><div><strong>{c?.company}</strong><span>{row.invoice.number} · {row.status === 'overdue' ? `${row.invoice.dueDate ? Math.abs(Math.round((Date.now() - new Date(row.invoice.dueDate).getTime()) / 864e5)) : '?'} days overdue` : `Due ${compactDate(row.invoice.dueDate)}`}</span></div><b>{formatMoney(row.totals.due, row.invoice.currency)}</b><ArrowRight size={16} /></button>})}{!rows.some(r => ['overdue', 'partial', 'sent'].includes(r.status)) && <div className="mini-empty"><CheckCircle2 size={24} /><p>Nothing needs your attention.</p></div>}</article>
    </section>
    <section className="card recent-card"><div className="card-head"><div><h2>Recent invoices</h2><p>Your most recent invoices</p></div><button className="text-link" onClick={openInvoices}>View all invoices <ArrowRight size={15} /></button></div>{rows.length ? <InvoiceTable rows={rows.slice(0, 5)} clients={data.clients} onOpen={openInvoice} /> : <EmptyState icon={<FileText />} title="No invoices yet" text="Add a client, then create your first invoice." action={<Button onClick={newInvoice}>Create invoice</Button>} />}</section>
    <section className="bottom-grid"><article className="card"><div className="card-head"><div><h2>Recently paid</h2><p>Latest recorded payments</p></div><CheckCircle2 size={20} className="green" /></div>{data.payments.slice(0, 3).map(p => { const inv = data.invoices.find(i => i.id === p.invoiceId); const client = data.clients.find(c => c.id === inv?.clientId); return <div className="activity-row" key={p.id}><div className="pay-icon"><ArrowDownRight size={17} /></div><div><strong>{client?.company}</strong><span>{shortDate(p.date)} · {p.method}</span></div><b>{formatMoney(p.amount, inv?.currency || data.organization.currency)}</b></div> })}{!data.payments.length && <div className="mini-empty"><Banknote size={24} /><p>Payments will appear here when you record them.</p></div>}</article><article className="card"><div className="card-head"><div><h2>Recent activity</h2><p>Updates from your workspace</p></div><Activity size={20} /></div>{data.audit.slice(0, 3).map(a => <div className="activity-row" key={a.id}><div className="activity-dot" /><div><strong>{a.message}</strong><span>{new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round((new Date(a.at).getTime() - Date.now()) / 864e5), 'day')} · {a.actor}</span></div></div>)}{!data.audit.length && <div className="mini-empty"><Activity size={24} /><p>Your activity history will appear here.</p></div>}</article></section>
  </div>
}

function Metric({ label, value, detail, trend, up, warning }: { label: string; value: string; detail: string; trend: string; up?: boolean; warning?: boolean }) {
  return <article className="metric card"><div className="metric-label"><span>{label}</span></div><strong>{value}</strong><div><span>{detail}</span><em className={warning ? 'warning-text' : up ? 'positive' : ''}>{up && <ArrowUpRight size={13} />}{trend}</em></div></article>
}

function InvoiceTable({ rows, clients, onOpen }: { rows: { invoice: Invoice; totals: ReturnType<typeof invoiceTotals>; status: InvoiceStatus }[]; clients: Client[]; onOpen: (id: string) => void }) {
  return <div className="responsive-table"><table><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th className="amount-cell">Amount</th><th /></tr></thead><tbody>{rows.map(({ invoice, totals, status }) => <tr key={invoice.id} onClick={() => onOpen(invoice.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen(invoice.id)}><td><strong>{invoice.number}</strong></td><td>{clients.find(c => c.id === invoice.clientId)?.company}</td><td>{compactDate(invoice.issueDate)}</td><td>{compactDate(invoice.dueDate)}</td><td><StatusPill status={status} /></td><td className="amount-cell"><strong>{formatMoney(totals.total, invoice.currency)}</strong>{totals.due !== totals.total && <small>{formatMoney(totals.due, invoice.currency)} due</small>}</td><td><ArrowRight size={16} /></td></tr>)}</tbody></table></div>
}

function InvoicesPage({ initialSearch, openInvoice, editInvoice, newInvoice, notify }: { initialSearch: string; openInvoice: (id: string) => void; editInvoice: (id: string) => void; newInvoice: () => void; notify: (m: string) => void }) {
  const { data, transitionInvoice, deleteDraft } = useStore()
  const [search, setSearch] = useState(initialSearch)
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all')
  const [menu, setMenu] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [clientFilter, setClientFilter] = useState('all')
  const [currencyFilter, setCurrencyFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => setSearch(initialSearch), [initialSearch])
  const rows = useMemo(() => data.invoices.map(invoice => ({ invoice, totals: invoiceTotals(invoice, data.payments), status: effectiveStatus(invoice, data.payments) })).filter(row => {
    const client = data.clients.find(c => c.id === row.invoice.clientId)
    return (status === 'all' || row.status === status) && (clientFilter === 'all' || row.invoice.clientId === clientFilter) && (currencyFilter === 'all' || row.invoice.currency === currencyFilter) && (!dateFrom || row.invoice.issueDate >= dateFrom) && (!dateTo || row.invoice.issueDate <= dateTo) && `${row.invoice.number} ${client?.company}`.toLowerCase().includes(search.toLowerCase())
  }), [data, search, status, clientFilter, currencyFilter, dateFrom, dateTo])
  const pageSize = 20
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => setPage(1), [search, status, clientFilter, currencyFilter, dateFrom, dateTo])
  return <div className="page"><div className="page-heading"><div><h1>Invoices</h1><p>Create, send, and keep track of every invoice.</p></div></div>
    <div className="tabs" role="tablist">{(['all', 'draft', 'sent', 'overdue', 'paid'] as const).map(tab => <button role="tab" aria-selected={status === tab} className={status === tab ? 'active' : ''} onClick={() => setStatus(tab)} key={tab}>{tab === 'all' ? 'All invoices' : tab[0].toUpperCase() + tab.slice(1)}{tab !== 'all' && <span>{data.invoices.filter(i => effectiveStatus(i, data.payments) === tab).length}</span>}</button>)}</div>
    <section className="card list-card"><div className="list-tools"><div className="search-field"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by invoice or client" aria-label="Search invoices" /></div><Button variant="secondary" icon={<Filter size={16} />} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}>Filters{[clientFilter, currencyFilter].filter(value => value !== 'all').length + Number(Boolean(dateFrom)) + Number(Boolean(dateTo)) > 0 && <span className="filter-count">{[clientFilter, currencyFilter].filter(value => value !== 'all').length + Number(Boolean(dateFrom)) + Number(Boolean(dateTo))}</span>}</Button><Button variant="secondary" icon={<Download size={16} />} onClick={() => { if (!exportCsv(rows.map(({ invoice, totals, status: current }) => ({ number: invoice.number, client: data.clients.find(c => c.id === invoice.clientId)?.company, issueDate: invoice.issueDate, dueDate: invoice.dueDate, status: current, total: totals.total, due: totals.due, currency: invoice.currency })), 'invoices.csv')) { notify('Nothing to export.'); return } notify('Invoices exported.') }}>Export</Button></div>
      {filtersOpen && <div className="filter-panel"><label className="field"><span>Client</span><select value={clientFilter} onChange={e => setClientFilter(e.target.value)}><option value="all">All clients</option>{data.clients.map(client => <option value={client.id} key={client.id}>{client.company}</option>)}</select></label><label className="field"><span>Currency</span><select value={currencyFilter} onChange={e => setCurrencyFilter(e.target.value)}><option value="all">All currencies</option>{[...new Set(data.invoices.map(invoice => invoice.currency))].map(currency => <option key={currency}>{currency}</option>)}</select></label><label className="field"><span>Issued from</span><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label><label className="field"><span>Issued to</span><input type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} /></label><Button variant="ghost" onClick={() => { setClientFilter('all'); setCurrencyFilter('all'); setDateFrom(''); setDateTo('') }}>Clear filters</Button></div>}
      {rows.length ? <div className="responsive-table invoices-full"><table><thead><tr><th>Invoice</th><th>Client</th><th>Issue date</th><th>Due date</th><th>Status</th><th className="amount-cell">Total</th><th className="amount-cell">Due</th><th /></tr></thead><tbody>{pagedRows.map(({ invoice, totals, status: effective }) => <tr key={invoice.id} tabIndex={0} onKeyDown={event => event.key === 'Enter' && event.target === event.currentTarget && openInvoice(invoice.id)} onClick={() => openInvoice(invoice.id)}><td><strong>{invoice.number}</strong>{invoice.reference && <small>{invoice.reference}</small>}</td><td><div className="client-cell"><span>{data.clients.find(c => c.id === invoice.clientId)?.company.slice(0, 1)}</span><strong>{data.clients.find(c => c.id === invoice.clientId)?.company}</strong></div></td><td>{shortDate(invoice.issueDate)}</td><td>{shortDate(invoice.dueDate)}</td><td><StatusPill status={effective} /></td><td className="amount-cell"><strong>{formatMoney(totals.total, invoice.currency)}</strong></td><td className="amount-cell">{formatMoney(totals.due, invoice.currency)}</td><td className="menu-cell"><button className="icon-button" onClick={e => { e.stopPropagation(); setMenu(menu === invoice.id ? null : invoice.id) }} aria-label={`Actions for ${invoice.number}`}><MoreHorizontal size={18} /></button>{menu === invoice.id && <div className="row-menu"><button onClick={e => { e.stopPropagation(); invoice.status === 'draft' ? editInvoice(invoice.id) : openInvoice(invoice.id) }}>{invoice.status === 'draft' ? 'Edit draft' : 'View invoice'}</button>{invoice.status === 'draft' && <button onClick={e => { e.stopPropagation(); setMenu(null); editInvoice(invoice.id) }}>Review & finalize</button>}<button onClick={e => { e.stopPropagation(); downloadInvoicePdf(invoice, data.clients.find(c => c.id === invoice.clientId), data.organization, data.payments); notify('PDF generated.') }}>Download PDF</button>{invoice.status === 'draft' && <button className="danger-link" onClick={e => { e.stopPropagation(); if (confirm('Delete this draft? This cannot be undone.')) { deleteDraft(invoice.id); notify('Draft deleted.') } }}>Delete draft</button>}</div>}</td></tr>)}</tbody></table></div> : <EmptyState icon={<FileText />} title="No invoices found" text="Try another filter, or create a fresh invoice." action={<Button onClick={newInvoice}>New invoice</Button>} />}
      <div className="pagination"><span>Showing {rows.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, rows.length)} of {rows.length} filtered invoices</span><div><button disabled={page === 1} onClick={() => setPage(value => value - 1)} aria-label="Previous page"><ArrowLeft size={16} /></button><span className="active" aria-current="page">{page} / {pageCount}</span><button disabled={page === pageCount} onClick={() => setPage(value => value + 1)} aria-label="Next page"><ArrowRight size={16} /></button></div></div>
    </section>
  </div>
}

function InvoiceEditor({ invoiceId, onClose, onOpen, onDirtyChange, notify }: { invoiceId: string; onClose: () => void; onOpen: (id: string) => void; onDirtyChange: (dirty: boolean) => void; notify: (m: string) => void }) {
  const { data, saveInvoice, transitionInvoice } = useStore()
  const existing = data.invoices.find(i => i.id === invoiceId)
  const newInvoice = (): Invoice => { const documentLocale = data.organization.defaultInvoiceLocale || (data.organization.locale.startsWith('de') ? 'de-DE' : 'en-GB'); return { id: uid(), number: nextDraftNumber(data.invoices.map(i => i.number)), clientId: data.clients[0]?.id || '', status: 'draft', paymentStatus: 'unpaid', issueDate: today(), dueDate: datePlus(data.organization.paymentTermsDays), currency: data.organization.currency, documentLocale, reference: '', lineItems: [{ id: uid(), description: '', quantityMilli: 1000, unitPrice: 0, taxRateBps: data.organization.defaultTaxRateBps, discountBps: 0 }], invoiceDiscountBps: 0, additionalCharges: 0, notes: data.organization.defaultNotes, paymentTerms: `Payment due within ${data.organization.paymentTermsDays} days.`, paymentInstructions: organizationPaymentDetails(data.organization, documentLocale), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
  const [invoice, setInvoice] = useState<Invoice>(() => existing ? structuredClone(existing) : newInvoice())
  const [preview, setPreview] = useState(true)
  const [saved, setSaved] = useState(true)
  const [catalogTarget, setCatalogTarget] = useState<'new' | string | null>(null)
  useEffect(() => onDirtyChange(!saved), [saved, onDirtyChange])
  useEffect(() => { if (window.ledgerlyStorage) return; const warn = (event: BeforeUnloadEvent) => { if (!saved) event.preventDefault() }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [saved])
  const totals = invoiceTotals(invoice)
  const client = data.clients.find(c => c.id === invoice.clientId)
  const update = <K extends keyof Invoice>(key: K, value: Invoice[K]) => { setInvoice(prev => ({ ...prev, [key]: value, updatedAt: new Date().toISOString() })); setSaved(false); onDirtyChange(true) }
  const changeDocumentLocale = (documentLocale: InvoiceDocumentLocale) => {
    setInvoice(prev => {
      const previousDefault = organizationPaymentDetails(data.organization, invoiceLocale(prev, data.organization))
      return { ...prev, documentLocale, paymentInstructions: !prev.paymentInstructions || prev.paymentInstructions === previousDefault ? organizationPaymentDetails(data.organization, documentLocale) : prev.paymentInstructions, updatedAt: new Date().toISOString() }
    })
    setSaved(false); onDirtyChange(true)
  }
  const updateLine = <K extends keyof LineItem>(id: string, key: K, value: LineItem[K]) => update('lineItems', invoice.lineItems.map(line => line.id === id ? { ...line, [key]: value } : line))
  const save = () => { saveInvoice(invoice); setSaved(true); onDirtyChange(false); notify('Draft saved on this device.') }
  const finalize = () => {
    if (!invoice.clientId) { notify('Choose a client before finalizing.'); return }
    if (!invoice.issueDate || !invoice.dueDate) { notify('Choose the issue and due dates before finalizing.'); return }
    if (invoice.dueDate < invoice.issueDate) { notify('The due date cannot be before the issue date.'); return }
    if (!Number.isFinite(invoice.invoiceDiscountBps) || invoice.invoiceDiscountBps < 0 || invoice.invoiceDiscountBps > 10000) { notify('Invoice discount must be between 0% and 100%.'); return }
    if (!invoice.lineItems.length || invoice.lineItems.some(line => !Number.isFinite(line.quantityMilli) || !Number.isFinite(line.unitPrice) || !line.description.trim() || line.quantityMilli < 0 || line.unitPrice < 0)) { notify('Complete every line item before finalizing.'); return }
    saveInvoice(invoice); transitionInvoice(invoice.id, 'finalized'); notify('Invoice finalized with a unique number.'); onOpen(invoice.id)
  }
  const applyProduct = (product: Product) => {
    const line = { id: uid(), description: product.description || product.name, quantityMilli: 1000, unitPrice: product.unitPrice, taxRateBps: product.taxRate * 100, discountBps: 0 }
    if (catalogTarget === 'new') update('lineItems', [...invoice.lineItems, line])
    else update('lineItems', invoice.lineItems.map(item => item.id === catalogTarget ? { ...item, ...line, id: item.id } : item))
    setCatalogTarget(null)
  }
  return <div className="editor-page"><div className="editor-top"><button className="back-button" onClick={onClose}><ArrowLeft size={18} /> Back to invoices</button><div className="save-state"><span className={saved ? 'saved' : 'pending'} />{saved ? existing ? 'All changes saved' : 'New draft' : 'Unsaved changes'}</div><div className="editor-actions"><Button variant="secondary" icon={<LayoutGrid size={16} />} onClick={() => setPreview(!preview)}>{preview ? 'Hide preview' : 'Show preview'}</Button><Button variant="secondary" onClick={save}>Save draft</Button><Button onClick={finalize}>Finalize invoice</Button></div></div>
    <div className={`editor-layout ${preview ? '' : 'no-preview'}`}><section className="editor-form"><div className="editor-title"><span>{existing ? 'Edit draft' : 'New invoice'}</span><h1>{invoice.number}</h1></div><div className="editor-section"><h2>Invoice details</h2><div className="form-grid"><label className="field field-wide"><span>Client</span><select value={invoice.clientId} onChange={e => update('clientId', e.target.value)}>{data.clients.filter(c => !c.archived).map(c => <option value={c.id} key={c.id}>{c.company}{c.contact ? ` — ${c.contact}` : ''}</option>)}</select></label><label className="field"><span>Issue date</span><input type="date" value={invoice.issueDate} onChange={e => update('issueDate', e.target.value)} /></label><label className="field"><span>Due date</span><input min={invoice.issueDate} type="date" value={invoice.dueDate} onChange={e => update('dueDate', e.target.value)} /></label><label className="field"><span>Currency</span><select value={invoice.currency} onChange={e => update('currency', e.target.value)}>{['EUR','USD','GBP','CHF','JPY','CAD','AUD'].map(c => <option key={c}>{c}</option>)}</select></label><label className="field"><span>Invoice language</span><select value={invoiceLocale(invoice, data.organization)} onChange={e => changeDocumentLocale(e.target.value as InvoiceDocumentLocale)}><option value="en-GB">English</option><option value="de-DE">Deutsch</option></select></label><label className="field field-wide"><span>PO / reference</span><input value={invoice.reference} onChange={e => update('reference', e.target.value)} placeholder="Optional" /></label></div></div>
      <div className="editor-section"><div className="section-title"><h2>Line items</h2><button className="text-link" onClick={() => setCatalogTarget('new')}><Package size={15} /> Add from catalog</button></div><div className="line-items">{invoice.lineItems.map((line, index) => <div className="line-row" key={line.id}><div className="line-description"><input aria-label={`Item ${index + 1} description`} value={line.description} onChange={e => updateLine(line.id, 'description', e.target.value)} placeholder="Describe your work" /><button aria-label={`Choose catalog item for line ${index + 1}`} onClick={() => setCatalogTarget(line.id)}><ChevronDown size={15} /></button></div><label className="line-field"><span>Quantity</span><input aria-label="Quantity" type="number" min="0" step="0.25" value={line.quantityMilli / 1000} onChange={e => { const quantity = Number(e.target.value); updateLine(line.id, 'quantityMilli', Number.isFinite(quantity) && quantity >= 0 ? Math.round(quantity * 1000) : 0) }} /></label><label className="line-field"><span>Unit price</span><div className="money-input"><span>{invoice.currency === 'EUR' ? '€' : invoice.currency}</span><MoneyField ariaLabel="Unit price" amount={line.unitPrice} currency={invoice.currency} onChange={value => updateLine(line.id, 'unitPrice', value)} /></div></label><label className="line-field"><span>Tax rate</span><select aria-label="Tax rate" value={line.taxRateBps} onChange={e => updateLine(line.id, 'taxRateBps', Number(e.target.value))}>{data.organization.taxRates.map(rate => <option value={rate.rateBps} key={rate.id}>{rate.rateBps / 100}%</option>)}{!data.organization.taxRates.some(rate => rate.rateBps === line.taxRateBps) && <option value={line.taxRateBps}>{line.taxRateBps / 100}%</option>}</select></label><div className="line-amount"><span>Amount</span><strong>{formatMoney(Math.round(line.quantityMilli * line.unitPrice / 1000), invoice.currency)}</strong></div><button className="icon-button" disabled={invoice.lineItems.length === 1} onClick={() => update('lineItems', invoice.lineItems.filter(i => i.id !== line.id))} aria-label="Remove line"><Trash2 size={16} /></button></div>)}</div><Button variant="ghost" icon={<Plus size={16} />} onClick={() => update('lineItems', [...invoice.lineItems, { id: uid(), description: '', quantityMilli: 1000, unitPrice: 0, taxRateBps: data.organization.defaultTaxRateBps, discountBps: 0 }])}>Add line item</Button>
      <div className="editor-totals"><div /><div><SummaryLine label="Subtotal" value={totals.subtotal} currency={invoice.currency} /><label className="summary-input"><span>Invoice discount</span><span><input type="number" min="0" max="100" value={invoice.invoiceDiscountBps / 100} onChange={e => { const rate = Number(e.target.value); update('invoiceDiscountBps', Number.isFinite(rate) && rate >= 0 ? Math.min(100, rate) * 100 : 0) }} />%</span></label><SummaryLine label="Tax" value={totals.tax} currency={invoice.currency} /><SummaryLine label="Total" value={totals.total} currency={invoice.currency} strong /></div></div></div>
      <div className="editor-section"><h2>Notes & payment</h2><label className="field"><span>Client-facing notes</span><textarea rows={3} value={invoice.notes} onChange={e => update('notes', e.target.value)} /></label><label className="field"><span>Payment instructions</span><textarea rows={4} value={invoice.paymentInstructions} onChange={e => update('paymentInstructions', e.target.value)} /></label></div>
      <div className="editor-section"><h2>Appearance</h2><label className="check-row"><input type="checkbox" checked={Boolean(invoice.appearance)} onChange={e => update('appearance', e.target.checked ? normalizeAppearance(resolveAppearance(invoice, data.organization)) : undefined)} /> Customize this invoice</label>{!invoice.appearance && <p className="form-hint">Using the organization appearance default. Content and payment data are unaffected by appearance changes.</p>}{invoice.appearance && <AppearanceControls value={invoice.appearance} onChange={next => update('appearance', normalizeAppearance(next))} onResetDefault={() => update('appearance', undefined)} resetDefaultLabel="Use organization default" />}</div>
    </section>{preview && <LivePreviewPane title="Live preview" subtitle={invoice.number} invoice={invoice} client={client} organization={data.organization} payments={[]} />}</div>

    {catalogTarget && <Modal title="Choose from catalog" description="Select an active product or service." onClose={() => setCatalogTarget(null)}><div className="modal-body catalog-picker">{data.products.filter(product => product.active && product.currency === invoice.currency).map(product => <button key={product.id} onClick={() => applyProduct(product)}><div><strong>{product.name}</strong><span>{product.description}</span></div><b>{formatMoney(product.unitPrice, product.currency)}</b><ArrowRight size={16} /></button>)}{!data.products.some(product => product.active && product.currency === invoice.currency) && <div className="mini-empty"><Package size={26} /><p>No active {invoice.currency} catalog items. Add one under Products & services, or type a custom line.</p></div>}</div></Modal>}
  </div>
}

function SummaryLine({ label, value, currency, locale = 'en-GB', strong }: { label: string; value: number; currency: string; locale?: string; strong?: boolean }) { return <div className={`summary-line ${strong ? 'strong' : ''}`}><span>{label}</span><b>{formatMoney(value, currency, locale)}</b></div> }

const TEMPLATE_META: { id: InvoiceTemplate; name: string }[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'modern', name: 'Modern' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'editorial', name: 'Editorial' },
  { id: 'bold', name: 'Bold' },
]

function TemplateThumb({ id, primary }: { id: InvoiceTemplate; primary: string }) {
  if (id === 'bold') return <span className="template-thumb tthumb-bold" aria-hidden="true" style={{ background: primary }}><i /><i /><i /><i /></span>
  if (id === 'modern') return <span className="template-thumb tthumb-modern" aria-hidden="true"><i /><i /><i /><i /><i /></span>
  if (id === 'minimal') return <span className="template-thumb tthumb-minimal" aria-hidden="true"><i /><i /><i /><i /></span>
  if (id === 'editorial') return <span className="template-thumb tthumb-editorial" aria-hidden="true"><i /><i /><i /><i /><i /></span>
  return <span className="template-thumb tthumb-classic" aria-hidden="true"><i /><i /><i /><i /><i /></span>
}

function AppearanceControls({ value, onChange, onResetDefault, resetDefaultLabel }: {
  value: InvoiceAppearance
  onChange: (next: InvoiceAppearance) => void
  onResetDefault?: () => void
  resetDefaultLabel?: string
}) {
  const set = <K extends keyof InvoiceAppearance>(key: K, next: InvoiceAppearance[K]) => onChange({ ...value, [key]: next })
  const applyPalette = (id: string) => { const palette = paletteById(id); if (palette) onChange({ ...value, paletteId: id, primaryColor: palette.primary, accentColor: palette.accent }) }
  const issues = accessibilityIssues(value)
  const knownPalette = paletteById(value.paletteId)
  const hexOr = (color: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(color) ? color : fallback
  return <div className="appearance-controls">
    <div className="appearance-group"><h3>Template</h3><div className="template-grid">{TEMPLATE_META.map(template => <button type="button" key={template.id} className={`template-card ${value.template === template.id ? 'selected' : ''}`} aria-pressed={value.template === template.id} onClick={() => set('template', template.id)}><TemplateThumb id={template.id} primary={value.primaryColor} />{template.name}</button>)}</div></div>
    <div className="appearance-group"><h3>Palette</h3><div className="palette-grid">{INVOICE_PALETTES.map(palette => <button type="button" key={palette.id} className={`palette-card ${value.paletteId === palette.id ? 'selected' : ''}`} aria-pressed={value.paletteId === palette.id} onClick={() => applyPalette(palette.id)}><span className="palette-mini" aria-hidden="true" style={{ background: palette.surface, borderColor: palette.border }}><i style={{ background: palette.primary }} /><i style={{ background: palette.accent }} /><i style={{ background: palette.muted }} /></span>{palette.name}</button>)}</div>
      <details className="advanced-colors"><summary>Custom colors</summary><div className="form-grid"><label className="field"><span>Primary color</span><div className="color-input"><input type="color" aria-label="Primary color" value={hexOr(value.primaryColor, '#2c5847')} onChange={e => set('primaryColor', e.target.value)} /><input aria-label="Primary color hex value" value={value.primaryColor} onChange={e => set('primaryColor', e.target.value)} /></div></label><label className="field"><span>Accent color</span><div className="color-input"><input type="color" aria-label="Accent color" value={hexOr(value.accentColor, '#c9a227')} onChange={e => set('accentColor', e.target.value)} /><input aria-label="Accent color hex value" value={value.accentColor} onChange={e => set('accentColor', e.target.value)} /></div></label></div>
        {issues.length > 0 && <div className="contrast-feedback"><span>{issues.join(' ')}</span><Button type="button" variant="secondary" onClick={() => onChange(makeAccessible(value))}>Make accessible</Button></div>}
        {knownPalette && (value.primaryColor !== knownPalette.primary || value.accentColor !== knownPalette.accent) && <Button type="button" variant="ghost" onClick={() => applyPalette(value.paletteId)}>Reset to palette</Button>}</details></div>
    <div className="appearance-group"><h3>Typography & layout</h3><div className="form-grid">
      <label className="field"><span>Font pair</span><select value={value.fontPair} onChange={e => set('fontPair', e.target.value as InvoiceFontPair)}>{INVOICE_FONTS.map(font => <option value={font.id} key={font.id}>{font.name}</option>)}</select></label>
      <label className="field"><span>Density</span><select value={value.density} onChange={e => set('density', e.target.value as InvoiceDensity)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
      <label className="field"><span>Logo position</span><select value={value.logoPosition} onChange={e => set('logoPosition', e.target.value as InvoiceLogoPosition)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label className="field"><span>Logo size</span><select value={value.logoScale} onChange={e => set('logoScale', e.target.value as InvoiceLogoScale)}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      <label className="field"><span>Accent style</span><select value={value.accentStyle} onChange={e => set('accentStyle', e.target.value as InvoiceAccentStyle)}><option value="rule">Top rule</option><option value="block">Total block</option><option value="none">None</option></select></label>{value.template === 'minimal' && <p className="form-hint">Minimal keeps totals unboxed; accent styles apply to rules.</p>}
    </div></div>
    <div className="appearance-group"><h3>Visible sections</h3>
      {([['showReference', 'Reference'], ['showClientTaxId', 'Client tax ID'], ['showPaymentDetails', 'Payment details'], ['showNotes', 'Notes'], ['showFooter', 'Footer']] as const).map(([key, label]) => <label className="check-row" key={key}><input type="checkbox" checked={value[key]} onChange={e => onChange({ ...value, [key]: e.target.checked })} /> {label}</label>)}
      {onResetDefault && <Button type="button" variant="ghost" onClick={onResetDefault}>{resetDefaultLabel || 'Reset to default'}</Button>}
    </div>
  </div>
}

function sampleInvoice(org: Organization): Invoice {
  return {
    id: 'sample-invoice', number: `${org.invoicePrefix}${org.nextInvoiceNumber}`, clientId: 'sample-client',
    status: 'sent', paymentStatus: 'unpaid', issueDate: today(), dueDate: datePlus(org.paymentTermsDays),
    currency: org.currency, reference: 'PO-2026-048',
    lineItems: [
      { id: 'sample-1', description: 'Brand strategy workshop', quantityMilli: 2000, unitPrice: 120000, taxRateBps: 1900, discountBps: 0 },
      { id: 'sample-2', description: 'Product design and prototyping', quantityMilli: 12500, unitPrice: 12500, taxRateBps: 1900, discountBps: 0 },
      { id: 'sample-3', description: 'Design system documentation', quantityMilli: 1000, unitPrice: 240000, taxRateBps: 1900, discountBps: 0 },
    ],
    invoiceDiscountBps: 0, additionalCharges: 0,
    notes: org.defaultNotes || 'Thank you for your business.',
    paymentTerms: `Payment due within ${org.paymentTermsDays} days.`,
    paymentInstructions: organizationPaymentDetails(org, org.defaultInvoiceLocale || (org.locale.startsWith('de') ? 'de-DE' : 'en-GB')),
    createdAt: '', updatedAt: '',
  }
}

function sampleClient(org: Organization): Client {
  return {
    id: 'sample-client', company: 'Example Client', contact: '', email: 'example-client@example.invalid',
    phone: '', address: '', taxId: '', currency: org.currency,
    notes: '', archived: false, createdAt: '', updatedAt: '',
  }
}

function LivePreviewPane({ title, subtitle, invoice, client, organization, payments }: { title: string; subtitle: string; invoice: Invoice; client?: Client; organization: Organization; payments: Payment[] }) {
  return <aside className="preview-pane"><div className="preview-label"><span>{title}</span><span>{subtitle}</span></div><div className="preview-doc"><InvoiceDocument invoice={invoice} client={client} organization={organization} payments={payments} /></div></aside>
}

interface DocModel {
  appearance: InvoiceAppearance
  fonts: { body: string; heading: string }
  copy: ReturnType<typeof invoiceCopy>
  locale: InvoiceDocumentLocale
  money: (value: number) => string
  totals: ReturnType<typeof invoiceTotals>
  businessName: string
  clientName: string
  logoDataUrl?: string
  logoSize: number
  foregroundOnPrimary: string
  def: TemplateDefinition
  accent: ResolvedAccent
}

function DocLogo({ model }: { model: DocModel }) {
  return <div className="paper-brand">{model.logoDataUrl ? <img src={model.logoDataUrl} alt="" style={{ width: model.logoSize, height: 'auto' }} /> : <span aria-hidden="true">L</span>}{model.businessName}</div>
}

function DocMark({ model }: { model: DocModel }) {
  return <div className="paper-brand paper-brand-mark-only">{model.logoDataUrl ? <img src={model.logoDataUrl} alt="" style={{ width: model.logoSize, height: 'auto' }} /> : <span aria-hidden="true">L</span>}</div>
}

function DocHeader({ model, invoice }: { model: DocModel; invoice: Invoice }) {
  const { appearance, fonts, copy, def } = model
  const logoSide = `doc-logo-${appearance.logoPosition}`
  const title = <h2 style={{ fontFamily: fonts.heading }}>{copy.invoice}</h2>
  if (def.header === 'band') return <div className={`doc-head doc-head-band ${logoSide}`} style={{ background: appearance.primaryColor, color: model.foregroundOnPrimary }}><DocLogo model={model} />{title}</div>
  if (def.header === 'stacked') return <div className={`doc-head doc-head-stacked ${logoSide}`}><div className="doc-topbrand"><DocLogo model={model} /></div><div className="doc-titlerow">{title}<strong>{invoice.number}</strong></div></div>
  if (def.header === 'quiet') return <div className={`doc-head doc-head-quiet ${logoSide}`}>{title}<DocLogo model={model} /></div>
  if (def.header === 'asymmetric') return <div className={`doc-head doc-head-asym ${logoSide}`}><div><small>{model.businessName}</small>{title}</div><div className="doc-asym-side"><DocMark model={model} /><strong>{invoice.number}</strong></div></div>
  return <div className={`doc-head doc-head-split ${logoSide}`}><DocLogo model={model} />{title}</div>
}

function DocMeta({ model, invoice, client }: { model: DocModel; invoice: Invoice; client?: Client }) {
  const { appearance, copy, locale, def } = model
  const snap = invoice.snapshot
  const clientBlock = <><small>{copy.billTo}</small><strong>{model.clientName}</strong><span>{snap?.clientContact || client?.contact}</span><span className="preserve-lines">{snap?.clientAddress || client?.address}</span>{appearance.showClientTaxId && (snap?.clientTaxId || client?.taxId) && <span>{snap?.clientTaxId || client?.taxId}</span>}{ (snap?.clientEmail || client?.email) && <span>{snap?.clientEmail || client?.email}</span>}</>
  const dates = <><span>{copy.issueDate} <b>{formatInvoiceDate(invoice.issueDate, locale)}</b></span><span>{copy.dueDate} <b>{formatInvoiceDate(invoice.dueDate, locale)}</b></span>{appearance.showReference && invoice.reference && <span>{copy.reference} <b>{invoice.reference}</b></span>}</>
  if (def.metadata === 'band') return <div className="paper-meta doc-meta-band"><div className="doc-band-client">{clientBlock}</div><div className="doc-band-facts"><div><small>{copy.issueDate}</small><b>{formatInvoiceDate(invoice.issueDate, locale)}</b></div><div><small>{copy.dueDate}</small><b>{formatInvoiceDate(invoice.dueDate, locale)}</b></div>{appearance.showReference && invoice.reference && <div><small>{copy.reference}</small><b>{invoice.reference}</b></div>}</div></div>
  if (def.metadata === 'quiet') return <div className="paper-meta doc-meta-quiet"><div>{clientBlock}</div><div><small>{copy.invoiceNumber}</small><strong>{invoice.number}</strong>{dates}</div></div>
  if (def.metadata === 'rail') return <div className="paper-meta doc-meta-rail"><div className="doc-rail-client">{clientBlock}</div><div><small>{copy.invoiceNumber}</small><strong>{invoice.number}</strong>{dates}</div></div>
  return <div className="paper-meta doc-meta-columns"><div>{clientBlock}</div><div><small>{copy.invoiceNumber}</small><strong>{invoice.number}</strong>{dates}</div></div>
}

function DocTable({ model, invoice }: { model: DocModel; invoice: Invoice }) {
  const { copy, locale, money, def } = model
  return <table className={`paper-table detail-lines table-${def.table}`}><thead><tr><th>{copy.description}</th><th>{copy.quantity}</th><th>{copy.rate}</th><th>{copy.tax}</th><th>{copy.amount}</th></tr></thead><tbody>{invoice.lineItems.map(line => <tr key={line.id}><td>{line.description || copy.fallbackItem}</td><td>{line.quantityMilli / 1000}</td><td>{money(line.unitPrice)}</td><td>{line.taxRateBps / 100}%</td><td>{money(Math.round(line.quantityMilli * line.unitPrice / 1000))}</td></tr>)}</tbody></table>
}

function DocTotals({ model, invoice }: { model: DocModel; invoice: Invoice }) {
  const { appearance, copy, locale, money, totals, def, accent } = model
  return <div className={`doc-totals totals-${def.totals}`}>{accent.totalsBar && <div className="doc-totals-bar" style={{ background: appearance.accentColor }} aria-hidden="true" />}<SummaryLine label={copy.subtotal} value={totals.subtotal} currency={invoice.currency} locale={locale} />{totals.discount > 0 && <SummaryLine label={copy.discount} value={-totals.discount} currency={invoice.currency} locale={locale} />}<SummaryLine label={copy.tax} value={totals.tax} currency={invoice.currency} locale={locale} /><SummaryLine label={copy.total} value={totals.total} currency={invoice.currency} locale={locale} strong />{totals.paid > 0 && <SummaryLine label={copy.payments} value={-totals.paid} currency={invoice.currency} locale={locale} />}<div className="balance"><span>{copy.balanceDue}</span><b>{money(totals.due)}</b></div></div>
}

function DocFooter({ model, invoice, organization }: { model: DocModel; invoice: Invoice; organization: Organization }) {
  const snap = invoice.snapshot
  const parts = [model.businessName, snap?.businessEmail || organization.email, snap?.businessTaxId || organization.taxId].filter(Boolean)
  if (!parts.length) return null
  return <div className="doc-foot"><span>{parts.join(' · ')}</span></div>
}

function InvoiceDocument({ invoice, client, organization, payments }: { invoice: Invoice; client?: Client; organization: Organization; payments: Payment[] }) {
  const totals = invoiceTotals(invoice, payments)
  const locale = invoiceLocale(invoice, organization)
  const copy = invoiceCopy(locale)
  const tokens = resolveTokens(invoice, organization)
  const { appearance, fonts } = tokens
  const money = (value: number) => formatMoney(value, invoice.currency, locale)
  const snap = invoice.snapshot
  const logoDataUrl = snap?.logoDataUrl || (!snap && organization.logoDataUrl) || undefined
  const logoSize = appearance.logoScale === "small" ? 22 : appearance.logoScale === "large" ? 44 : 32
  const def = templateDefinition(appearance.template)
  const accent = resolveAccent(appearance)
  const model: DocModel = { appearance, fonts, copy, locale, money, totals, businessName: snap?.businessName || organization.tradingName || organization.legalName || 'My business', clientName: snap?.clientName || client?.company || copy.selectClient, logoDataUrl, logoSize, foregroundOnPrimary: tokens.foregroundOnPrimary, def, accent }
  return <div className={`invoice-doc invoice-template-${appearance.template} accent-${appearance.accentStyle} paper-density-${appearance.density} paper-logo-${appearance.logoPosition} paper-logo-${appearance.logoScale}`} style={{ '--invoice-color': appearance.primaryColor, '--invoice-accent': appearance.accentColor, '--invoice-on-primary': tokens.foregroundOnPrimary, '--invoice-border': tokens.palette.border, fontFamily: fonts.body } as CSSProperties}>
    <DocHeader model={model} invoice={invoice} />
    {accent.accentRule && <div className="paper-rule" style={{ background: appearance.accentColor }} />}
    <DocMeta model={model} invoice={invoice} client={client} />
    <DocTable model={model} invoice={invoice} />
    <DocTotals model={model} invoice={invoice} />
    {(appearance.showNotes || appearance.showPaymentDetails) && <div className="doc-note"><small>{copy.notesPayment}</small>{appearance.showNotes && <p>{invoice.notes}</p>}{appearance.showPaymentDetails && <p className="preserve-lines">{invoice.paymentInstructions}</p>}</div>}
    {appearance.showFooter && <DocFooter model={model} invoice={invoice} organization={organization} />}
  </div>
}
function InvoiceDetail({ invoiceId, onBack, onEdit, notify }: { invoiceId: string; onBack: () => void; onEdit: () => void; notify: (m: string) => void }) {
  const { data } = useStore()
  const invoice = data.invoices.find(i => i.id === invoiceId)
  if (!invoice) return null
  return <InvoiceDetailView invoice={invoice} onBack={onBack} onEdit={onEdit} notify={notify} />
}

function InvoiceDetailView({ invoice, onBack, onEdit, notify }: { invoice: Invoice; onBack: () => void; onEdit: () => void; notify: (m: string) => void }) {
  const { data, transitionInvoice, addPayment, deletePayment } = useStore()
  const client = data.clients.find(c => c.id === invoice.clientId)
  const payments = data.payments.filter(p => p.invoiceId === invoice.id)
  const totals = invoiceTotals(invoice, data.payments)
  const status = effectiveStatus(invoice, data.payments)
  const locale = invoiceLocale(invoice, data.organization)
  const copy = invoiceCopy(locale)
  const money = (value: number) => formatMoney(value, invoice.currency, locale)
  const [paymentModal, setPaymentModal] = useState(false)
  const [shareModal, setShareModal] = useState(false)
  const [amount, setAmount] = useState((totals.due / (10 ** currencyDigits(invoice.currency))).toFixed(currencyDigits(invoice.currency)))
  const [paymentDate, setPaymentDate] = useState(today())
  const [method, setMethod] = useState('Bank transfer')
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const openPayment = () => { setAmount((totals.due / (10 ** currencyDigits(invoice.currency))).toFixed(currencyDigits(invoice.currency))); setPaymentDate(today()); setError(''); setPaymentModal(true) }
  const recordPayment = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const submittedDate = String(new FormData(e.currentTarget).get('paymentDate') || today()); const result = addPayment({ invoiceId: invoice.id, amount: parseMoney(amount, invoice.currency), date: submittedDate, method, reference, note: '' }); if (result.ok) { setPaymentModal(false); notify('Manual payment recorded. Balance updated.'); } else setError(result.error || 'Could not record payment.') }
  const shareText = locale === 'de-DE'
    ? `Guten Tag ${client?.contact || client?.company || ''},\n\nim Anhang finden Sie die Rechnung ${invoice.number} über ${money(totals.total)}. Der offene Betrag von ${money(totals.due)} ist am ${formatInvoiceDate(invoice.dueDate, locale)} fällig.\n\nVielen Dank und freundliche Grüße\n${data.organization.tradingName || data.organization.legalName || ''}`
    : `Hello ${client?.contact || client?.company || ''},\n\nPlease find invoice ${invoice.number} for ${money(totals.total)}. The remaining balance is ${money(totals.due)}, due ${formatInvoiceDate(invoice.dueDate, locale)}.\n\nThank you,\n${data.organization.tradingName || data.organization.legalName || ''}`
  const copyShare = async () => { await navigator.clipboard?.writeText(shareText); notify('Email-ready invoice message copied.'); setShareModal(false) }
  const openEmail = () => { window.open(`mailto:${encodeURIComponent(client?.email || '')}?subject=${encodeURIComponent(`${locale === 'de-DE' ? 'Rechnung' : 'Invoice'} ${invoice.number}`)}&body=${encodeURIComponent(shareText)}`); setShareModal(false) }
  return <div className="page invoice-detail"><div className="detail-top"><button className="back-button" onClick={onBack}><ArrowLeft size={18} /> Invoices</button><div className="detail-actions">{invoice.status !== 'draft' && <Button variant="secondary" icon={<Copy size={16} />} onClick={async () => { await navigator.clipboard?.writeText(invoice.number); notify('Invoice number copied.') }}>Copy number</Button>}<Button variant="secondary" icon={<Download size={16} />} onClick={() => { downloadInvoicePdf(invoice, client, data.organization, data.payments); notify('PDF generated and downloaded.') }}>PDF</Button>{invoice.status !== 'draft' && <Button variant="secondary" icon={<Share2 size={16} />} onClick={() => setShareModal(true)}>Share</Button>}{invoice.status === 'draft' ? <Button onClick={onEdit}>Edit draft</Button> : !['void', 'cancelled'].includes(invoice.status) && totals.due > 0 && <Button icon={<Plus size={16} />} onClick={openPayment}>Record payment</Button>}</div></div>
    <section className="detail-hero"><div><div className="detail-title"><h1>{invoice.number}</h1><StatusPill status={status} /></div><p>{client?.company} · Issued {shortDate(invoice.issueDate)}</p></div><div className="balance-large"><span>Balance due</span><strong>{formatMoney(totals.due, invoice.currency)}</strong><small>Due {shortDate(invoice.dueDate)}</small></div></section>
    {status === 'draft' && <div className="info-banner"><FileText size={18} /><div><strong>This invoice is still a draft</strong><span>Review required fields before reserving its number.</span></div><Button onClick={onEdit}>Review & finalize</Button></div>}
    {status === 'finalized' && <div className="info-banner"><Send size={18} /><div><strong>Ready to send</strong><span>The invoice is locked and has a unique number.</span></div><Button onClick={() => { transitionInvoice(invoice.id, 'sent'); notify('Invoice marked as sent.')}}>Mark as sent</Button></div>}
    <div className="detail-grid"><section className="card detail-card"><InvoiceDocument invoice={invoice} client={client} organization={data.organization} payments={data.payments} /></section><aside className="detail-side"><section className="card"><div className="card-head"><div><h2>Payments</h2><p>{payments.length ? `${payments.length} recorded` : 'No payments yet'}</p></div>{totals.due > 0 && !['draft', 'void', 'cancelled'].includes(invoice.status) && <button className="round-add" onClick={openPayment} aria-label="Record another payment"><Plus size={17} /></button>}</div>{payments.map(payment => <div className="payment-entry" key={payment.id}><div className="pay-icon"><ArrowDownRight size={17} /></div><div><strong>{formatMoney(payment.amount, invoice.currency)}</strong><span>{shortDate(payment.date)} · {payment.method}</span><small><span className="manual-label">Manual</span>{payment.reference}</small></div><button className="icon-button" onClick={() => { if (confirm('Remove this payment? The invoice balance will be recalculated and the action will be logged.')) { deletePayment(payment.id); notify('Payment removed and balance recalculated.') } }} aria-label="Delete payment"><Trash2 size={15} /></button></div>)}{!payments.length && <div className="mini-empty"><Banknote size={24} /><p>Record a payment when funds arrive.</p></div>}</section><section className="card"><div className="card-head"><div><h2>Activity</h2><p>Audit history</p></div></div><div className="timeline">{data.audit.filter(a => a.invoiceId === invoice.id).map(a => <div key={a.id}><span /><div><strong>{a.message}</strong><small>{new Date(a.at).toLocaleString('en-GB')} · {a.actor}</small></div></div>)}</div></section>{!['void','cancelled','draft'].includes(status) && <Button variant="danger" icon={<Archive size={16} />} onClick={() => { if (confirm('Void this invoice? Issued details will remain in the audit trail.')) { transitionInvoice(invoice.id, 'void'); notify('Invoice voided.') } }}>Void invoice</Button>}</aside>
    </div>
    {paymentModal && <Modal title="Record a payment" description="This will be clearly labelled as manually recorded." onClose={() => setPaymentModal(false)}><form onSubmit={recordPayment}><div className="modal-body"><div className="balance-callout"><span>Remaining balance</span><strong>{formatMoney(totals.due, invoice.currency)}</strong></div><label className="field"><span>Amount</span><div className="money-input modal-money"><span>{invoice.currency === 'EUR' ? '€' : invoice.currency}</span><input autoFocus value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></div></label><div className="form-grid"><label className="field"><span>Payment date</span><input name="paymentDate" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} required /></label><label className="field"><span>Method</span><select value={method} onChange={e => setMethod(e.target.value)}><option>Bank transfer</option><option>Cash</option><option>Card</option><option>Other</option></select></label></div><label className="field"><span>Reference</span><input value={reference} onChange={e => setReference(e.target.value)} placeholder="Transaction or bank reference" /></label>{error && <p className="form-error">{error}</p>}<p className="form-hint"><HelpCircle size={14} /> Manual entry only. No payment provider is connected.</p></div><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setPaymentModal(false)}>Cancel</Button><Button type="submit">Record payment</Button></div></form></Modal>}
    {shareModal && <Modal title="Share invoice" description="Use your Mac’s email app or copy a ready-to-send message." onClose={() => setShareModal(false)}><div className="modal-body"><div className="share-option"><div className="share-icon"><Send /></div><div><strong>Email-ready workflow</strong><span>Attach the downloaded PDF before sending. Ledgerly never claims the email was delivered.</span></div></div><div className="message-preview preserve-lines">{shareText}</div></div><div className="modal-actions"><Button variant="secondary" icon={<Copy size={16} />} onClick={copyShare}>Copy message</Button><Button icon={<Send size={16} />} onClick={openEmail}>Open email app</Button></div></Modal>}
  </div>
}

function ClientsPage({ notify }: { notify: (m: string) => void }) {
  const { data, saveClient } = useStore(); const [search, setSearch] = useState(''); const [editing, setEditing] = useState<Client | null>(null)
  const filtered = data.clients.filter(c => `${c.company} ${c.contact} ${c.email}`.toLowerCase().includes(search.toLowerCase()))
  const blank = (): Client => ({ id: uid(), company: '', contact: '', email: '', phone: '', address: '', taxId: '', currency: data.organization.currency, notes: '', archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  const save = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!editing?.company.trim()) return; const duplicate = data.clients.find(c => c.id !== editing.id && c.company.toLowerCase() === editing.company.toLowerCase()); if (duplicate && !confirm(`${duplicate.company} already exists. Save another client anyway?`)) return; saveClient({ ...editing, updatedAt: new Date().toISOString() }); setEditing(null); notify('Client saved.') }
  const importClientLogo = (file?: File) => {
    if (!file || !editing) return
    if (!file.type.startsWith('image/') || file.size > 2_000_000) { notify('Choose a PNG, JPEG, or SVG image under 2 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => setEditing(current => current ? { ...current, logoDataUrl: String(reader.result) } : current)
    reader.readAsDataURL(file)
  }
  return <div className="page"><div className="page-heading"><div><h1>Clients</h1><p>Keep client details and billing history together.</p></div><Button icon={<Plus size={18} />} onClick={() => setEditing(blank())}>Add client</Button></div><section className="card list-card"><div className="list-tools"><div className="search-field"><Search size={17} /><input aria-label="Search clients" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients" /></div><Button variant="secondary" icon={<Download size={16} />} onClick={() => { if (!exportCsv(data.clients, 'clients.csv')) { notify('No clients to export.'); return } notify('Clients exported.') }}>Export</Button></div>{filtered.length ? <div className="responsive-table clients-table"><table><thead><tr><th>Client</th><th>Contact</th><th className="amount-cell">Outstanding</th><th className="amount-cell">Total paid</th><th className="amount-cell">Invoices</th><th>Status</th><th /></tr></thead><tbody>{filtered.map(client => {
      const invs = data.invoices.filter(invoice => invoice.clientId === client.id)
      const outstandingParts = sumByCurrency(invs.map(invoice => ({ amount: invoiceTotals(invoice, data.payments).due, currency: invoice.currency })))
      const paidParts = sumByCurrency(data.payments.filter(payment => invs.some(invoice => invoice.id === payment.invoiceId)).map(payment => ({ amount: payment.amount, currency: paymentCurrency(payment, data.invoices, client.currency) })))
      return <tr key={client.id} tabIndex={0} onClick={() => setEditing(structuredClone(client))} onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); setEditing(structuredClone(client)) } }}>
        <td><div className="client-cell"><span>{client.logoDataUrl ? <img src={client.logoDataUrl} alt="" /> : client.company.slice(0, 2).toUpperCase()}</span><strong>{client.company}</strong></div></td>
        <td>{client.contact || '—'}{client.email && <small>{client.email}</small>}</td><td className="amount-cell">{formatCurrencyTotals(outstandingParts, client.currency)}</td><td className="amount-cell">{formatCurrencyTotals(paidParts, client.currency)}</td><td className="amount-cell">{invs.length}</td>
        <td><span className={`status ${client.archived ? 'status-draft' : 'status-paid'}`}><span className="status-dot" />{client.archived ? 'Archived' : 'Active'}</span></td><td><button className="icon-button" onClick={event => { event.stopPropagation(); setEditing(structuredClone(client)) }} aria-label={`Edit ${client.company}`}><ArrowRight size={16} /></button></td>
      </tr>
    })}</tbody></table></div> : <EmptyState icon={<Users />} title={data.clients.length ? 'No matching clients' : 'Your client directory starts here'} text={data.clients.length ? 'Try a different name or email address.' : 'Add your first client to start creating invoices.'} />}</section>
    {editing && <Modal title={data.clients.some(c => c.id === editing.id) ? 'Edit client' : 'Add client'} description="Billing details are snapshotted when invoices are finalized." onClose={() => setEditing(null)} wide><form onSubmit={save}><div className="modal-body form-grid"><div className="client-logo-field field-wide"><div className="large-avatar client-logo-preview">{editing.logoDataUrl ? <img src={editing.logoDataUrl} alt="Client logo preview" /> : (editing.company || 'CL').slice(0, 2).toUpperCase()}</div><div><strong>Client logo</strong><span>PNG, JPEG, or SVG up to 2 MB</span><label className="button secondary client-logo-button"><Upload size={15} />{editing.logoDataUrl ? 'Replace logo' : 'Choose logo'}<input hidden type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={e => importClientLogo(e.target.files?.[0])} /></label>{editing.logoDataUrl && <button type="button" className="text-link" onClick={() => setEditing({ ...editing, logoDataUrl: undefined })}>Remove</button>}</div></div><label className="field"><span>Company name *</span><input autoFocus value={editing.company} onChange={e => setEditing({ ...editing, company: e.target.value })} required /></label><label className="field"><span>Contact name</span><input value={editing.contact} onChange={e => setEditing({ ...editing, contact: e.target.value })} /></label><label className="field"><span>Email</span><input type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} /></label><label className="field"><span>Phone</span><input value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></label><label className="field field-wide"><span>Billing address</span><textarea rows={3} value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} /></label><label className="field"><span>Tax ID</span><input value={editing.taxId} onChange={e => setEditing({ ...editing, taxId: e.target.value })} /></label><label className="field"><span>Currency</span><select value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value })}>{['EUR','USD','GBP','CHF','JPY','CAD','AUD'].map(code => <option key={code}>{code}</option>)}</select></label><label className="field field-wide"><span>Internal notes</span><textarea rows={2} value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></label><label className="check-row field-wide"><input type="checkbox" checked={editing.archived} onChange={e => setEditing({ ...editing, archived: e.target.checked })} /> Archive this client</label></div><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit">Save client</Button></div></form></Modal>}
  </div>
}

function ProductsPage({ notify }: { notify: (m: string) => void }) {
  const { data, saveProduct } = useStore(); const [editing, setEditing] = useState<Product | null>(null); const [search, setSearch] = useState('')
  const blank = (): Product => ({ id: uid(), name: '', description: '', unit: 'hour', unitPrice: 0, currency: data.organization.currency, taxRate: data.organization.defaultTaxRateBps / 100, active: true })
  const save = (e: FormEvent) => { e.preventDefault(); if (!editing) return; saveProduct(editing); setEditing(null); notify('Catalog item saved.') }
  const filteredProducts = data.products.filter(product => `${product.name} ${product.description}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page"><div className="page-heading"><div><h1>Products & services</h1><p>Reusable items make invoice creation faster.</p></div><Button icon={<Plus size={18} />} onClick={() => setEditing(blank())}>Add item</Button></div><section className="card list-card"><div className="list-tools"><div className="search-field"><Search size={17} /><input aria-label="Search catalog" placeholder="Search catalog" value={search} onChange={e => setSearch(e.target.value)} /></div><span className="subtle-label">{data.products.filter(p => p.active).length} active items</span></div>{filteredProducts.length ? <div className="responsive-table"><table><thead><tr><th>Name</th><th>Unit</th><th>Tax</th><th>Status</th><th className="amount-cell">Price</th><th /></tr></thead><tbody>{filteredProducts.map(p => <tr key={p.id} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setEditing(structuredClone(p)) } }} onClick={() => setEditing(structuredClone(p))}><td><div className="product-name"><div><Package size={17} /></div><span><strong>{p.name}</strong><small>{p.description}</small></span></div></td><td>Per {p.unit}</td><td>{p.taxRate}%</td><td><span className={`status ${p.active ? 'status-paid' : 'status-draft'}`}><span className="status-dot" />{p.active ? 'Active' : 'Archived'}</span></td><td className="amount-cell"><strong>{formatMoney(p.unitPrice, p.currency)}</strong></td><td><ArrowRight size={16} /></td></tr>)}</tbody></table></div> : <EmptyState icon={<Package />} title={data.products.length ? 'No matching items' : 'Build your catalog'} text={data.products.length ? 'Try a different name or description.' : 'Save the products and services you invoice regularly.'} />}</section>{editing && <Modal title={data.products.some(p => p.id === editing.id) ? 'Edit catalog item' : 'Add catalog item'} onClose={() => setEditing(null)}><form onSubmit={save}><div className="modal-body"><label className="field"><span>Name *</span><input autoFocus required value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label><label className="field"><span>Description</span><textarea rows={2} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label><div className="form-grid"><label className="field"><span>Unit</span><select value={editing.unit} onChange={e => setEditing({ ...editing, unit: e.target.value })}><option>hour</option><option>day</option><option>item</option><option>project</option><option>month</option></select></label><label className="field"><span>Price</span><MoneyField ariaLabel="Price" amount={editing.unitPrice} currency={editing.currency} onChange={value => setEditing({ ...editing, unitPrice: value })} /></label><label className="field"><span>Currency</span><select value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value, unitPrice: convertMinorUnits(editing.unitPrice, editing.currency, e.target.value) })}>{['EUR','USD','GBP','CHF','JPY','CAD','AUD'].map(code => <option key={code}>{code}</option>)}</select></label><label className="field"><span>Tax rate</span><select value={editing.taxRate} onChange={e => setEditing({ ...editing, taxRate: Number(e.target.value) })}>{data.organization.taxRates.map(rate => <option value={rate.rateBps / 100} key={rate.id}>{rate.name} — {rate.rateBps / 100}%</option>)}{!data.organization.taxRates.some(rate => rate.rateBps === editing.taxRate * 100) && <option value={editing.taxRate}>{editing.taxRate}%</option>}</select></label></div><label className="check-row"><input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} /> Active in catalog</label></div><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit">Save item</Button></div></form></Modal>}</div>
}

function PaymentsPage({ openInvoice, notify }: { openInvoice: (id: string) => void; notify: (m: string) => void }) {
  const { data } = useStore()
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<'all' | Payment['source']>('all')
  const receivedParts = sumByCurrency(data.payments.map(payment => ({ amount: payment.amount, currency: paymentCurrency(payment, data.invoices, data.organization.currency) })))
  const monthParts = sumByCurrency(data.payments.filter(p => p.date.slice(0, 7) === today().slice(0, 7)).map(payment => ({ amount: payment.amount, currency: paymentCurrency(payment, data.invoices, data.organization.currency) })))
  const visiblePayments = data.payments.filter(payment => {
    const invoice = data.invoices.find(item => item.id === payment.invoiceId)
    const client = data.clients.find(item => item.id === invoice?.clientId)
    const matchesSearch = `${client?.company || ''} ${invoice?.number || ''} ${payment.method} ${payment.reference}`.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (source === 'all' || payment.source === source)
  })
  return <div className="page"><div className="page-heading"><div><h1>Payments</h1><p>Every payment, with its source and linked invoice.</p></div><Button variant="secondary" icon={<Download size={16} />} onClick={() => { if (!exportCsv(visiblePayments, 'payments.csv')) { notify('No payments to export.'); return } notify('Visible payments exported.') }}>Export CSV</Button></div><section className="metrics-grid three"><Metric label="Payments recorded" value={formatCurrencyTotals(receivedParts, data.organization.currency)} detail={`${data.payments.length} transactions`} trend="All time" /><Metric label="This month" value={formatCurrencyTotals(monthParts, data.organization.currency)} detail="By payment date" trend="Cash received" /><Metric label="Manual entries" value={data.payments.filter(p=>p.source==='manual').length.toString()} detail="Not provider verified" trend="Review sources" /></section><section className="card list-card payment-history-card"><div className="card-head"><div><h2>Payment history</h2><p>{visiblePayments.length === data.payments.length ? 'Most recent first' : `${visiblePayments.length} of ${data.payments.length} payments`}</p></div></div><div className="list-tools"><div className="search-field"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, invoice, method, or reference" aria-label="Search payments" /></div><label className="payment-source-filter"><span>Source</span><select value={source} onChange={e => setSource(e.target.value as typeof source)}><option value="all">All sources</option><option value="manual">Manual</option><option value="reconciled">Reconciled</option><option value="provider">Provider</option></select></label>{(search || source !== 'all') && <Button variant="ghost" onClick={() => { setSearch(''); setSource('all') }}>Clear</Button>}</div>{visiblePayments.length ? <div className="responsive-table"><table><thead><tr><th>Date</th><th>Client</th><th>Invoice</th><th>Method</th><th>Source</th><th className="amount-cell">Amount</th></tr></thead><tbody>{visiblePayments.map(payment => { const invoice=data.invoices.find(item=>item.id===payment.invoiceId); const client=data.clients.find(item=>item.id===invoice?.clientId); return <tr key={payment.id} onClick={()=>invoice&&openInvoice(invoice.id)} tabIndex={invoice ? 0 : undefined} onKeyDown={event => event.key === 'Enter' && invoice && openInvoice(invoice.id)}><td>{shortDate(payment.date)}</td><td><strong>{client?.company}</strong></td><td>{invoice?.number}</td><td>{payment.method}<small>{payment.reference}</small></td><td><span className="source-pill">{payment.source === 'manual' ? 'Manually recorded' : payment.source}</span></td><td className="amount-cell"><strong className="positive">+{formatMoney(payment.amount,invoice?.currency)}</strong></td></tr>})}</tbody></table></div> : <EmptyState icon={<Banknote />} title={data.payments.length ? 'No matching payments' : 'No payments recorded'} text={data.payments.length ? 'Try a different search or clear the source filter.' : 'Payments you record on finalized invoices will appear here.'} />}</section></div>
}

function ReportsPage({ notify }: { notify: (m: string) => void }) {
  const { data } = useStore()
  const [range, setRange] = useState<'month' | 'quarter' | 'year' | 'all'>('year')
  const now = new Date()
  const start = range === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : range === 'quarter' ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1) : range === 'year' ? new Date(now.getFullYear(), 0, 1) : null
  const startDate = start ? localDate(start) : ''
  const endDate = today()
  const rows = data.invoices.filter(invoice => (!startDate || invoice.issueDate >= startDate) && invoice.issueDate <= endDate).map(i => ({ i, t: invoiceTotals(i, data.payments), s: effectiveStatus(i, data.payments) }))
  const outstanding = rows.filter(r => !['draft','paid','void','cancelled'].includes(r.s))
  const receivedParts = sumByCurrency(data.payments.filter(payment => (!startDate || payment.date >= startDate) && payment.date <= endDate).map(payment => ({ amount: payment.amount, currency: paymentCurrency(payment, data.invoices, data.organization.currency) })))
  const invoicedParts = sumByCurrency(rows.filter(r=>!['draft','void','cancelled'].includes(r.s)).map(r => ({ amount: r.t.total, currency: r.i.currency })))
  const maxClient = Math.max(...data.clients.map(c => rows.filter(r=>r.i.clientId===c.id).reduce((s,r)=>s+r.t.total,0)), 1)
  const overdueDays = (dueDate: string) => Math.floor((Date.now() - new Date(`${dueDate}T12:00:00`).getTime()) / 864e5)
  const bucketParts = (match: (days: number) => boolean) => sumByCurrency(outstanding.filter(r => match(overdueDays(r.i.dueDate))).map(row => ({ amount: row.t.due, currency: row.i.currency })))
  const agingCurrent = bucketParts(days => days <= 0)
  const aging30 = bucketParts(days => days >= 1 && days <= 30)
  const agingOld = bucketParts(days => days > 30)
  const allAging = sumByCurrency([...agingCurrent, ...aging30, ...agingOld])
  const chartCurrency = allAging.reduce((top, part) => part.amount > top.amount ? part : top, { currency: data.organization.currency, amount: 0 }).currency
  const chartAmount = (parts: CurrencyTotal[]) => parts.find(part => part.currency === chartCurrency)?.amount || 0
  const agingChartTotal = Math.max(chartAmount(agingCurrent) + chartAmount(aging30) + chartAmount(agingOld), 1)
  const agingCurrentEnd = chartAmount(agingCurrent) / agingChartTotal * 100
  const aging30End = (chartAmount(agingCurrent) + chartAmount(aging30)) / agingChartTotal * 100
  const agingChart = `conic-gradient(#315f51 0 ${agingCurrentEnd}%, #e1bf68 ${agingCurrentEnd}% ${aging30End}%, #ddd ${aging30End}% 100%)`
  return <div className="page"><div className="page-heading"><div><h1>Reports</h1><p>Understand invoiced revenue separately from cash received.</p></div><div className="heading-actions"><label className="report-range"><CalendarDays size={15} /><select aria-label="Report period" value={range} onChange={e => setRange(e.target.value as typeof range)}><option value="month">This month</option><option value="quarter">This quarter</option><option value="year">This year</option><option value="all">All time</option></select></label><Button variant="secondary" icon={<Download size={16} />} onClick={() => { if (!exportCsv(rows.map(r=>({invoice:r.i.number,issued:r.i.issueDate,invoiced:r.t.total,paid:r.t.paid,outstanding:r.t.due})), 'revenue-report.csv')) { notify('Nothing to export.'); return } notify('Report exported.') }}>Export report</Button></div></div><div className="report-note"><HelpCircle size={16} /> Invoiced revenue uses issue date; cash received uses payment date. Values exclude drafts, voids, and cancellations.</div><section className="metrics-grid three"><Metric label="Invoiced revenue" value={formatCurrencyTotals(invoicedParts, data.organization.currency)} detail="Issued invoices" trend="Accrual view" /><Metric label="Cash received" value={formatCurrencyTotals(receivedParts, data.organization.currency)} detail="Recorded payments" trend="Cash view" /><Metric label="Receivables" value={formatCurrencyTotals(allAging, data.organization.currency)} detail={`${outstanding.length} open ${outstanding.length === 1 ? 'invoice' : 'invoices'}`} trend="Current balance" /></section><section className="reports-grid"><article className="card report-card"><div className="card-head"><div><h2>Revenue by client</h2><p>Issued invoice totals</p></div></div><div className="h-bars">{data.clients.map(c => { const valueParts=sumByCurrency(rows.filter(r=>r.i.clientId===c.id).map(r=>({amount:r.t.total,currency:r.i.currency}))); const value=valueParts.reduce((s,p)=>s+p.amount,0); return <div key={c.id}><span>{c.company}</span><div><i style={{width:`${value/maxClient*100}%`}} /></div><strong>{formatCurrencyTotals(valueParts, c.currency)}</strong></div>})}{!data.clients.length && <div className="mini-empty"><Users size={24} /><p>Client revenue will appear here.</p></div>}</div></article><article className="card report-card"><div className="card-head"><div><h2>Receivables aging</h2><p>By days past due</p></div></div><div className="donut-wrap"><div className="donut" style={{ background: agingChart }}><div><strong>{formatCurrencyTotals(allAging, data.organization.currency)}</strong><span>open</span></div></div><div className="legend"><span><i className="age-current" /> Current <b>{formatCurrencyTotals(agingCurrent, data.organization.currency)}</b></span><span><i className="age-30" /> 1–30 days <b>{formatCurrencyTotals(aging30, data.organization.currency)}</b></span><span><i className="age-old" /> 31+ days <b>{formatCurrencyTotals(agingOld, data.organization.currency)}</b></span></div></div></article><article className="card report-card full"><div className="card-head"><div><h2>Invoice status distribution</h2><p>Count and value by current effective status</p></div></div><div className="status-report">{(['draft','sent','partial','overdue','paid'] as InvoiceStatus[]).map(s => { const group=rows.filter(r=>r.s===s); return <div key={s}><StatusPill status={s} /><strong>{group.length}</strong><span>{formatCurrencyTotals(sumByCurrency(group.map(r=>({amount:r.t.total,currency:r.i.currency}))), data.organization.currency)}</span></div>})}</div></article></section><p className="legal-note">Ledgerly reports are operational summaries and are not a substitute for professional accounting or tax advice.</p></div>
}

const updatePhaseLabel: Record<string, string> = {
  current: 'You are up to date.',
  checking: 'Checking for updates…',
  available: 'Update found…',
  downloading: 'Downloading update…',
  ready: 'Update ready — restart Ledgerly to apply it.',
  failed: 'Update check failed. Ledgerly keeps running the current version and retries automatically.',
  disabled: 'Updates are not configured in this build.',
}

function UpdateSection({ notify }: { notify: (m: string) => void }) {
  const bridge = typeof window !== 'undefined' ? window.ledgerlyUpdates : undefined
  const [info, setInfo] = useState<UpdateStatusInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState(() => { try { return localStorage.getItem('ledgerly-skipped-update') || '' } catch { return '' } })
  useEffect(() => { bridge?.status().then(setInfo).catch(() => undefined) }, [])
  const checkNow = async () => {
    if (!bridge || busy) return
    setBusy(true)
    try {
      const next = await bridge.check(FRONTEND_VERSION)
      setInfo(next)
      if (next.phase === 'current') notify('Ledgerly is up to date.')
    } catch { notify('Update check failed.') } finally { setBusy(false) }
  }
  const restartNow = async () => {
    if (!bridge) return
    const result = await bridge.restart().catch(() => ({ ok: false as const, reason: 'unknown' }))
    if (!result.ok && result.reason === 'dirty') notify('Save or discard your invoice changes before restarting.')
  }
  const skipVersion = () => {
    if (!info?.pending) return
    try { localStorage.setItem('ledgerly-skipped-update', info.pending) } catch {}
    setSkipped(info.pending)
  }
  const shell = info?.shell || (bridge ? '…' : SHELL_VERSION)
  const skippedActive = info?.pending ? skipped === info.pending : false
  return <section className="card settings-section"><div className="settings-head"><div><h2>Updates</h2><p>Local frontend updates. No accounts, no telemetry, no forced restarts.</p></div><span className="version-badge">Frontend {FRONTEND_VERSION}</span></div>
    <div className="data-action-list"><div><div><strong>Frontend {FRONTEND_VERSION}</strong><span>Shell {bridge ? shell : `${SHELL_VERSION} (browser build)`}</span></div></div>
      {!bridge && <div><div><strong>Static browser build</strong><span>This copy updates when its host publishes a new bundle; your data stays in this browser.</span></div></div>}
      {bridge && <div><div><strong>{info ? updatePhaseLabel[info.phase] : 'Checking update status…'}</strong><span>{info?.lastCheck ? `Last checked ${new Date(info.lastCheck).toLocaleString()}` : 'Not checked yet this session.'}{info?.phase === 'failed' && info.failure ? ` · ${info.failure}` : ''}</span></div><div className="data-actions"><Button variant="secondary" disabled={busy} onClick={checkNow}>Check now</Button>{info?.phase === 'ready' && info.pending && <Button onClick={restartNow}>Restart to update</Button>}</div></div>}
      {bridge && info?.phase === 'ready' && info.pending && !info.security && !skippedActive && <div><div><strong>Version {info.pending} staged</strong><span>Applies on restart after a healthy boot check; the previous version is kept for rollback.</span></div><Button variant="ghost" onClick={skipVersion}>Skip this version</Button></div>}
      {bridge && info && info.notes.length > 0 && (info.phase === 'ready' || info.phase === 'available') && !skippedActive && <div><div><strong>Release notes</strong><span>{info.notes.join(' ')}</span></div></div>}
    </div>
  </section>
}

function SettingsPage({ notify }: { notify: (m: string) => void }) {
  const { data, hasRecovery, saveOrganization, importData, restoreRecovery } = useStore()
  const [org, setOrg] = useState(structuredClone(data.organization))
  const [brandDraft, setBrandDraft] = useState(data.organization.brandColor)
  const [section, setSection] = useState<'business' | 'invoice' | 'appearance' | 'taxes' | 'reminders' | 'team' | 'data' | 'updates' | 'changes'>('business')
  const [newTaxName, setNewTaxName] = useState('')
  const [newTaxRate, setNewTaxRate] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const downloadBackup = () => {
    downloadText(JSON.stringify(data, null, 2), 'ledgerly-backup.json', 'application/json')
    notify('Full backup downloaded.')
  }
  const importBackup = (file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as AppData
        if (!parsed.organization || !Array.isArray(parsed.invoices) || !Array.isArray(parsed.clients)) throw new Error()
        if (confirm(`Import ${parsed.invoices.length} invoices and ${parsed.clients.length} clients? This replaces local data.`)) {
          const restoredOrganization = { ...structuredClone(blankData.organization), ...parsed.organization, reminders: { ...blankData.organization.reminders, ...(parsed.organization.reminders || {}) }, taxRates: parsed.organization.taxRates?.length ? parsed.organization.taxRates : structuredClone(blankData.organization.taxRates) }
          importData(parsed)
          setOrg(restoredOrganization)
          setBrandDraft(restoredOrganization.brandColor)
          notify('Backup imported successfully.')
        }
      } catch { notify('That file is not a valid Ledgerly backup.') }
    }
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }
  const importLogo = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 2_000_000) { notify('Choose a PNG, JPEG, or SVG image under 2 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => setOrg(current => ({ ...current, logoDataUrl: String(reader.result) }))
    reader.readAsDataURL(file)
  }
  const settingsSections = [
    { id: 'business' as const, label: 'Business profile', icon: <Building2 /> },
    { id: 'invoice' as const, label: 'Invoice defaults', icon: <Receipt /> },
    { id: 'appearance' as const, label: 'Invoice appearance', icon: <Palette /> },
    { id: 'taxes' as const, label: 'Taxes & currency', icon: <CircleDollarSign /> },
    { id: 'reminders' as const, label: 'Reminders', icon: <Bell /> },
    { id: 'team' as const, label: 'Owner & access', icon: <UserRound /> },
    { id: 'data' as const, label: 'Data & privacy', icon: <FileArchive /> },
    { id: 'updates' as const, label: 'Updates', icon: <Download /> },
    { id: 'changes' as const, label: "What's new", icon: <FileText /> },
  ]
  const save = () => { if (!/^#[0-9a-f]{6}$/i.test(brandDraft)) { notify('Enter a six-digit brand colour such as #173f35.'); return } const next = { ...org, brandColor: brandDraft }; setOrg(next); saveOrganization(next); notify('Settings saved.') }
  return <div className="page settings-page">
    <div className="page-heading"><div><h1>Settings</h1><p>Manage your business identity, defaults, and local data.</p></div><Button icon={<Check size={17} />} onClick={save}>Save changes</Button></div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">{settingsSections.map(item => <button key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.icon}{item.label}<ArrowRight size={14} /></button>)}</nav>
      <div className="settings-content">
        <label className="field settings-mobile-nav"><span>Settings section</span><select value={section} onChange={e => setSection(e.target.value as typeof section)}>{settingsSections.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        {section === 'business' && <section className="card settings-section"><div className="settings-head"><div><h2>Business profile</h2><p>This information appears on finalized invoices.</p></div><div className="logo-upload">{org.logoDataUrl ? <img src={org.logoDataUrl} alt="Business logo" /> : (org.tradingName || org.legalName || 'MB').slice(0, 2).toUpperCase()}<button aria-label="Upload business logo" onClick={() => logoRef.current?.click()}><Upload size={14} /></button><input ref={logoRef} hidden type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={e => importLogo(e.target.files?.[0])} /></div></div><div className="form-grid"><label className="field"><span>Legal business name</span><input value={org.legalName} onChange={e => setOrg({ ...org, legalName: e.target.value })} /></label><label className="field"><span>Trading name</span><input value={org.tradingName} onChange={e => setOrg({ ...org, tradingName: e.target.value })} /></label><label className="field field-wide"><span>Business address</span><textarea rows={3} value={org.address} onChange={e => setOrg({ ...org, address: e.target.value })} /></label><label className="field"><span>Business email</span><input type="email" value={org.email} onChange={e => setOrg({ ...org, email: e.target.value })} /></label><label className="field"><span>Phone</span><input value={org.phone} onChange={e => setOrg({ ...org, phone: e.target.value })} /></label><label className="field"><span>Website</span><input value={org.website} onChange={e => setOrg({ ...org, website: e.target.value })} /></label><label className="field"><span>Tax / VAT ID</span><input value={org.taxId} onChange={e => setOrg({ ...org, taxId: e.target.value })} /></label></div>{org.logoDataUrl && <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setOrg({ ...org, logoDataUrl: undefined })}>Remove logo</Button>}</section>}
        {section === 'invoice' && <section className="card settings-section"><div className="settings-head"><div><h2>Invoice defaults</h2><p>These values are copied into each new draft and remain editable until finalization.</p></div></div><div className="form-grid"><label className="field"><span>Payment terms (days)</span><input min="0" max="365" type="number" value={org.paymentTermsDays} onChange={e => { const days = Number(e.target.value); setOrg({ ...org, paymentTermsDays: Number.isFinite(days) && days >= 0 ? Math.min(365, Math.round(days)) : 0 }) }} /></label><label className="field"><span>Brand colour</span><div className="color-input"><input type="color" aria-label="Brand colour" value={org.brandColor} onChange={e => { setBrandDraft(e.target.value); setOrg({ ...org, brandColor: e.target.value }) }} /><input aria-label="Brand colour hex value" value={brandDraft} onChange={e => setBrandDraft(e.target.value)} onBlur={() => { if (!/^#[0-9a-f]{6}$/i.test(brandDraft)) { setBrandDraft(org.brandColor); notify('Brand colour must use six hexadecimal digits.') } }} /></div></label><label className="field"><span>Invoice prefix</span><input value={org.invoicePrefix} maxLength={12} onChange={e => setOrg({ ...org, invoicePrefix: e.target.value.toUpperCase() })} /></label><label className="field"><span>Next invoice number</span><input min="1" type="number" value={org.nextInvoiceNumber} onChange={e => { const next = Number(e.target.value); setOrg({ ...org, nextInvoiceNumber: Number.isFinite(next) && next >= 1 ? Math.round(next) : 1 }) }} /></label><label className="field field-wide"><span>Default client-facing note</span><textarea rows={3} value={org.defaultNotes} onChange={e => setOrg({ ...org, defaultNotes: e.target.value })} /></label><div className="field field-wide bank-details-heading"><span>Bank details on every new invoice</span><small>These are formatted automatically in English or German.</small></div><label className="field"><span>Account holder</span><input value={org.accountHolder || ''} onChange={e => setOrg({ ...org, accountHolder: e.target.value })} placeholder={org.legalName || 'Account holder name'} /></label><label className="field"><span>Bank name</span><input value={org.bankName || ''} onChange={e => setOrg({ ...org, bankName: e.target.value })} placeholder="Optional" /></label><label className="field"><span>IBAN</span><input value={org.iban || ''} onChange={e => setOrg({ ...org, iban: e.target.value.toUpperCase() })} placeholder="DE00 0000 0000 0000 0000 00" autoCapitalize="characters" /></label><label className="field"><span>BIC / SWIFT</span><input value={org.bic || ''} onChange={e => setOrg({ ...org, bic: e.target.value.toUpperCase() })} placeholder="Optional" autoCapitalize="characters" /></label><label className="field field-wide"><span>Additional payment instructions</span><textarea rows={4} value={org.bankInstructions} onChange={e => setOrg({ ...org, bankInstructions: e.target.value })} placeholder="For example: Please include the invoice number as the payment reference." /></label></div><div className="settings-preview"><span>Next invoice</span><strong>{org.invoicePrefix}{org.nextInvoiceNumber}</strong><i style={{ background: org.brandColor }} /></div></section>}
        {section === 'appearance' && <div className="appearance-layout"><section className="card settings-section"><div className="settings-head"><div><h2>Invoice appearance</h2><p>Defaults for every new draft. Finalized invoices keep the appearance they were finalized with.</p></div></div><AppearanceControls value={org.invoiceAppearanceDefaults ?? legacyAppearanceFromColor(org.brandColor)} onChange={next => setOrg({ ...org, invoiceAppearanceDefaults: normalizeAppearance(next) })} onResetDefault={() => setOrg({ ...org, invoiceAppearanceDefaults: undefined })} resetDefaultLabel="Reset to brand colour" /></section><LivePreviewPane title="Live preview" subtitle={sampleInvoice(org).number} invoice={sampleInvoice(org)} client={sampleClient(org)} organization={org} payments={[]} /></div>}
        {section === 'taxes' && <section className="card settings-section"><div className="settings-head"><div><h2>Taxes & currency</h2><p>Configure display preferences and reusable tax rates.</p></div></div><div className="form-grid"><label className="field"><span>Default currency</span><select value={org.currency} onChange={e => setOrg({ ...org, currency: e.target.value })}>{['EUR','USD','GBP','CHF','JPY','CAD','AUD'].map(code => <option key={code}>{code}</option>)}</select></label><label className="field"><span>Default tax rate</span><select value={org.defaultTaxRateBps} onChange={e => setOrg({ ...org, defaultTaxRateBps: Number(e.target.value) })}>{org.taxRates.map(rate => <option value={rate.rateBps} key={rate.id}>{rate.name} — {rate.rateBps / 100}%</option>)}{!org.taxRates.some(rate => rate.rateBps === org.defaultTaxRateBps) && <option value={org.defaultTaxRateBps}>{org.defaultTaxRateBps / 100}%</option>}</select></label><label className="field"><span>Default invoice language</span><select value={org.defaultInvoiceLocale || (org.locale.startsWith('de') ? 'de-DE' : 'en-GB')} onChange={e => setOrg({ ...org, defaultInvoiceLocale: e.target.value as InvoiceDocumentLocale })}><option value="en-GB">English</option><option value="de-DE">Deutsch</option></select></label><label className="field"><span>Regional format</span><select value={org.locale} onChange={e => setOrg({ ...org, locale: e.target.value })}><option value="en-GB">English (UK)</option><option value="de-DE">Deutsch</option><option value="en-US">English (US)</option><option value="fr-FR">Français</option></select></label><label className="field"><span>Time zone</span><input value={org.timeZone} onChange={e => setOrg({ ...org, timeZone: e.target.value })} /></label></div><div className="tax-list"><div className="section-title"><h3>Saved tax rates</h3><span>{org.taxRates.length} rates</span></div>{org.taxRates.map(rate => <div className="tax-row" key={rate.id}><div><strong>{rate.name}</strong><span>{rate.rateBps / 100}%</span></div>{rate.rateBps === org.defaultTaxRateBps ? <em>Default</em> : <button onClick={() => setOrg({ ...org, taxRates: org.taxRates.filter(item => item.id !== rate.id) })} aria-label={`Remove ${rate.name}`}><Trash2 size={15} /></button>}</div>)}<div className="add-tax"><input aria-label="New tax name" placeholder="Name, e.g. Standard" value={newTaxName} onChange={e => setNewTaxName(e.target.value)} /><input aria-label="New tax percentage" type="number" min="0" max="100" step="0.01" placeholder="Rate %" value={newTaxRate} onChange={e => setNewTaxRate(e.target.value)} /><Button variant="secondary" onClick={() => { const rate = Math.round(Number(newTaxRate) * 100); if (!newTaxName.trim() || !Number.isFinite(rate) || rate < 0 || rate > 10000) { notify('Enter a name and a rate from 0% to 100%.'); return } setOrg({ ...org, taxRates: [...org.taxRates, { id: uid(), name: newTaxName.trim(), rateBps: rate }] }); setNewTaxName(''); setNewTaxRate('') }}>Add rate</Button></div></div></section>}
        {section === 'reminders' && <section className="card settings-section"><div className="settings-head"><div><h2>Reminder preferences</h2><p>Ledgerly prepares reminders locally. It never claims an email was sent.</p></div></div><label className="toggle-row"><div><strong>Show reminder notifications</strong><span>Flag upcoming and overdue invoices inside Ledgerly.</span></div><input type="checkbox" role="switch" checked={org.reminders.enabled} onChange={e => setOrg({ ...org, reminders: { ...org.reminders, enabled: e.target.checked } })} /></label><div className={`reminder-options ${org.reminders.enabled ? '' : 'disabled'}`}><label className="field"><span>Upcoming due-date notice</span><div className="suffix-input"><input disabled={!org.reminders.enabled} min="1" max="30" type="number" value={org.reminders.dueSoonDays} onChange={e => setOrg({ ...org, reminders: { ...org.reminders, dueSoonDays: Number(e.target.value) } })} /><span>days before</span></div></label><label className="field"><span>Overdue follow-up</span><div className="suffix-input"><input disabled={!org.reminders.enabled} min="1" max="90" type="number" value={org.reminders.overdueFollowUpDays} onChange={e => setOrg({ ...org, reminders: { ...org.reminders, overdueFollowUpDays: Number(e.target.value) } })} /><span>days after</span></div></label><label className="check-row"><input disabled={!org.reminders.enabled} type="checkbox" checked={org.reminders.includeDueToday} onChange={e => setOrg({ ...org, reminders: { ...org.reminders, includeDueToday: e.target.checked } })} /> Include invoices due today</label></div><div className="info-panel"><Bell size={18} /><div><strong>Local-only behavior</strong><p>Reminders appear when Ledgerly is open. Automatic background email requires a mail server, so this personal edition provides email-ready drafts instead.</p></div></div></section>}
        {section === 'team' && <section className="card settings-section"><div className="settings-head"><div><h2>Owner & access</h2><p>This personal edition is intentionally single-user.</p></div><span className="source-pill">Local owner</span></div><div className="form-grid"><label className="field"><span>Your name</span><input value={org.ownerName} onChange={e => setOrg({ ...org, ownerName: e.target.value })} placeholder="Used in your greeting and audit history" /></label><label className="field"><span>Owner email</span><input type="email" value={org.email} onChange={e => setOrg({ ...org, email: e.target.value })} /></label></div><div className="access-card"><div className="large-avatar">{(org.ownerName || 'ME').slice(0,2).toUpperCase()}</div><div><strong>{org.ownerName || 'You'}</strong><span>Owner · Full access on this Mac</span></div><CheckCircle2 size={18} /></div><div className="info-panel"><UserRound size={18} /><div><strong>No accounts or cloud access</strong><p>Anyone who can sign into your macOS user account can open this app. Use a strong Mac login password and FileVault if the invoices are confidential.</p></div></div></section>}
        {section === 'data' && <section className="card settings-section"><div className="settings-head"><div><h2>Data & privacy</h2><p>Your records stay inside Ledgerly on this Mac.</p></div></div><div className="report-note"><CheckCircle2 size={16} /> Local workspace — saved on this device. Back up regularly.</div><div className="data-summary"><div><strong>{data.clients.length}</strong><span>Clients</span></div><div><strong>{data.invoices.length}</strong><span>Invoices</span></div><div><strong>{data.payments.length}</strong><span>Payments</span></div></div><div className="data-action-list"><div><div><strong>Automatic recovery copy</strong><span>Ledgerly keeps the previous valid save when data changes or migrates.</span></div><Button variant="secondary" disabled={!hasRecovery} onClick={() => { if (confirm('Replace the current workspace with the previous automatic recovery copy? Your current state will become the next recovery copy.')) { const recovered = restoreRecovery(); if (recovered) { setOrg(recovered.organization); setBrandDraft(recovered.organization.brandColor); notify('Previous workspace state restored.') } else notify('No recovery copy is available.') } }}>Restore previous</Button></div><div><div><strong>Complete JSON backup</strong><span>Best for restoring Ledgerly later.</span></div><Button variant="secondary" icon={<Download size={16} />} onClick={downloadBackup}>Download</Button></div><div><div><strong>Spreadsheet exports</strong><span>Clients, invoices, items, and payments as separate CSV files.</span></div><Button variant="secondary" icon={<Download size={16} />} onClick={() => { if (!exportAllCsv(data)) { notify('Nothing to export yet.'); return } notify('CSV exports downloaded.') }}>Export all</Button></div><div><div><strong>Restore a backup</strong><span>Validate and preview record counts before replacement.</span></div><Button variant="secondary" icon={<Upload size={16} />} onClick={() => { if (fileRef.current) fileRef.current.value = ''; fileRef.current?.click() }}>Choose file</Button><input ref={fileRef} hidden type="file" accept="application/json" onChange={e => importBackup(e.target.files?.[0])} /></div></div><div className="danger-zone"><div><strong>Clear this workspace</strong><span>Permanently removes all local Ledgerly records and settings.</span></div><Button variant="danger" onClick={() => { if (confirm('Clear all clients, invoices, products, payments, and settings? Download a backup first if you need one.')) { const clean = structuredClone(blankData); importData(clean); setOrg(clean.organization); setBrandDraft(clean.organization.brandColor); notify('Workspace cleared.') } }}>Clear all data</Button></div></section>}
        {section === 'updates' && <UpdateSection notify={notify} />}
        {section === 'changes' && <section className="card settings-section"><div className="settings-head"><div><h2>What's new</h2><p>A running history of improvements in each Ledgerly release.</p></div><span className="version-badge">Version {FRONTEND_VERSION}{SHELL_VERSION !== FRONTEND_VERSION ? ` · Shell ${SHELL_VERSION}` : ''}</span></div><div className="changelog"><article><div><strong>1.7.0</strong><span>Current</span></div><h3>Local update channel</h3><ul><li>Frontend and shell versions are tracked separately; find both under Settings → Updates.</li><li>The desktop app verifies and stages signed frontend bundles locally; browser builds notify when a new version is ready.</li></ul></article><article><div><strong>1.6.1</strong></div><h3>Cleaner invoice documents</h3><ul><li>Removed the full-height side rail from invoices and PDFs; stored Side-bar settings gracefully become the top rule.</li><li>Modern and Minimal no longer show doubled header rules.</li></ul></article><article><div><strong>1.6.0</strong></div><h3>Distinct invoice templates</h3><ul><li>All five templates now own their structure: header, metadata, table, and totals differ across Classic, Modern, Minimal, Editorial, and Bold.</li><li>Thumbnails preview the real layout; web preview and exported PDF share one template definition.</li><li>Tax column, footer, logo aspect, and accent styles now match between preview and PDF.</li></ul></article><article><div><strong>1.5.5</strong></div><h3>Sidebar geometry repair</h3><ul><li>Logo mark, plus icon, avatar, and navigation icons can no longer squish while collapsing.</li><li>New invoice is a fixed 44 × 37 rail control when collapsed; rows stay 38 high in both states.</li><li>Icons travel horizontally only — measured zero vertical drift at both endpoints.</li></ul></article><article><div><strong>1.5.4</strong></div><h3>Jump-free sidebar motion</h3><ul><li>Sidebar icons now travel in one smooth monotonic glide with no mid-collapse snap to the right.</li><li>Labels always fit their row via flex instead of chasing the panel with a width cap.</li></ul></article><article><div><strong>1.5.3</strong></div><h3>Cleaner sidebar</h3><ul><li>The Local workspace note moved out of the sidebar into Settings → Data &amp; privacy as a single line.</li></ul></article><article><div><strong>1.5.2</strong></div><h3>Compact rail highlight</h3><ul><li>Collapsed navigation hover and active states are now a compact pill behind the icon instead of a full-width block.</li></ul></article><article><div><strong>1.5.1</strong></div><h3>Calmer sidebar motion</h3><ul><li>Collapse now fades labels out instead of teleporting them; icons glide into the rail with no jump.</li><li>Expansion finishes with the panel — no trailing labels; motion stays under 300ms.</li><li>Collapsed navigation buttons announce their names to assistive technology.</li></ul></article><article><div><strong>1.5.0</strong></div><h3>Animated sidebar</h3><ul><li>Collapsing and expanding the sidebar now glides instead of snapping; navigation labels fade in with a subtle stagger.</li><li>Automatically still when Reduce Motion is on.</li></ul></article><article><div><strong>1.4.3</strong></div><h3>Collapsed rail clearance</h3><ul><li>Collapsed icon rail is a little wider so it no longer hugs the traffic lights.</li><li>Sidebar extends full height again with a safe top inset; the 1.4.2 cutoff is reverted.</li></ul></article><article><div><strong>1.4.2</strong></div><h3>Sidebar clears traffic lights</h3><ul><li>Sidebar starts below the traffic-light zone instead of sitting underneath it; the corner stays clear for the native controls and dragging.</li></ul></article><article><div><strong>1.4.1</strong></div><h3>Native window fixes</h3><ul><li>Collapsed icon rail keeps the same traffic-light clearance, so icons stay at the same height.</li><li>Draggable area stretches across the sidebar top to just before the traffic lights.</li><li>Collapsed organization button keeps the avatar at its proper size.</li></ul></article><article><div><strong>1.4.0</strong></div><h3>Native macOS window controls</h3><ul><li>Real red, yellow, and green traffic lights in the desktop app via hidden title bar.</li><li>Drag the window from blank top-bar space; all search, navigation, and editor controls stay clickable.</li><li>Sidebar and collapsed icon rail sit below the traffic lights; translucent top bar, no redesign.</li></ul></article><article><div><strong>1.3.6</strong></div><h3>Appearance layout</h3><ul><li>Invoice appearance settings show options and live preview side by side, like the invoice editor.</li></ul></article><article><div><strong>1.3.5</strong></div><h3>Shared preview</h3><ul><li>Invoice editor and appearance settings now render the exact same live preview pane.</li></ul></article><article><div><strong>1.3.4</strong></div><h3>Template fixes</h3><ul><li>Templates now visibly update every invoice preview, including the settings sample.</li><li>The settings preview uses the same paper sheet as the invoice editor.</li></ul></article><article><div><strong>1.3.3</strong></div><h3>Side-by-side appearance settings</h3><ul><li>Invoice appearance options and the live document preview now sit next to each other.</li></ul></article><article><div><strong>1.3.2</strong></div><h3>Editor preview fit</h3><ul><li>The live invoice preview stays pinned on the right while editing and fits without sideways scrolling.</li></ul></article><article><div><strong>1.3.1</strong></div><h3>Real appearance preview</h3><ul><li>Invoice appearance settings now preview a real sample invoice document.</li></ul></article><article><div><strong>1.3.0</strong></div><h3>Real preview and collapsible sidebar</h3><ul><li>The invoice editor now previews the real customer-facing document, shared with the detail view.</li><li>The sidebar collapses to an icon rail from the top bar; the choice is remembered.</li></ul></article><article><div><strong>1.2.1</strong></div><h3>Polish</h3><ul><li>Live appearance sample inside the invoice editor when customizing.</li><li>Fixed the version badge alignment on this page.</li></ul></article><article><div><strong>1.2.0</strong></div><h3>Invoice appearance studio</h3><ul><li>Five invoice templates (Classic, Modern, Minimal, Editorial, Bold) with live preview.</li><li>Six professional palettes, custom colors with contrast feedback and one-click accessible correction.</li><li>Curated font pairs, density, logo position and size, accent styles, and per-section visibility.</li><li>Organization appearance defaults plus per-invoice customization; finalized invoices keep their exact appearance.</li><li>PDFs use the same templates, fonts, colors, and visibility rules as the preview.</li></ul></article><article><div><strong>1.1.1</strong></div><h3>Reliability and correctness</h3><ul><li>New app and installer icon based on the Ledgerly brand mark.</li><li>Payment validation errors are now shown; overpayments and invalid amounts are blocked with a message.</li><li>Partially paid overdue invoices are flagged overdue and included in reminders.</li><li>Mixed-currency totals are shown per currency instead of a mislabelled single sum.</li><li>Dates use the local calendar, long PDF notes and addresses paginate, and finalized PDFs use saved contact details.</li><li>The setup banner can be dismissed, drafts are numbered uniquely, and the desktop app asks before closing with unsaved changes.</li></ul></article><article><div><strong>1.1.0</strong></div><h3>A clearer workspace</h3><ul><li>A lighter sidebar, refined typography, and a consistent layout across Ledgerly.</li><li>Simpler financial summaries, a client directory table, and clearer empty states.</li><li>Readable invoice details, labelled line-item controls, and improved keyboard navigation.</li><li>Revenue charts show accurate zero values and amounts on hover or keyboard focus.</li></ul></article><article><div><strong>1.0.7</strong></div><h3>Polish and everyday improvements</h3><ul><li>Fixed overlapping headings in payment history and other empty table layouts.</li><li>Added payment search, source filters, clear controls, keyboard navigation, and useful empty states.</li><li>Added this in-app release history.</li></ul></article><article><div><strong>1.0.6</strong></div><h3>Payment details and client branding</h3><ul><li>Added reusable account holder, bank name, IBAN, BIC/SWIFT, and payment-instruction fields.</li><li>Automatically formats payment details for English and German invoices.</li><li>Added client logo upload, replacement, removal, and client-card previews.</li></ul></article><article><div><strong>1.0.5</strong></div><h3>German invoices</h3><ul><li>Added per-invoice English and German language selection.</li><li>Localized PDF labels, dates, currency formatting, previews, and sharing messages.</li><li>Added a default invoice-language setting and safe migration for older invoices.</li></ul></article><article><div><strong>1.0.4</strong></div><h3>Local-first invoicing foundation</h3><ul><li>Invoice, client, product, payment, reporting, reminder, and settings workflows.</li><li>PDF and CSV exports, backups, recovery copies, audit history, and desktop packaging.</li><li>Local device storage with no cloud account required.</li></ul></article></div></section>}
      </div>
    </div>
  </div>
}

function EmptyState({icon,title,text,action}:{icon:ReactNode;title:string;text:string;action?:ReactNode}){return <div className="empty-state"><div>{icon}</div><h2>{title}</h2><p>{text}</p>{action}</div>}

function downloadText(content:string,name:string,type:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function exportCsv<T extends object>(rows: T[], name: string){if(!rows.length)return false;const keys=Object.keys(rows[0]) as (keyof T)[];const escape=(v:unknown)=>`"${String(v??'').replaceAll('"','""')}"`;downloadText('\uFEFF'+[keys.join(','),...rows.map(r=>keys.map(k=>escape(r[k])).join(','))].join('\n'),name,'text/csv;charset=utf-8');return true}
function exportAllCsv(data: AppData) {
  return [
    exportCsv(data.clients.map(({ id, company, contact, email, phone, address, taxId, currency, archived }) => ({ id, company, contact, email, phone, address, taxId, currency, archived })), 'ledgerly-clients.csv'),
    exportCsv(data.invoices.map(invoice => ({ id: invoice.id, number: invoice.number, clientId: invoice.clientId, status: effectiveStatus(invoice, data.payments), issueDate: invoice.issueDate, dueDate: invoice.dueDate, currency: invoice.currency, totalMinor: invoiceTotals(invoice, data.payments).total, dueMinor: invoiceTotals(invoice, data.payments).due })), 'ledgerly-invoices.csv'),
    exportCsv(data.invoices.flatMap(invoice => invoice.lineItems.map(line => ({ invoiceId: invoice.id, lineId: line.id, description: line.description, quantityMilli: line.quantityMilli, unitPriceMinor: line.unitPrice, taxRateBps: line.taxRateBps, discountBps: line.discountBps }))), 'ledgerly-invoice-items.csv'),
    exportCsv(data.payments.map(payment => ({ ...payment })), 'ledgerly-payments.csv'),
  ].filter(Boolean).length
}

export default App
