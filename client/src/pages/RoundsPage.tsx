import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api,
  type CallbackResultRow,
  type Division,
  type DivisionPair,
  type DivisionRound,
  type Registration,
  type RoundResults,
  type RoundStatus,
  type RoundType,
} from '../api/client'

type PoolEntry = {
  competitorId: string
  bibNumber: number
  label: string
  role?: 'lead' | 'follow'
}

const statusColor: Record<RoundStatus, 'default' | 'warning' | 'success'> = {
  pending: 'default',
  active: 'warning',
  complete: 'success',
}

function entryLabel(entry: {
  bibNumber: number
  firstName?: string
  lastName?: string
  followBibNumber?: number
  followFirstName?: string
}) {
  const name =
    entry.firstName && entry.lastName
      ? ` ${entry.firstName} ${entry.lastName}`
      : ''
  const follow = entry.followBibNumber
    ? ` & #${entry.followBibNumber}${entry.followFirstName ? ` ${entry.followFirstName}` : ''}`
    : ''
  return `#${entry.bibNumber}${name}${follow}`
}

function HeatEditor({
  eventId,
  division,
  round,
  pool,
  onSaved,
}: {
  eventId: string
  division: Division
  round: DivisionRound
  pool: PoolEntry[]
  onSaved: () => void
}) {
  const [heatCount, setHeatCount] = useState(Math.max(round.heats.length, 1))
  const [assignments, setAssignments] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeatCount(Math.max(round.heats.length, 1))
    const next: Record<string, number> = {}
    for (const heat of round.heats) {
      for (const entry of heat.entries) next[entry.competitorId] = heat.position
    }
    setAssignments(next)
  }, [round])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const heats = Array.from({ length: heatCount }, () => [] as string[])
      for (const entry of pool) {
        const heat = assignments[entry.competitorId] ?? 0
        if (heat >= 1 && heat <= heatCount) heats[heat - 1]!.push(entry.competitorId)
      }
      await api(
        `/events/${eventId}/divisions/${division.id}/rounds/${round.id}/heats`,
        { method: 'PUT', body: JSON.stringify({ heats }) },
      )
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save heats')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Heat assignments
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {!pool.length && (
        <Typography color="text.secondary">
          No eligible participants. Configure registrations
          {division.type === 'strictly' ? ' and pairs' : ''} first.
        </Typography>
      )}
      {round.type === 'callback' && pool.length > 0 && (
        <TextField
          label="Number of heats"
          type="number"
          size="small"
          value={heatCount}
          slotProps={{ htmlInput: { min: 1, max: 12 } }}
          onChange={(event) =>
            setHeatCount(
              Math.max(1, Math.min(12, Number(event.target.value) || 1)),
            )
          }
          sx={{ mb: 2, width: 160 }}
        />
      )}
      <List disablePadding dense>
        {pool.map((entry) => (
          <ListItem
            key={entry.competitorId}
            disableGutters
            secondaryAction={
              <Select
                size="small"
                value={String(assignments[entry.competitorId] ?? 0)}
                onChange={(event) =>
                  setAssignments((current) => ({
                    ...current,
                    [entry.competitorId]: Number(event.target.value),
                  }))
                }
                sx={{ minWidth: 120 }}
              >
                <MenuItem value={0}>Not in round</MenuItem>
                {Array.from({ length: heatCount }, (_, index) => (
                  <MenuItem key={index + 1} value={index + 1}>
                    Heat {index + 1}
                  </MenuItem>
                ))}
              </Select>
            }
          >
            <ListItemText
              primary={`#${entry.bibNumber} ${entry.label}`}
              secondary={entry.role ? entry.role : undefined}
            />
          </ListItem>
        ))}
      </List>
      {pool.length > 0 && (
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving || round.status === 'complete'}
          sx={{ mt: 1 }}
        >
          {saving ? 'Saving…' : 'Save heats'}
        </Button>
      )}
    </Box>
  )
}

