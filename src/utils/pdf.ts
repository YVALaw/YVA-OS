import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { AppSettings, Employee, EmployeePaymentRecord, Invoice } from '../data/types'
import { formatInvoiceHoursEntry, formatInvoiceHoursHM, invoiceItemAmount, invoiceItemHours, parseInvoiceHours } from './invoiceHours'
import { payrollFromInvoiceItem } from './payroll'
import { formatTimeEntrySummary } from './timesheet'

export type EmailAttachment = {
  filename: string
  mimeType: string
  base64: string
}

type PaymentLookup = (invoice: Invoice) => EmployeePaymentRecord | undefined

const LETTER_WIDTH = 612
const LETTER_HEIGHT = 792
const PAGE_MARGIN = 54
const MAX_LINE_LENGTH = 88
const MAX_LINES_PER_PAGE = 46

function ascii(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapePdfText(text: string): string {
  return ascii(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function money(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dop(amount: number): string {
  return `RD$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function chunkBase64(value: string, size = 76): string {
  const parts: string[] = []
  for (let i = 0; i < value.length; i += size) parts.push(value.slice(i, i + size))
  return parts.join('\r\n')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function wrapText(text: string, width = MAX_LINE_LENGTH): string[] {
  const clean = ascii(text)
  if (!clean) return ['']
  const words = clean.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= width) {
      current = next
      continue
    }
    if (current) lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  return lines
}

function toPages(lines: string[]): string[][] {
  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += MAX_LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + MAX_LINES_PER_PAGE))
  }
  return pages.length ? pages : [['']]
}

function buildPdfContent(lines: string[]): string {
  const startX = PAGE_MARGIN
  const startY = LETTER_HEIGHT - PAGE_MARGIN
  const leading = 14
  const rows = [
    'BT',
    '/F1 10 Tf',
    `${startX} ${startY} Td`,
    `${leading} TL`,
  ]
  for (const line of lines) rows.push(`(${escapePdfText(line)}) Tj`, 'T*')
  rows.push('ET')
  return rows.join('\n')
}

function buildPdf(pages: string[][]): Uint8Array {
  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'

  const pageObjectIds: number[] = []
  let objectId = 3
  for (const _ of pages) {
    pageObjectIds.push(objectId)
    objectId += 2
  }
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`

  let pageIndex = 0
  for (const lines of pages) {
    const pageId = pageObjectIds[pageIndex]
    const contentId = pageId + 1
    const content = buildPdfContent(lines)
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LETTER_WIDTH} ${LETTER_HEIGHT}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Courier >> >> >> /Contents ${contentId} 0 R >>`
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    pageIndex += 1
  }

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = pdf.length
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return new TextEncoder().encode(pdf)
}

function makePdfAttachment(filename: string, lines: string[]): EmailAttachment {
  const bytes = buildPdf(toPages(lines))
  return {
    filename,
    mimeType: 'application/pdf',
    base64: bytesToBase64(bytes),
  }
}

function buildInvoiceLines(inv: Invoice, settings: AppSettings): string[] {
  const lines: string[] = []
  const companyName = settings.companyName || 'YVA Staffing'
  const companyEmail = settings.companyEmail || 'contact@yvastaffing.net'
  const companyPhone = settings.companyPhone || '+1 (717) 281-8676'
  const companyAddress = settings.companyAddress || 'Santo Domingo, Dominican Republic'

  lines.push(companyName)
  lines.push(companyAddress)
  lines.push(`${companyEmail} | ${companyPhone}`)
  lines.push('')
  lines.push(`INVOICE ${inv.number}`)
  lines.push(`Invoice Date: ${inv.date || '-'}`)
  if (inv.dueDate) lines.push(`Due Date: ${inv.dueDate}`)
  if (inv.billingStart || inv.billingEnd) lines.push(`Billing Period: ${inv.billingStart || '-'} - ${inv.billingEnd || '-'}`)
  if (inv.projectName) lines.push(`Project: ${inv.projectName}`)
  lines.push('')
  lines.push(`Bill To: ${inv.clientName || '-'}`)
  if (inv.clientEmail) lines.push(`Client Email: ${inv.clientEmail}`)
  if (inv.clientAddress) {
    lines.push(...wrapText(`Client Address: ${inv.clientAddress}`))
  }
  lines.push('')
  lines.push('Description')
  lines.push('----------------------------------------------------------------------------------------')
    if ((inv.items || []).length === 0) {
      lines.push(`Amount Due: ${money(Number(inv.subtotal) || 0)}`)
    } else {
      for (const item of inv.items || []) {
        const amount = invoiceItemAmount(item)
        lines.push(...wrapText(`${item.employeeName}${item.position ? ` - ${item.position}` : ''}`))
        lines.push(`Hours: ${formatInvoiceHoursEntry(invoiceItemHours(item))}   Rate: $${item.rate}/hr   Amount: ${money(amount)}`)
        if (item.timeEntries?.length) {
          lines.push(...wrapText(`Time Log: ${formatTimeEntrySummary(item.timeEntries).replace(/\n/g, ' | ')}`))
        }
        if (item.daily && Object.keys(item.daily).length > 0) {
          const usedDates = Object.entries(item.daily)
            .filter(([, value]) => parseInvoiceHours(value) > 0)
            .map(([date, value]) => `${date}: ${value}h`)
        if (usedDates.length) lines.push(...wrapText(`Daily Hours: ${usedDates.join(' | ')}`))
      }
      lines.push('')
    }
  }
  lines.push('----------------------------------------------------------------------------------------')
  lines.push(`Total Due: ${money(Number(inv.subtotal) || 0)}`)
  if (inv.notes) {
    lines.push('')
    lines.push('Notes')
    lines.push(...wrapText(inv.notes))
  }
  return lines
}

function buildStatementLines(
  emp: Employee,
  empInvoices: Invoice[],
  dateFrom: string,
  dateTo: string,
  settings: AppSettings,
  getPaymentRecord?: PaymentLookup,
): string[] {
  const payRate = Number(emp.payRate) || 0
  const dopRate = settings.usdToDop || 0
  const period = dateFrom && dateTo ? `${dateFrom} - ${dateTo}` : dateFrom || dateTo || 'All time'
  const totalHours = empInvoices.reduce((sum, inv) => {
    return sum + (inv.items || [])
      .filter(item => item.employeeName?.toLowerCase() === emp.name.toLowerCase())
      .reduce((hours, item) => hours + invoiceItemHours(item), 0)
  }, 0)
  const totalUSD = totalHours * payRate
  const totalDOP = dopRate > 0 ? totalUSD * dopRate : 0

  const lines: string[] = []
  lines.push(settings.companyName || 'YVA Staffing')
  lines.push('')
  lines.push(`EARNINGS STATEMENT - ${emp.name}`)
  if (emp.employeeNumber) lines.push(`Employee Number: ${emp.employeeNumber}`)
  lines.push(`Period: ${period}`)
  lines.push(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`)
  lines.push('')
  lines.push(`Invoices: ${empInvoices.length}`)
  lines.push(`Total Hours: ${formatInvoiceHoursHM(totalHours)}`)
  lines.push(`Pay Rate: ${payRate > 0 ? `$${payRate}/hr` : '-'}`)
  lines.push(`Total Earned (USD): ${payRate > 0 ? money(totalUSD) : '-'}`)
  if (totalDOP > 0) lines.push(`Total Earned (DOP): ${dop(totalDOP)} @ ${dopRate}`)
  lines.push('')
  lines.push('Invoice Breakdown')
  lines.push('----------------------------------------------------------------------------------------')

  if (empInvoices.length === 0) {
    lines.push('No invoice data for this period.')
    return lines
  }

  for (const inv of empInvoices) {
    const items = (inv.items || []).filter(item => item.employeeName?.toLowerCase() === emp.name.toLowerCase())
    const hours = items.reduce((sum, item) => sum + invoiceItemHours(item), 0)
    const earned = items.reduce((sum, item) => sum + payrollFromInvoiceItem(item, emp).totalPay, 0)
    const payment = getPaymentRecord?.(inv)
    lines.push(`${inv.number} | ${inv.projectName || 'No project'} | ${inv.billingStart || inv.date || '-'}${inv.billingEnd ? ` - ${inv.billingEnd}` : ''}`)
    lines.push(`Hours: ${formatInvoiceHoursHM(hours)}   Earned: ${payRate > 0 ? money(earned) : '-'}`)
    if (payment?.status === 'paid') {
      lines.push(`Status: Paid${payment.paidDate ? ` on ${payment.paidDate}` : ''}${payment.amount ? ` for ${money(payment.amount)}` : ''}`)
    } else {
      lines.push('Status: Pending')
    }
    if (payment?.notes) lines.push(...wrapText(`Payment Notes: ${payment.notes}`))
    const usedDates = items.flatMap(item =>
      Object.entries(item.daily || {})
        .filter(([, value]) => parseInvoiceHours(value) > 0)
        .map(([date, value]) => `${date}: ${value}h`),
    )
    if (usedDates.length) lines.push(...wrapText(`Daily Hours: ${usedDates.join(' | ')}`))
    lines.push('')
  }

  lines.push('----------------------------------------------------------------------------------------')
  lines.push(`Total Hours: ${formatInvoiceHoursHM(totalHours)}`)
  lines.push(`Total Earned: ${payRate > 0 ? money(totalUSD) : '-'}`)
  if (totalDOP > 0) lines.push(`Total Earned (DOP): ${dop(totalDOP)}`)
  return lines
}

export function buildInvoicePdfAttachment(inv: Invoice, settings: AppSettings): EmailAttachment {
  return makePdfAttachment(`${inv.number || 'invoice'}.pdf`, buildInvoiceLines(inv, settings))
}

export function buildEmployeeStatementPdfAttachment(
  emp: Employee,
  empInvoices: Invoice[],
  dateFrom: string,
  dateTo: string,
  settings: AppSettings,
  getPaymentRecord?: PaymentLookup,
): EmailAttachment {
  const periodSuffix = dateFrom || dateTo ? `-${(dateFrom || 'start').replaceAll('-', '')}-${(dateTo || 'end').replaceAll('-', '')}` : ''
  const safeName = ascii(emp.name || 'employee').replace(/\s+/g, '-').toLowerCase() || 'employee'
  return makePdfAttachment(
    `${safeName}-statement${periodSuffix}.pdf`,
    buildStatementLines(emp, empInvoices, dateFrom, dateTo, settings, getPaymentRecord),
  )
}

export function attachmentBase64ToBlob(attachment: EmailAttachment): Blob {
  const binary = atob(attachment.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: attachment.mimeType })
}

export function attachmentBase64ForMime(attachment: EmailAttachment): string {
  return chunkBase64(attachment.base64)
}

async function waitForIframeReady(iframe: HTMLIFrameElement, html: string): Promise<Document> {
  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve()
    iframe.srcdoc = html
  })
  const doc = iframe.contentDocument
  if (!doc) throw new Error('Unable to load PDF iframe document')
  const images = Array.from(doc.images || [])
  await Promise.all(images.map(img => new Promise<void>(resolve => {
    if (img.complete) { resolve(); return }
    img.onload = () => resolve()
    img.onerror = () => resolve()
  })))
  if (doc.fonts?.ready) await doc.fonts.ready
  await new Promise(resolve => window.setTimeout(resolve, 120))
  return doc
}

