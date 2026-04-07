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
    const blockMatch = html.match(/Banco BHD[\s\S]{0,400}/i)
    const amounts = blockMatch ? Array.from(blockMatch[0].matchAll(/\$([\d.,]+)/g)) : []
    if (amounts.length < 2) {
      return json(500, { error: 'Could not parse Banco BHD rate from InfoDolar response' })
    }

    const buy = Number(String(amounts[0][1]).replace(',', '.'))
    const sell = Number(String(amounts[1][1]).replace(',', '.'))
    const timestampMatch = html.match(/lunes.*?República Dominicana|martes.*?República Dominicana|miércoles.*?República Dominicana|jueves.*?República Dominicana|viernes.*?República Dominicana|sábado.*?República Dominicana|domingo.*?República Dominicana/si)
    const timestamp = timestampMatch ? decodeHtml(timestampMatch[0].replace(/\s+/g, ' ').trim()) : undefined

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