function CallbackResults({
  eventId,
  division,
  nextRound,
  results,
  onAdvanced,
}: {
  eventId: string
  division: Division
  nextRound?: DivisionRound
  results: RoundResults
  onAdvanced: () => void
}) {
  const groups = [
    { title: 'Leads', rows: results.results.leads ?? [] },
    { title: 'Follows', rows: results.results.follows ?? [] },
    { title: 'Entries', rows: results.results.entries ?? [] },
  ].filter((group) => group.rows.length)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [topN, setTopN] = useState('')
  const [error, setError] = useState('')

  function applyTopN() {
    const n = Number(topN)
    if (!Number.isInteger(n) || n < 1) return
    const next = new Set<string>()
    for (const group of groups) {
      for (const row of group.rows.slice(0, n)) next.add(row.competitorId)
    }
    setSelected(next)
  }

  async function advance() {
    if (!nextRound) return
    setError('')
    try {
      const heatTotal =
        nextRound.type === 'relative_placement'
          ? 1
          : Math.max(nextRound.heats.length, 1)
      const heats = Array.from({ length: heatTotal }, () => [] as string[])
      let index = 0
      for (const id of selected) {
        heats[index % heatTotal]!.push(id)
        index += 1
      }
      await api(
        `/events/${eventId}/divisions/${division.id}/rounds/${nextRound.id}/heats`,
        { method: 'PUT', body: JSON.stringify({ heats }) },
      )
      onAdvanced()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to advance competitors',
      )
    }
  }

  function resultRow(row: CallbackResultRow) {
    return (
      <ListItem key={row.competitorId} disableGutters>
        {nextRound && (
          <Checkbox
            checked={selected.has(row.competitorId)}
            onChange={(event) =>
              setSelected((current) => {
                const next = new Set(current)
                if (event.target.checked) next.add(row.competitorId)
                else next.delete(row.competitorId)
                return next
              })
            }
          />
        )}
        <ListItemText
          primary={entryLabel(row)}
          secondary={`Yes ${row.yes} · Alt ${row.alternate} · No ${row.no}`}
        />
        <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {row.points}
        </Typography>
      </ListItem>
    )
  }

  return (
    <Box>
      {groups.map((group) => (
        <Box key={group.title} sx={{ mb: 2 }}>
          {groups.length > 1 && (
            <Typography variant="subtitle2">{group.title}</Typography>
          )}
          <List disablePadding dense>
            {group.rows.map(resultRow)}
          </List>
        </Box>
      ))}
      {nextRound && (
        <Box
          sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}
        >
          <TextField
            label="Top N"
            type="number"
            size="small"
            value={topN}
            slotProps={{ htmlInput: { min: 1 } }}
            onChange={(event) => setTopN(event.target.value)}
            sx={{ width: 100 }}
          />
          <Button size="small" onClick={applyTopN}>
            Select top N
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!selected.size || nextRound.status === 'complete'}
            onClick={() => void advance()}
          >
            Advance {selected.size} to {nextRound.name}
          </Button>
        </Box>
      )}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Box>
  )
}

function RoundCard({
  eventId,
  division,
  round,
  nextRound,
  pool,
  onChanged,
}: {
  eventId: string
  division: Division
  round: DivisionRound
  nextRound?: DivisionRound
  pool: PoolEntry[]
  onChanged: () => void
}) {
  const [results, setResults] = useState<RoundResults | null>(null)
  const [showResults, setShowResults] = useState(false)
  const [error, setError] = useState('')

  async function setStatus(status: RoundStatus) {
    setError('')
    try {
      await api(
        `/events/${eventId}/divisions/${division.id}/rounds/${round.id}`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      )
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update round')
    }
  }

  async function remove() {
    if (!window.confirm(`Delete round "${round.name}" and its marks?`)) return
    setError('')
    try {
      await api(
        `/events/${eventId}/divisions/${division.id}/rounds/${round.id}`,
        { method: 'DELETE' },
      )
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete round')
    }
  }

  async function toggleResults() {
    if (showResults) {
      setShowResults(false)
      return
    }
    try {
      const data = await api<RoundResults>(
        `/events/${eventId}/divisions/${division.id}/rounds/${round.id}/results`,
      )
      setResults(data)
      setShowResults(true)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to load results',
      )
    }
  }

  return (
    <Accordion>
      <AccordionSummary>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          <Typography sx={{ flexGrow: 1 }}>
            {round.position}. {round.name}
          </Typography>
          <Chip
            size="small"
            label={round.type === 'callback' ? 'Callback' : 'Relative placement'}
          />
          <Chip
            size="small"
            variant="outlined"
            color={statusColor[round.status]}
            label={round.status}
          />
          <Chip
            size="small"
            variant="outlined"
            label={`${round.lockedSubmissions} submitted`}
          />
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box
          sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}
        >
          {round.status !== 'active' && (
            <Button size="small" onClick={() => void setStatus('active')}>
              Open scoring
            </Button>
          )}
          {round.status === 'active' && (
            <Button size="small" onClick={() => void setStatus('complete')}>
              Mark complete
            </Button>
          )}
          {round.status === 'complete' && (
            <Button size="small" onClick={() => void setStatus('active')}>
              Reopen scoring
            </Button>
          )}
          {round.status !== 'pending' && (
            <Button size="small" onClick={() => void setStatus('pending')}>
              Reset to pending
            </Button>
          )}
          <Button size="small" onClick={() => void toggleResults()}>
            {showResults ? 'Hide results' : 'Results'}
          </Button>
          <Button size="small" color="error" onClick={() => void remove()}>
            Delete
          </Button>
        </Box>

        {showResults && results && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Results ({results.judges.submitted.length} judge ballots)
            </Typography>
            {round.type === 'callback' ? (
              <CallbackResults
                eventId={eventId}
                division={division}
                nextRound={nextRound}
                results={results}
                onAdvanced={onChanged}
              />
            ) : (
              <List disablePadding dense>
                {(results.results.placements ?? []).map((row) => (
                  <ListItem key={row.competitorId} disableGutters>
                    <ListItemText primary={entryLabel(row)} />
                    <Typography
                      variant="h6"
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {row.placement ?? '—'}
                    </Typography>
                  </ListItem>
                ))}
                {!results.results.placements?.length && (
                  <Typography color="text.secondary">
                    No placements yet — waiting on locked ballots.
                  </Typography>
                )}
              </List>
            )}
          </Box>
        )}

        <HeatEditor
          eventId={eventId}
          division={division}
          round={round}
          pool={pool}
          onSaved={onChanged}
        />
      </AccordionDetails>
    </Accordion>
  )
}