export async function htmlToPdfAttachment(filename: string, html: string): Promise<EmailAttachment> {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '-200vw'
  iframe.style.bottom = '0'
  iframe.style.width = '816px'
  iframe.style.height = '1056px'
  iframe.style.opacity = '0'
  iframe.style.pointerEvents = 'none'
  document.body.appendChild(iframe)

  try {
    const doc = await waitForIframeReady(iframe, html)
    const body = doc.body
    const contentWidth = Math.ceil(body.scrollWidth || 816)
    const contentHeight = Math.ceil(body.scrollHeight || 1056)
    const canvas = await html2canvas(body, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      width: contentWidth,
      height: contentHeight,
      windowWidth: contentWidth,
      windowHeight: contentHeight,
      scrollX: 0,
      scrollY: 0,
    })

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const sliceHeight = Math.floor(canvas.width * (pageHeight / pageWidth))

    let offset = 0
    let first = true
    while (offset < canvas.height) {
      const height = Math.min(sliceHeight, canvas.height - offset)
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = height
      const ctx = pageCanvas.getContext('2d')
      if (!ctx) throw new Error('Unable to render PDF page')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      ctx.drawImage(canvas, 0, offset, canvas.width, height, 0, 0, canvas.width, height)
      const img = pageCanvas.toDataURL('image/png')
      if (!first) pdf.addPage()
      pdf.addImage(img, 'PNG', 0, 0, pageWidth, (height * pageWidth) / canvas.width, undefined, 'FAST')
      offset += height
      first = false
    }

    const bytes = new Uint8Array(pdf.output('arraybuffer'))
    return { filename, mimeType: 'application/pdf', base64: bytesToBase64(bytes) }
  } finally {
    document.body.removeChild(iframe)
  }
}
