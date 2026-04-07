import { useEffect, useState } from 'react'
import type { Invoice } from '../data/types'

type Payload = { inv: Invoice }

function decodePayload(hash: string): Payload | null {
  try {
    const b64 = hash.startsWith('#') ? hash.slice(1) : hash
    return JSON.parse(decodeURIComponent(atob(b64))) as Payload
  } catch { return null }
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PortalPage() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    const p = decodePayload(window.location.hash)
    if (p?.inv) setPayload(p)
    else setError(true)
  }, [])

  if (error || !payload) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#333' }}>Invalid invoice link</div>
          <div style={{ fontSize: 14, marginTop: 8 }}>This link may be expired or malformed.</div>
        </div>
      </div>
    )
  }

  const { inv } = payload
  const total = Number(inv.subtotal) || 0

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Arial, Helvetica, sans-serif', color: '#111', padding: '40px 20px' }}>
      <div style={{ width: '8.5in', minHeight: '11in', maxWidth: '100%', margin: '0 auto', background: '#fff', borderRadius: 12, boxShadow: '0 4px 32px rgba(0,0,0,.10)', padding: '0.65in 0.72in' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 40 }}>
          <img
            src="/yva-logo.png"
            alt="YVA Staffing"
            style={{ height: 52 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#f5b533', letterSpacing: '-0.02em' }}>INVOICE</div>
            <div style={{ fontSize: 14, color: '#888', marginTop: 4 }}>{inv.number}</div>
            {inv.status && (
              <div style={{ marginTop: 6, display: 'inline-block', padding: '3px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em',
                background: inv.status === 'paid' ? '#dcfce7' : '#fef9ec',
                color: inv.status === 'paid' ? '#15803d' : '#92400e',
                border: `1px solid ${inv.status === 'paid' ? '#86efac' : '#fcd34d'}` }}>
                {inv.status}
              </div>
            )}
          </div>
        </div>

        {/* Meta grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 36 }}>
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: '#999', marginBottom: 6, fontWeight: 700 }}>Bill To</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{inv.clientName || '—'}</div>
            {inv.clientEmail   && <div style={{ fontSize: 13, color: '#555' }}>{inv.clientEmail}</div>}
            {inv.clientAddress && <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{inv.clientAddress}</div>}
          </div>
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: '#999', marginBottom: 6, fontWeight: 700 }}>Invoice Details</div>
            <div style={{ fontSize: 13, marginBottom: 3 }}><strong>Date:</strong> {inv.date || '—'}</div>
            {inv.billingStart && (
              <div style={{ fontSize: 13, marginBottom: 3 }}><strong>Period:</strong> {inv.billingStart} – {inv.billingEnd || ''}</div>
            )}
            {inv.projectName && (
              <div style={{ fontSize: 13 }}><strong>Project:</strong> {inv.projectName}</div>
            )}
          </div>
        </div>

        {/* Line items */}
        {(inv.items ?? []).length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Description', 'Hours', 'Rate', 'Amount'].map((h, i) => (
                  <th key={h} style={{ padding: '10px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', fontWeight: 700, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(inv.items ?? []).map((it, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px', fontSize: 14 }}>
                    <strong>{it.employeeName}</strong>
                    {it.position && <span style={{ color: '#888', fontWeight: 400 }}> — {it.position}</span>}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#555' }}>{it.hoursTotal}h</td>
                  <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#555' }}>${it.rate}/hr</td>
                  <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, fontWeight: 700 }}>{fmtMoney(it.hoursTotal * it.rate)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #111' }}>
                <td colSpan={3} style={{ padding: '14px 12px', fontWeight: 800, fontSize: 15 }}>Total Due</td>
                <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 900, fontSize: 20, color: '#f5b533' }}>{fmtMoney(total)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <div style={{ textAlign: 'center', padding: '32px 0', borderTop: '2px solid #111', borderBottom: '1px solid #e5e7eb', marginBottom: 24 }}>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>Amount Due</div>
            <div style={{ fontSize: 40, fontWeight: 900, color: '#f5b533' }}>{fmtMoney(total)}</div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 24, borderTop: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 12, color: '#aaa' }}>YVA Staffing · Bilingual Virtual Professionals · yvastaffing.net</div>
          <button
            onClick={() => window.print()}
            style={{ padding: '8px 20px', background: '#f5b533', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', color: '#111' }}
          >
            Print / Save PDF
          </button>
        </div>
      </div>

      <style>{`
        @page {
          size: Letter;
          margin: 0.5in;
        }
        @media print {
          button { display: none !important; }
          body { background: #fff !important; padding: 0; }
          div[style*="boxShadow"] { box-shadow: none !important; }
        }
      `}</style>
    </div>
  )
}
