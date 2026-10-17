export type ImportRole = 'lead' | 'follow'

export type ImportPerson = {
  name: string
  firstName: string
  lastName: string
  jackAndJillRole: ImportRole | null
  inStrictly: boolean
  strictlyRole: ImportRole | null
}

export type ParsedImport = {
  people: ImportPerson[]
  skippedRows: number
  warnings: string[]
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  const pushRow = () => {
    row.push(field)
    field = ''
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      pushRow()
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) pushRow()
  return rows
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/)
  const lastName = parts.length > 1 ? parts.pop()! : ''
  return { firstName: parts.join(' ') || name.trim(), lastName }
}

export function extractDanceplaceCompetitors(csv: string): ParsedImport {
  const rows = parseCsv(csv.replace(/^﻿/, ''))
  if (!rows.length) throw new Error('The CSV file is empty')

  const header = rows[0]!.map((cell) => cell.trim().toLowerCase())
  const nameIdx = header.indexOf('name')
  const typeIdx = header.indexOf('ticket type')
  const statusIdx = header.indexOf('ticket status')
  if (nameIdx < 0 || typeIdx < 0) {
    throw new Error('CSV must have "Name" and "Ticket Type" columns')
  }

  const warnings: string[] = []
  let skippedRows = 0
  const people = new Map<string, ImportPerson>()

  for (const row of rows.slice(1)) {
    const status = (row[statusIdx] ?? '').trim()
    if (/^(void|refund|cancel)/i.test(status)) {
      skippedRows++
      continue
    }
    const name = (row[nameIdx] ?? '').trim().replace(/\s+/g, ' ')
    const ticketType = (row[typeIdx] ?? '').trim()
    if (!name || !ticketType) {
      skippedRows++
      continue
    }

    const typeLower = ticketType.toLowerCase()
    const isJackAndJill = typeLower.includes('jack') && typeLower.includes('jill')
    const isStrictly = typeLower.includes('strictly')
    if (!isJackAndJill && !isStrictly) continue

    const key = name.toLowerCase()
    let person = people.get(key)
    if (!person) {
      person = {
        name,
        ...splitName(name),
        jackAndJillRole: null,
        inStrictly: false,
        strictlyRole: null,
      }
      people.set(key, person)
    }

    if (isJackAndJill) {
      const role: ImportRole | null = /lead/i.test(ticketType)
        ? 'lead'
        : /follow/i.test(ticketType)
          ? 'follow'
          : null
      if (!role) {
        warnings.push(`${name}: Jack & Jill ticket has no lead/follow role`)
      } else if (person.jackAndJillRole && person.jackAndJillRole !== role) {
        warnings.push(
          `${name}: conflicting Jack & Jill roles, using ${person.jackAndJillRole}`,
        )
      } else {
        person.jackAndJillRole = role
      }
    }
    if (isStrictly) person.inStrictly = true
  }

  const result = [...people.values()]
  for (const person of result) {
    if (person.inStrictly) {
      person.strictlyRole = person.jackAndJillRole
      if (!person.strictlyRole) {
        warnings.push(
          `${person.name}: Strictly role unknown (no Jack & Jill ticket to infer from)`,
        )
      }
    }
  }
  return { people: result, skippedRows, warnings }
}
