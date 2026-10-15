import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material'
import type { ReactNode } from 'react'

type JudgeColumn = { id: string; label: string; isHead?: boolean }
type ScoreRow = { key: string; label: ReactNode; results: ReactNode[] }

export default function JudgeScoreTable({
  judges,
  rows,
  cell,
  resultHeaders,
}: {
  judges: JudgeColumn[]
  rows: ScoreRow[]
  cell: (judgeId: string, rowKey: string) => ReactNode
  resultHeaders: string[]
}) {
  return (
    <TableContainer sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell
              sx={{
                position: 'sticky',
                left: 0,
                zIndex: 1,
                bgcolor: 'background.paper',
              }}
            >
              Entry
            </TableCell>
            {judges.map((judge) => (
              <TableCell key={judge.id} align="center">
                {judge.label}
                {judge.isHead ? ' *' : ''}
              </TableCell>
            ))}
            {resultHeaders.map((header) => (
              <TableCell key={header} align="center" sx={{ fontWeight: 700 }}>
                {header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell
                sx={{
                  whiteSpace: 'nowrap',
                  position: 'sticky',
                  left: 0,
                  zIndex: 1,
                  bgcolor: 'background.paper',
                }}
              >
                {row.label}
              </TableCell>
              {judges.map((judge) => (
                <TableCell key={judge.id} align="center">
                  {cell(judge.id, row.key) ?? '—'}
                </TableCell>
              ))}
              {row.results.map((result, index) => (
                <TableCell
                  key={index}
                  align="center"
                  sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                >
                  {result ?? '—'}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
