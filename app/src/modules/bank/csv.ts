export interface CsvRow {
  /** 这一行在文件里从第几行开始（1 起），用于报错 */
  line: number
  cells: string[]
}

export class CsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvError'
  }
}

/** RFC 4180：支持引号、引号内换行、"" 转义、CRLF；去掉 BOM，跳过空行 */
export function parseCsv(text: string): CsvRow[] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: CsvRow[] = []
  let cells: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let rowStart = 1

  const endRow = () => {
    cells.push(field)
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowStart, cells })
    cells = []
    field = ''
  }

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        if (c === '\n') line++
        field += c
      }
      continue
    }
    if (c === '"' && field === '') {
      quoted = true
    } else if (c === ',') {
      cells.push(field)
      field = ''
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++
      endRow()
      line++
      rowStart = line
    } else {
      field += c
    }
  }
  if (quoted) throw new CsvError(`第 ${rowStart} 行的引号没有闭合`)
  if (field !== '' || cells.length > 0) endRow()
  return rows
}

/** 导出带 BOM，Excel 直接打开不乱码；以 = + - @ 开头的格子加 ' 防公式注入 */
export function toCsv(rows: string[][]): string {
  return '﻿' + rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n'
}

function escapeCell(value: string): string {
  let v = value
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`
  return /[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v
}

/** 导入时还原导出时加的防注入前缀 */
export function unescapeCell(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value
}
