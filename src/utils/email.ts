export type ParsedEmailList = {
  emails: string[]
  invalid: string[]
}

const EMAIL_SPLIT_RE = /[,\n;]+/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseEmailList(value: string): ParsedEmailList {
  const emails: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  for (const rawPart of value.split(EMAIL_SPLIT_RE)) {
    const part = rawPart.trim()
    if (!part) continue
    const normalized = part.toLowerCase()
    if (!EMAIL_RE.test(part)) {
      invalid.push(part)
      continue
    }
    if (!seen.has(normalized)) {
      emails.push(part)
      seen.add(normalized)
    }
  }

  return { emails, invalid }
}

export function formatEmailList(emails?: string[]): string {
  return (emails || []).filter(Boolean).join(', ')
}
