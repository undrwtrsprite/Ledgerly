import { formatMoney, invoiceTotals } from './domain'
import { densityTokens, hexToRgb, logoWidthMm, readableTextOn, resolveAccent, resolveTokens, templateDefinition } from './appearance'
import { formatInvoiceDate, invoiceCopy, invoiceLocale } from './invoiceLocale'
import type { Client, Invoice, Organization, Payment } from './types'

const ink: [number, number, number] = [27, 38, 35]
const muted: [number, number, number] = [105, 112, 108]

// Deliberate line-item column contract shared with the web preview.
const COL = { desc: 22, qty: 122, rate: 148, tax: 168, amount: 188 }

export async function downloadInvoicePdf(invoice: Invoice, client: Client | undefined, organization: Organization, payments: Payment[]) {
  const { doc } = await buildInvoicePdf(invoice, client, organization, payments)
  doc.save(`${invoice.number}.pdf`)
}

export async function buildInvoicePdf(invoice: Invoice, client: Client | undefined, organization: Organization, payments: Payment[]) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const tokens = resolveTokens(invoice, organization)
  const { appearance, fonts } = tokens
  const def = templateDefinition(appearance.template)
  const accent = resolveAccent(appearance)
  const density = densityTokens(appearance.density)
  const primary: [number, number, number] = hexToRgb(appearance.primaryColor) || [44, 88, 71]
  const accentRgb: [number, number, number] = hexToRgb(appearance.accentColor) || primary
  const onPrimary: [number, number, number] = readableTextOn(appearance.primaryColor) === '#ffffff' ? [255, 255, 255] : ink
  const bodyFont = fonts.pdfBody
  const headFont = fonts.pdfHeading
  const totals = invoiceTotals(invoice, payments)
  const locale = invoiceLocale(invoice, organization)
  const copy = invoiceCopy(locale)
  const money = (value: number) => formatMoney(value, invoice.currency, locale)
  const snap = invoice.snapshot
  const businessName = snap?.businessName || organization.tradingName || organization.legalName
  const businessEmail = snap?.businessEmail || organization.email
  const businessTaxId = snap?.businessTaxId || organization.taxId
  const clientName = snap?.clientName || client?.company || copy.fallbackClient
  const logoDataUrl = snap?.logoDataUrl || (!snap && organization.logoDataUrl) || undefined
  const logoImageFormat = logoDataUrl?.startsWith('data:image/png') ? 'PNG' : logoDataUrl?.startsWith('data:image/jpeg') || logoDataUrl?.startsWith('data:image/jpg') ? 'JPEG' : null
  const titleSize = def.titleScale === 'small' ? 22 : def.titleScale === 'normal' ? 30 : def.titleScale === 'large' ? 34 : 40
  let y = 24

  const logoBox = await (async (): Promise<{ w: number; h: number } | null> => {
    if (!logoDataUrl || !logoImageFormat) return null
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('logo'))
        el.src = logoDataUrl
      })
      const ratio = img.naturalHeight / img.naturalWidth || 0.6
      let w = Math.min(logoWidthMm(appearance.logoScale), 60)
      let h = w * ratio
      if (h > 22) { h = 22; w = h / ratio }
      return { w, h }
    } catch {
      return null
    }
  })()

  const drawLogo = (x: number, boxY: number, size: number) => {
    if (logoBox && logoImageFormat && logoDataUrl) {
      pdf.addImage(logoDataUrl, logoImageFormat, x, boxY, logoBox.w, logoBox.h)
      return logoBox.w
    }
    pdf.setFillColor(...primary)
    pdf.roundedRect(x, boxY, size, size, 3, 3, 'F')
    pdf.setDrawColor(...onPrimary)
    pdf.setLineWidth(Math.max(0.7, size / 14))
    pdf.line(x + size * .28, boxY + size * .2, x + size * .28, boxY + size * .8)
    pdf.line(x + size * .28, boxY + size * .8, x + size * .8, boxY + size * .8)
    pdf.line(x + size * .48, boxY + size * .2, x + size * .48, boxY + size * .62)
    pdf.line(x + size * .48, boxY + size * .62, x + size * .8, boxY + size * .62)
    return size
  }

  const wrapName = (name: string, width: number) => (pdf.splitTextToSize(name, width) as string[]).slice(0, 2)

  if (def.header === 'band') {
    pdf.setFillColor(...primary)
    pdf.roundedRect(18, 14, 174, 26, 3, 3, 'F')
    const logoWidth = drawLogo(24, 18.5, 12)
    pdf.setTextColor(...onPrimary)
    pdf.setFont(headFont, 'bold')
    pdf.setFontSize(13)
    wrapName(businessName, 100).forEach((line, index) => pdf.text(line, 24 + logoWidth + 5, 27 + index * 5))
    pdf.setFontSize(titleSize)
    pdf.text(copy.invoice, 186, 31, { align: 'right' })
    y = 50
  } else if (def.header === 'asymmetric') {
    pdf.setTextColor(...muted)
    pdf.setFont(bodyFont, 'normal')
    pdf.setFontSize(9)
    wrapName(businessName, 120).forEach((line, index) => pdf.text(line, 18, 22 + index * 4.5))
    pdf.setTextColor(...ink)
    pdf.setFont(headFont, 'bold')
    pdf.setFontSize(titleSize)
    pdf.text(copy.invoice, 18, 33)
    pdf.setFontSize(11)
    pdf.text(invoice.number, 192, 33, { align: 'right' })
    y = 44
  } else if (def.header === 'stacked') {
    const rightAnchored = appearance.logoPosition === 'right'
    const logoX = appearance.logoPosition === 'center' ? 99 : rightAnchored ? 180 : 18
    const textX = appearance.logoPosition === 'center' ? 105 : rightAnchored ? 176 : 18
    const align = appearance.logoPosition === 'center' ? 'center' : rightAnchored ? 'right' : 'left'
    drawLogo(logoX, 16, 12)
    pdf.setTextColor(...ink)
    pdf.setFont(headFont, 'bold')
    pdf.setFontSize(12)
    wrapName(businessName, 120).forEach((line, index) => pdf.text(line, textX, 30 + index * 5, { align }))
    pdf.setFontSize(titleSize)
    pdf.text(copy.invoice, 18, 48)
    pdf.setFontSize(11)
    pdf.text(invoice.number, 192, 48, { align: 'right' })
    y = 58
  } else if (def.header === 'quiet') {
    const rightAnchored = appearance.logoPosition !== 'left'
    const logoX = appearance.logoPosition === 'center' ? 150 : 180
    drawLogo(rightAnchored ? logoX : 18, 18, 10)
    pdf.setTextColor(...ink)
    pdf.setFont(headFont, 'bold')
    pdf.setFontSize(titleSize)
    pdf.text(copy.invoice.toUpperCase(), rightAnchored ? 18 : 34, 27)
    pdf.setFont(bodyFont, 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(...muted)
    wrapName(businessName, 80).forEach((line, index) => pdf.text(line, rightAnchored ? 192 : 150, 25 + index * 4.5, { align: 'right' }))
    y = 44
  } else {
    const rightAnchored = appearance.logoPosition === 'right'
    const logoX = appearance.logoPosition === 'center' ? 99 : rightAnchored ? 180 : 18
    const logoWidth = drawLogo(logoX, 18, 12)
    pdf.setTextColor(...ink)
    pdf.setFont(headFont, 'bold')
    pdf.setFontSize(13)
    if (appearance.logoPosition === 'center') wrapName(businessName, 120).forEach((line, index) => pdf.text(line, 105, 27 + index * 5, { align: 'center' }))
    else if (rightAnchored) wrapName(businessName, 100).forEach((line, index) => pdf.text(line, 176, 27 + index * 5, { align: 'right' }))
    else wrapName(businessName, 100).forEach((line, index) => pdf.text(line, 18 + logoWidth + 5, 27 + index * 5))
    pdf.setFontSize(titleSize)
    if (rightAnchored) pdf.text(copy.invoice, 18, 27)
    else pdf.text(copy.invoice, 192, 27, { align: 'right' })
    y = 44
  }

  if (accent.accentRule) {
    pdf.setFillColor(...accentRgb)
    pdf.rect(18, def.header === 'stacked' ? 52 : 38, 174, 1.2, 'F')
  } else {
    pdf.setDrawColor(222, 222, 214)
    pdf.line(18, def.header === 'stacked' ? 52 : 38, 192, def.header === 'stacked' ? 52 : 38)
  }

  const metaX = def.metadata === 'rail' ? 24 : 18
  const metaRight = 192
  if (def.metadata === 'band') {
    const bandFacts: { label: string; value: string }[] = [
      { label: copy.issueDate, value: formatInvoiceDate(invoice.issueDate, locale) },
      { label: copy.dueDate, value: formatInvoiceDate(invoice.dueDate, locale) },
    ]
    if (appearance.showReference && invoice.reference) bandFacts.push({ label: copy.reference, value: invoice.reference })
    pdf.setFontSize(8)
    pdf.setTextColor(...muted)
    pdf.text(copy.billTo, metaX, y + 6)
    pdf.setFontSize(11)
    pdf.setTextColor(...ink)
    pdf.setFont(headFont, 'bold')
    const bandName = pdf.splitTextToSize(clientName, 100) as string[]
    bandName.slice(0, 2).forEach((line, index) => pdf.text(line, metaX, y + 13 + index * 5))
    const factY = y + 13 + Math.min(bandName.length, 2) * 5 + 3
    const factW = (metaRight - metaX - 6) / bandFacts.length
    bandFacts.forEach((fact, index) => {
      const fx = metaX + index * factW
      pdf.setFont(bodyFont, 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...muted)
      pdf.text(fact.label.toUpperCase(), fx, factY)
      pdf.setFont(headFont, 'bold'); pdf.setFontSize(10); pdf.setTextColor(...ink)
      ;(pdf.splitTextToSize(fact.value, factW - 4) as string[]).slice(0, 2).forEach((line, lineIndex) => pdf.text(line, fx, factY + 6 + lineIndex * 4.5))
    })
    y = factY + 18
  } else {
    const small = def.metadata === 'quiet'
    pdf.setFontSize(small ? 7.5 : 8)
    pdf.setTextColor(...muted)
    pdf.text(copy.billTo, metaX, y + 6)
    pdf.text(copy.invoiceNumber, 132, y + 6)
    pdf.setFontSize(small ? 10 : 11)
    pdf.setTextColor(...ink)
    pdf.setFont(headFont, 'bold')
    pdf.text(clientName, metaX, y + 13)
    if (def.header !== 'stacked') pdf.text(invoice.number, metaRight, y + 13, { align: 'right' })
    pdf.setFont(bodyFont, 'normal')
    pdf.setFontSize(9)
    const addressSource = [
      snap?.clientContact || client?.contact,
      ...(snap?.clientAddress || client?.address || '').split('\n'),
      appearance.showClientTaxId ? (snap?.clientTaxId || client?.taxId) : undefined,
      snap?.clientEmail || client?.email,
    ].filter(Boolean) as string[]
    const addressLines = addressSource.flatMap(line => pdf.splitTextToSize(line, 96) as string[]).slice(0, 12)
    addressLines.forEach((line, index) => pdf.text(line, metaX, y + 19 + index * density.lineGap))
    pdf.setTextColor(...muted)
    pdf.text(copy.issueDate, 132, y + 21)
    pdf.text(copy.dueDate, 132, y + 27)
    pdf.setTextColor(...ink)
    pdf.text(formatInvoiceDate(invoice.issueDate, locale), metaRight, y + 21, { align: 'right' })
    pdf.text(formatInvoiceDate(invoice.dueDate, locale), metaRight, y + 27, { align: 'right' })
    if (appearance.showReference && invoice.reference && def.header !== 'stacked') { pdf.setTextColor(...muted); pdf.text(copy.reference, 132, y + 33); pdf.setTextColor(...ink); pdf.text(invoice.reference, metaRight, y + 33, { align: 'right' }) }
    y = Math.max(y + 50, y + 19 + addressLines.length * density.lineGap + 6)
  }
  y = Math.max(y, def.header === 'stacked' ? 100 : 94)
  const header = () => {
    pdf.setFont(headFont, 'bold'); pdf.setFontSize(8)
    if (def.table === 'ruled') {
      pdf.setFillColor(244, 242, 236)
      pdf.roundedRect(18, y, 174, 9, 2, 2, 'F')
      pdf.setTextColor(...muted)
    } else if (def.table === 'strong') {
      pdf.setFillColor(...primary)
      pdf.roundedRect(18, y, 174, 9, 2, 2, 'F')
      pdf.setTextColor(...onPrimary)
    } else {
      if (def.table === 'editorial') { pdf.setDrawColor(32, 42, 39); pdf.setLineWidth(0.8); pdf.line(18, y, 192, y); pdf.setLineWidth(0.2) }
      else { pdf.setDrawColor(222, 222, 214); pdf.line(18, y, 192, y) }
      pdf.setTextColor(...muted)
    }
    pdf.text(copy.description, COL.desc, y + 5.8)
    pdf.text(copy.quantity, COL.qty, y + 5.8, { align: 'right' })
    pdf.text(copy.rate, COL.rate, y + 5.8, { align: 'right' })
    pdf.text(copy.tax, COL.tax, y + 5.8, { align: 'right' })
    pdf.text(copy.amount, COL.amount, y + 5.8, { align: 'right' })
    if (def.table === 'ruled' || def.table === 'strong') y += density.tablePad
    else { pdf.setDrawColor(222, 222, 214); pdf.line(18, y + 9, 192, y + 9); y += density.tablePad }
  }
  header()
  invoice.lineItems.forEach((line, index) => {
    const amount = Math.round(line.quantityMilli * line.unitPrice / 1000)
    const descLines = pdf.splitTextToSize(line.description || copy.fallbackItem, 80) as string[]
    const rowHeight = Math.max(density.rowHeight, descLines.length * density.lineGap + 5)
    if (y + rowHeight > 250) { pdf.addPage(); y = 22; header() }
    pdf.setFont(bodyFont, 'normal'); pdf.setFontSize(9); pdf.setTextColor(...ink)
    pdf.text(descLines, COL.desc, y + 2)
    pdf.text((line.quantityMilli / 1000).toString(), COL.qty, y + 2, { align: 'right' })
    pdf.text(money(line.unitPrice), COL.rate, y + 2, { align: 'right' })
    pdf.text(`${line.taxRateBps / 100}%`, COL.tax, y + 2, { align: 'right' })
    pdf.text(money(amount), COL.amount, y + 2, { align: 'right' })
    y += rowHeight
    if (index < invoice.lineItems.length - 1) { pdf.setDrawColor(235, 234, 228); pdf.line(18, y - 4, 192, y - 4) }
  })

  if (y > 205) { pdf.addPage(); y = 26 }
  y += density.sectionGap
  const summaryX = def.totals === 'statement' ? 18 : 129
  const sumLines: { label: string; value: number; bold?: boolean }[] = [{ label: copy.subtotal, value: totals.subtotal }]
  if (totals.discount) sumLines.push({ label: copy.discount, value: -totals.discount })
  if (totals.tax) sumLines.push({ label: copy.tax, value: totals.tax })
  if (totals.additionalCharges) sumLines.push({ label: copy.additionalCharges, value: totals.additionalCharges })
  sumLines.push({ label: copy.total, value: totals.total, bold: true })
  if (totals.paid) sumLines.push({ label: copy.payments, value: -totals.paid })
  if (def.totals === 'summary') {
    pdf.setFillColor(247, 248, 245)
    pdf.roundedRect(summaryX - 5, y - 6, 68, sumLines.length * 6 + 22, 2, 2, 'F')
  }
  const sumLine = (label: string, value: number, bold = false) => {
    pdf.setFont(bold ? headFont : bodyFont, bold ? 'bold' : 'normal'); pdf.setFontSize(bold ? 11 : 9); pdf.setTextColor(...(bold ? ink : muted))
    pdf.text(label, summaryX, y); pdf.text(money(value), 192, y, { align: 'right' }); y += bold ? 8 : 6
  }
  if (accent.totalsBar) { pdf.setFillColor(...accentRgb); pdf.rect(summaryX, y - 4, 63, 1.2, 'F'); y += 2 }
  for (const entry of sumLines) sumLine(entry.label, entry.value, entry.bold)
  if (def.totals === 'statement') {
    pdf.setDrawColor(32, 42, 39); pdf.setLineWidth(0.5); pdf.line(summaryX, y - 2, 192, y - 2); pdf.setLineWidth(0.2); y += 5
  } else {
    pdf.setDrawColor(210, 210, 202); pdf.line(summaryX, y - 2, 192, y - 2); y += 4
  }
  if (!accent.balanceFilled) {
    pdf.setFont(headFont, 'bold'); pdf.setFontSize(def.totals === 'statement' ? 14 : 11); pdf.setTextColor(...ink)
    pdf.text(copy.balanceDue, summaryX, y + 2); pdf.text(money(totals.due), 192, y + 2, { align: 'right' })
    y += 8
  } else if (def.totals === 'banner') {
    pdf.setFillColor(...primary); pdf.roundedRect(summaryX - 5, y - 6, 68, 15, 2, 2, 'F')
    pdf.setTextColor(...onPrimary); pdf.setFont(headFont, 'bold'); pdf.setFontSize(12); pdf.text(copy.balanceDue, summaryX, y + 2); pdf.text(money(totals.due), 188, y + 2, { align: 'right' })
    y += 10
  } else {
    pdf.setFillColor(...primary); pdf.roundedRect(summaryX - 5, y - 5.5, 68, 13, 2, 2, 'F')
    pdf.setTextColor(...onPrimary); pdf.setFont(headFont, 'bold'); pdf.setFontSize(11); pdf.text(copy.balanceDue, summaryX, y + 2); pdf.text(money(totals.due), 188, y + 2, { align: 'right' })
    y += 8
  }

  const notesText = [
    appearance.showNotes ? invoice.notes : '',
    appearance.showPaymentDetails ? invoice.paymentInstructions : '',
  ].filter(Boolean).join('\n\n')
  if (notesText) {
    y += 16
    const notesLines = pdf.splitTextToSize(notesText, 105) as string[]
    if (y + 7 + density.lineGap > 275) { pdf.addPage(); y = 24 }
    pdf.setFont(headFont, 'bold'); pdf.setFontSize(8); pdf.setTextColor(...muted); pdf.text(copy.notesPayment, 18, y)
    pdf.setFont(bodyFont, 'normal'); pdf.setTextColor(...ink); pdf.setFontSize(8.5)
    y += 7
    for (const line of notesLines) {
      if (y + density.lineGap > 275) { pdf.addPage(); y = 24 }
      pdf.text(line, 18, y)
      y += density.lineGap
    }
  }

  if (appearance.showFooter) {
    const pages = pdf.getNumberOfPages()
    for (let page = 1; page <= pages; page++) {
      pdf.setPage(page); pdf.setFontSize(7.5); pdf.setTextColor(...muted)
      const footerParts = [businessName, businessEmail, businessTaxId].filter(Boolean)
      pdf.text(footerParts.join(' · '), 18, 287)
      pdf.text(`${copy.page} ${page} ${copy.of} ${pages}`, 192, 287, { align: 'right' })
    }
  }
  return { doc: pdf, pages: pdf.getNumberOfPages() }
}
