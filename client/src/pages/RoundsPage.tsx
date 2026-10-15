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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  type CallbackVote,
  type Division,
  type DivisionPair,
  type DivisionRound,
  type Registration,
  type RoundResults,
  type RoundStatus,
  type RoundType,
} from '../api/client'
import JudgeScoreTable from '../components/JudgeScoreTable'
import { judgeLabel } from '../utils/format'

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
  const [partners, setPartners] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const pairsFinal =
    division.type === 'jack_and_jill' &&
    round.type === 'relative_placement'
  const leads = pool.filter((entry) => entry.role === 'lead')
  const follows = pool.filter((entry) => entry.role === 'follow')
  // Only follows promoted into the final can be paired.
  const promotedFollows = follows.filter(
    (entry) => (assignments[entry.competitorId] ?? 0) >= 1,
  )
  const usedPartners = new Set(
    Object.entries(partners)
      .filter(([leadId]) => (assignments[leadId] ?? 0) >= 1)
      .map(([, followId]) => followId)
      .filter(Boolean),
  )

  useEffect(() => {
    setHeatCount(Math.max(round.heats.length, 1))
    const next: Record<string, number> = {}
    const nextPartners: Record<string, string> = {}
    for (const heat of round.heats) {
      for (const entry of heat.entries) {
        next[entry.competitorId] = heat.position
        if (entry.followCompetitorId) {
          nextPartners[entry.competitorId] = entry.followCompetitorId
        }
      }
    }
    setAssignments(next)
    setPartners(nextPartners)
  }, [round])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const heats = pairsFinal
        ? [
            {
              entries: [
                ...leads
                  .filter(
                    (entry) => (assignments[entry.competitorId] ?? 0) >= 1,
                  )
                  .map((entry) => ({
                    competitorId: entry.competitorId,
                    followCompetitorId:
                      partners[entry.competitorId] || undefined,
                  })),
                ...follows
                  .filter(
                    (entry) => (assignments[entry.competitorId] ?? 0) >= 1,
                  )
                  .map((entry) => ({ competitorId: entry.competitorId })),
              ],
            },
          ]
        : Array.from({ length: heatCount }, (_, index) => ({
            competitorIds: pool
              .filter((entry) => assignments[entry.competitorId] === index + 1)
              .map((entry) => entry.competitorId),
          }))
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

  const rows = pairsFinal ? leads : pool
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        {pairsFinal ? 'Finals pairs' : 'Heat assignments'}
      </Typography>
      {pairsFinal && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Each finals pair is one lead and one follow, identified by the
          lead&apos;s bib number.
        </Typography>
      )}
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {!pool.length && (
        <Typography color="text.secondary">
          No eligible participants. Configure registrations
          {division.type === 'strictly' ? ' and pairs' : ''} first.
        </Typography>
      )}
      {pairsFinal && !follows.length && pool.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          No follows are registered, so pairs cannot be formed yet.
        </Alert>
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
        {rows.map((entry) => {
          const inRound = (assignments[entry.competitorId] ?? 0) >= 1
          return (
            <ListItem
              key={entry.competitorId}
              disableGutters
              secondaryAction={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {pairsFinal && inRound && (
                    <Select
                      size="small"
                      displayEmpty
                      value={partners[entry.competitorId] ?? ''}
                      onChange={(selectEvent) =>
                        setPartners((current) => ({
                          ...current,
                          [entry.competitorId]: selectEvent.target.value,
                        }))
                      }
                      sx={{ minWidth: 140 }}
                    >
                      <MenuItem value="">
                        <em>Pick a follow</em>
                      </MenuItem>
                      {promotedFollows.map((follow) => (
                        <MenuItem
                          key={follow.competitorId}
                          value={follow.competitorId}
                          disabled={
                            usedPartners.has(follow.competitorId) &&
                            partners[entry.competitorId] !==
                              follow.competitorId
                          }
                        >
                          #{follow.bibNumber} {follow.label}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                  <Select
                    size="small"
                    value={String(assignments[entry.competitorId] ?? 0)}
                    onChange={(selectEvent) =>
                      setAssignments((current) => ({
                        ...current,
                        [entry.competitorId]: Number(selectEvent.target.value),
                      }))
                    }
                    sx={{ minWidth: 120 }}
                  >
                    <MenuItem value={0}>Not in round</MenuItem>
                    {Array.from({ length: heatCount }, (_, index) => (
                      <MenuItem key={index + 1} value={index + 1}>
                        {round.type === 'relative_placement'
                          ? 'In finals'
                          : `Heat ${index + 1}`}
                      </MenuItem>
                    ))}
                  </Select>
                </Box>
              }
            >
              <ListItemText
                primary={`#${entry.bibNumber} ${entry.label}`}
                secondary={!pairsFinal && entry.role ? entry.role : undefined}
              />
            </ListItem>
          )
        })}
      </List>
      {pairsFinal && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Promoted follows
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Only follows marked &quot;In finals&quot; can be paired with a lead.
          </Typography>
          <List disablePadding dense>
            {follows.map((entry) => (
              <ListItem
                key={entry.competitorId}
                disableGutters
                secondaryAction={
                  <Select
                    size="small"
                    value={String(assignments[entry.competitorId] ?? 0)}
                    onChange={(selectEvent) => {
                      const next = Number(selectEvent.target.value)
                      setAssignments((current) => ({
                        ...current,
                        [entry.competitorId]: next,
                      }))
                      if (next === 0) {
                        // Clear pairings that used this follow.
                        setPartners((current) =>
                          Object.fromEntries(
                            Object.entries(current).map(([leadId, followId]) => [
                              leadId,
                              followId === entry.competitorId ? '' : followId,
                            ]),
                          ),
                        )
                      }
                    }}
                    sx={{ minWidth: 120 }}
                  >
                    <MenuItem value={0}>Not in round</MenuItem>
                    <MenuItem value={1}>In finals</MenuItem>
                  </Select>
                }
              >
                <ListItemText
                  primary={`#${entry.bibNumber} ${entry.label}`}
                  secondary={
                    usedPartners.has(entry.competitorId)
                      ? 'paired'
                      : undefined
                  }
                />
              </ListItem>
            ))}
            {!follows.length && (
              <Typography color="text.secondary">
                No follows are registered in this division.
              </Typography>
            )}
          </List>
        </>
      )}
      {pool.length > 0 && (
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving || round.status === 'complete'}
          sx={{ mt: 1 }}
        >
          {saving ? 'Saving…' : pairsFinal ? 'Save pairs' : 'Save heats'}
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
  const voteBallots = new Map(
    (results.results.voteBallots ?? []).map((ballot) => [
      ballot.judgeId,
      ballot.votes,
    ]),
  )
  const submittedJudges = results.judges.submitted
  const voteMark = (vote?: CallbackVote) =>
    vote === 'yes' ? 'Y' : vote === 'alternate' ? 'A' : vote === 'no' ? 'N' : undefined

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
      // In a J&J final, checked leads and follows both advance as entries;
      // leads stay unpaired until the coordinator assigns promoted follows.
      const jnjFinal =
        nextRound.type === 'relative_placement' &&
        division.type === 'jack_and_jill'
      const heats = jnjFinal
        ? [
            {
              entries: [...selected].map((id) => ({ competitorId: id })),
            },
          ]
        : (() => {
            const heatTotal =
              nextRound.type === 'relative_placement'
                ? 1
                : Math.max(nextRound.heats.length, 1)
            const lists = Array.from(
              { length: heatTotal },
              () => [] as string[],
            )
            let index = 0
            for (const id of selected) {
              lists[index % heatTotal]!.push(id)
              index += 1
            }
            return lists.map((competitorIds) => ({ competitorIds }))
          })()
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
          {submittedJudges.length > 0 && (
            <JudgeScoreTable
              judges={submittedJudges.map((judge) => ({
                id: judge.id,
                label: judgeLabel(judge),
                isHead: judge.isHead,
              }))}
              resultHeaders={['Pts']}
              rows={group.rows.map((row) => ({
                key: row.competitorId,
                label: entryLabel(row),
                results: [row.points],
              }))}
              cell={(judgeId, key) => voteMark(voteBallots.get(judgeId)?.[key])}
            />
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
            ) : !results.results.placements?.length ? (
              <Typography color="text.secondary">
                No placements yet — waiting on locked ballots.
              </Typography>
            ) : (
              <JudgeScoreTable
                judges={results.judges.submitted.map((judge) => ({
                  id: judge.id,
                  label: judgeLabel(judge),
                  isHead: judge.isHead,
                }))}
                resultHeaders={['Place']}
                rows={results.results.placements.map((row) => ({
                  key: row.competitorId,
                  label: entryLabel(row),
                  results: [row.placement ?? '—'],
                }))}
                cell={(judgeId, key) =>
                  new Map(
                    (results.results.ballots ?? []).map((ballot) => [
                      ballot.judgeId,
                      ballot.ranks,
                    ]),
                  ).get(judgeId)?.[key] ?? '—'
                }
              />
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
  const [dialogOpen, setDialogOpen] = useState(false)

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
      setDialogOpen(false)
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

  const roundFormFields = (
    <>
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
    </>
  )

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

      {!rounds.length && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Stack component="form" onSubmit={createRound} spacing={2}>
              {roundFormFields}
              <Button type="submit" variant="contained" size="large">
                Add round
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {rounds.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button variant="contained" onClick={() => setDialogOpen(true)}>
            Add round
          </Button>
        </Box>
      )}

      {!rounds.length && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No rounds yet for this division.
        </Alert>
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

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        fullWidth
      >
        <form onSubmit={createRound}>
          <DialogTitle>Add round</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {roundFormFields}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">
              Add round
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  )
}