export default function RoundsPage() {
  const { eventId = '', divisionId = '' } = useParams()
  const navigate = useNavigate()
  const [division, setDivision] = useState<Division | null>(null)
  const [rounds, setRounds] = useState<DivisionRound[]>([])
  const [pool, setPool] = useState<PoolEntry[]>([])
  const [name, setName] = useState('')
  const [roundType, setRoundType] = useState<RoundType>('callback')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const [divisionRows, roundRows] = await Promise.all([
        api<Division[]>(`/events/${eventId}/divisions`),
        api<DivisionRound[]>(
          `/events/${eventId}/divisions/${divisionId}/rounds`,
        ),
      ])
      const found = divisionRows.find((row) => row.id === divisionId)
      setDivision(found ?? null)
      setRounds(roundRows)

      if (found?.type === 'strictly') {
        const pairs = await api<DivisionPair[]>(
          `/events/${eventId}/divisions/${divisionId}/pairs`,
        )
        setPool(
          pairs.map((pair) => ({
            competitorId: pair.leadCompetitorId,
            bibNumber: pair.leadBib,
            label: `${pair.leadFirstName} ${pair.leadLastName} & ${pair.followFirstName} ${pair.followLastName}`,
          })),
        )
      } else {
        const registrations = await api<Registration[]>(
          `/events/${eventId}/divisions/${divisionId}/registrations`,
        )
        setPool(
          registrations.map((row) => ({
            competitorId: row.competitorId,
            bibNumber: row.bibNumber,
            label: `${row.firstName} ${row.lastName}`,
            role: row.role,
          })),
        )
      }
      setLoaded(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load rounds')
    }
  }, [divisionId, eventId])

  useEffect(() => {
    void load()
  }, [load])

  async function createRound(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    setError('')
    try {
      await api(`/events/${eventId}/divisions/${divisionId}/rounds`, {
        method: 'POST',
        body: JSON.stringify({ name, type: roundType }),
      })
      setName('')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create round')
    }
  }

  if (!loaded && !error) {
    return (
      <Box sx={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading rounds" />
      </Box>
    )
  }

  return (
    <>
      <Button
        onClick={() => navigate(`/events/${eventId}/divisions`)}
        sx={{ mb: 1 }}
      >
        Back to divisions
      </Button>
      <Typography variant="h5" component="h1" sx={{ mb: 1 }}>
        {division?.name ?? 'Division'} rounds
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Create preliminary rounds (callback scoring) and a final round (relative
        placement). Judges can only score while a round is open.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Stack component="form" onSubmit={createRound} spacing={2}>
            <TextField
              label="Round name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <FormControl>
              <InputLabel id="round-type-label">Scoring</InputLabel>
              <Select
                labelId="round-type-label"
                label="Scoring"
                value={roundType}
                onChange={(event) =>
                  setRoundType(event.target.value as RoundType)
                }
              >
                <MenuItem value="callback">
                  Callback (yes / alternate / no)
                </MenuItem>
                <MenuItem value="relative_placement">
                  Final — relative placement (rank 1–N)
                </MenuItem>
              </Select>
            </FormControl>
            <Button type="submit" variant="contained" size="large">
              Add round
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {!rounds.length && (
        <Alert severity="info">No rounds yet for this division.</Alert>
      )}
      {division &&
        rounds.map((round, index) => (
          <RoundCard
            key={round.id}
            eventId={eventId}
            division={division}
            round={round}
            nextRound={rounds[index + 1]}
            pool={pool}
            onChanged={() => void load()}
          />
        ))}
    </>
  )
}
