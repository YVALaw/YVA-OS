function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  }

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' })

  const url = 'https://www.infodolar.com.do/precio-dolar-entidad-banco-bhd.aspx'

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) {
      return json(res.status, { error: `InfoDolar request failed with status ${res.status}` })
    }

    const html = await res.text()
    // Anchor on the table row (class="nombre"), not the first "Banco BHD" on the
    // page — that is now the <title>. Prefer the data-order attributes on the
    // Compra/Venta cells; fall back to plain $ amounts near the row.
    const rowMatch =
      html.match(/class="nombre">\s*Banco BHD[\s\S]{0,2500}/i) ||
      html.match(/Banco BHD[\s\S]{0,2500}/i)
    let amounts = rowMatch
      ? Array.from(rowMatch[0].matchAll(/data-order="\$([\d.,]+)"/g))
      : []
    if (amounts.length < 2 && rowMatch) {
      amounts = Array.from(rowMatch[0].matchAll(/\$([\d.,]+)/g)).filter(
        (m) => Number(String(m[1]).replace(',', '.')) > 0
      )
    }
    if (amounts.length < 2) {
      return json(500, { error: 'Could not parse Banco BHD rate from InfoDolar response' })
    }

    const buy = Number(String(amounts[0][1]).replace(',', '.'))
    const sell = Number(String(amounts[1][1]).replace(',', '.'))
    // The row's <abbr class="timeago date" title="ISO"> holds the quote time.
    const timestampMatch = rowMatch
      ? rowMatch[0].match(/class="timeago date"[^>]*>([^<]+)</i)
      : null
    const timestamp = timestampMatch ? decodeHtml(timestampMatch[1].replace(/\s+/g, ' ').trim()) : undefined

    if (!Number.isFinite(sell)) {
      return json(500, { error: 'Parsed sell rate is invalid' })
    }

    return json(200, {
      provider: 'InfoDolar',
      entity: 'Banco BHD',
      buy,
      sell,
      timestamp,
      sourceUrl: url,
    })
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : 'Unexpected InfoDolar fetch failure',
    })
  }
}
