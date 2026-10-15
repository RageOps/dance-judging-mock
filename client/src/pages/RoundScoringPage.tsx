import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api,
  type CallbackVote,
  type RoundSheet,
  type RoundSheetEntry,
} from '../api/client'

type Scope = 'lead' | 'follow' | 'both'

function entryName(entry: RoundSheetEntry) {
  if (entry.followBibNumber) {
    const lead = entry.firstName ? ` ${entry.firstName}` : ''
    const follow = entry.followFirstName ? ` ${entry.followFirstName}` : ''
    return `#${entry.bibNumber}${lead} & #${entry.followBibNumber}${follow}`
  }
  return entry.firstName
    ? `#${entry.bibNumber} ${entry.firstName}`
    : `#${entry.bibNumber}`
}

export default function RoundScoringPage() {
  const { eventId = '', divisionId = '', roundId = '' } = useParams()
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<RoundSheet | null>(null)
  const [marks, setMarks] = useState<Record<string, CallbackVote | number>>({})
  const [impressions, setImpressions] = useState<Record<string, number>>({})
  const [scope, setScope] = useState<Scope>('both')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const result = await api<RoundSheet>(
        `/judge/events/${eventId}/divisions/${divisionId}/rounds/${roundId}/scores`,
      )
      setSheet(result)
      setScope(result.scope)
      const next: Record<string, CallbackVote | number> = {}
      const nextImpressions: Record<string, number> = {}
      for (const heat of result.heats) {
        for (const entry of heat.entries) {
          if (entry.mark !== null) next[entry.competitorId] = entry.mark
          if (entry.impression !== null) {
            nextImpressions[entry.competitorId] = entry.impression
          }
        }
      }
      setMarks(next)
      setImpressions(nextImpressions)
      setDirty(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load round')
    }
  }, [divisionId, eventId, roundId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save() {
    if (!sheet) return
    setSaving(true)
    setError('')
    const isCallback = sheet.round.type === 'callback'
    const scopedEntries = sheet.heats
      .flatMap((heat) => heat.entries)
      .filter(
        (entry) =>
          isCallback &&
          sheet.division.type !== 'strictly' &&
          (scope === 'both' || entry.role === scope),
      )
    try {
      await api(
        `/judge/events/${eventId}/divisions/${divisionId}/rounds/${roundId}/scores`,
        {
          method: 'PUT',
          body: JSON.stringify({
            expectedRevision: sheet.revision,
            impressions: Object.entries(impressions).map(
              ([competitorId, score]) => ({ competitorId, score }),
            ),
            ...(sheet.division.type === 'strictly' ? {} : { scope }),
            ...(isCallback
              ? {
                  votes: (sheet.division.type === 'strictly'
                    ? sheet.heats.flatMap((heat) => heat.entries)
                    : scopedEntries
                  ).map((entry) => ({
                    competitorId: entry.competitorId,
                    vote: marks[entry.competitorId] ?? 'no',
                  })),
                }
              : {
                  placements: sheet.heats
                    .flatMap((heat) => heat.entries)
                    .map((entry) => ({
                      competitorId: entry.competitorId,
                      rank: marks[entry.competitorId],
                    })),
                }),
          }),
        },
      )
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save')
    } finally {
      setSaving(false)
    }
  }

  async function edit() {
    if (!sheet) return
    setError('')
    try {
      await api(
        `/judge/events/${eventId}/divisions/${divisionId}/rounds/${roundId}/scores/edit`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedRevision: sheet.revision }),
        },
      )
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to edit')
    }
  }

  function setImpression(competitorId: string, value: number) {
    const clamped = Math.min(10, Math.max(1, Math.round(value * 2) / 2))
    setImpressions((current) => ({ ...current, [competitorId]: clamped }))
    setDirty(true)
  }

  function goBack() {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    navigate(`/judge/events/${eventId}/divisions/${divisionId}/rounds`)
  }

  if (!sheet && !error) {
    return (
      <Box sx={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading round" />
      </Box>
    )
  }

  const locked = sheet?.status === 'locked'
  const isCallback = sheet?.round.type === 'callback'
  const isStrictly = sheet?.division.type === 'strictly'
  const allEntries = sheet?.heats.flatMap((heat) => heat.entries) ?? []
  const visibleEntries = isCallback
    ? allEntries
    : allEntries
  const scoped = (entries: RoundSheetEntry[]) =>
    isCallback && !isStrictly
      ? entries.filter((entry) => scope === 'both' || entry.role === scope)
      : entries
  const rankOptions = Array.from(
    { length: allEntries.length },
    (_, index) => index + 1,
  )
  const missingMarks = visibleEntries.filter(
    (entry) => marks[entry.competitorId] === undefined,
  )
  const rankValues = allEntries.map((entry) => marks[entry.competitorId])
  const duplicateRanks =
    !isCallback &&
    new Set(rankValues.filter((rank) => rank !== undefined)).size !==
      rankValues.filter((rank) => rank !== undefined).length

  return (
    <Box sx={{ pb: 'calc(88px + env(safe-area-inset-bottom))' }}>
      <Button onClick={goBack} sx={{ mb: 1 }}>
        Back to rounds
      </Button>
      {sheet && (
        <>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 1,
              mb: 1,
            }}
          >
            <Box>
              <Typography variant="h5" component="h1">
                {sheet.round.name}
              </Typography>
              <Typography color="text.secondary">
                {sheet.division.name} · {sheet.event.name}
              </Typography>
            </Box>
            <Chip
              color={locked ? 'success' : 'warning'}
              label={locked ? 'Submitted' : 'Editing'}
            />
          </Box>
          {locked && sheet.submittedAt && (
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Saved {new Date(sheet.submittedAt).toLocaleString()}
            </Typography>
          )}
        </>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ my: 2 }}>
          {error}
        </Alert>
      )}
      {locked && (
        <Alert severity="success" sx={{ my: 2 }}>
          This ballot is saved and locked. Select Edit to make changes.
        </Alert>
      )}
      {sheet && sheet.round.status !== 'active' && !locked && (
        <Alert severity="info" sx={{ my: 2 }}>
          This round is not open for scoring.
        </Alert>
      )}
      {sheet && !allEntries.length && (
        <Alert severity="info" sx={{ my: 2 }}>
          No entries are assigned to this round yet.
        </Alert>
      )}

      {sheet && isCallback && !isStrictly && allEntries.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography component="label" id="round-scope-label" variant="subtitle2">
            Judge
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            value={scope}
            disabled={locked}
            aria-labelledby="round-scope-label"
            onChange={(_event, next: Scope | null) => {
              if (!next || next === scope) return
              setScope(next)
              setDirty(true)
            }}
            sx={{ mt: 1 }}
          >
            <ToggleButton value="lead">Leads</ToggleButton>
            <ToggleButton value="follow">Follows</ToggleButton>
            <ToggleButton value="both">Both</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      )}

      {sheet?.heats.map((heat) => {
        const entries = scoped(heat.entries)
        if (!entries.length) return null
        return (
          <Box key={heat.id} sx={{ mt: 3 }}>
            {sheet.heats.length > 1 && (
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Heat {heat.position}
              </Typography>
            )}
            <Stack spacing={2}>
              {entries.map((entry) => (
                <Card key={entry.competitorId} variant="outlined">
                  <CardContent
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 2,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Box>
                      <Typography variant="subtitle1">
                        {entryName(entry)}
                      </Typography>
                      {entry.role && (
                        <Typography variant="body2" color="text.secondary">
                          {entry.role}
                        </Typography>
                      )}
                    </Box>
                    {isCallback ? (
                      <ToggleButtonGroup
                        exclusive
                        size="large"
                        value={marks[entry.competitorId] ?? null}
                        disabled={locked}
                        onChange={(_event, vote: CallbackVote | null) => {
                          if (!vote) return
                          setMarks((current) => ({
                            ...current,
                            [entry.competitorId]: vote,
                          }))
                          setDirty(true)
                        }}
                      >
                        <ToggleButton value="yes">Yes</ToggleButton>
                        <ToggleButton value="alternate">Alt</ToggleButton>
                        <ToggleButton value="no">No</ToggleButton>
                      </ToggleButtonGroup>
                    ) : (
                      <FormControl size="small" sx={{ minWidth: 110 }}>
                        <InputLabel id={`rank-${entry.competitorId}`}>
                          Rank
                        </InputLabel>
                        <Select
                          labelId={`rank-${entry.competitorId}`}
                          label="Rank"
                          value={
                            marks[entry.competitorId] === undefined
                              ? ''
                              : String(marks[entry.competitorId])
                          }
                          disabled={locked}
                          onChange={(selectEvent) => {
                            setMarks((current) => ({
                              ...current,
                              [entry.competitorId]: Number(
                                selectEvent.target.value,
                              ),
                            }))
                            setDirty(true)
                          }}
                        >
                          {rankOptions.map((rank) => (
                            <MenuItem key={rank} value={rank}>
                              {rank}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        flexBasis: '100%',
                      }}
                    >
                      <IconButton
                        size="small"
                        aria-label="Decrease impression score"
                        disabled={
                          locked ||
                          (impressions[entry.competitorId] ?? 5.5) <= 1
                        }
                        onClick={() =>
                          setImpression(
                            entry.competitorId,
                            (impressions[entry.competitorId] ?? 5.5) - 0.5,
                          )
                        }
                      >
                        −
                      </IconButton>
                      <Slider
                        value={impressions[entry.competitorId] ?? 5.5}
                        min={1}
                        max={10}
                        step={0.5}
                        disabled={locked}
                        aria-label={`Impression for ${entryName(entry)}`}
                        onChange={(_event, value) =>
                          setImpression(entry.competitorId, value as number)
                        }
                        sx={{ flex: 1, minWidth: 0 }}
                      />
                      <IconButton
                        size="small"
                        aria-label="Increase impression score"
                        disabled={
                          locked ||
                          (impressions[entry.competitorId] ?? 5.5) >= 10
                        }
                        onClick={() =>
                          setImpression(
                            entry.competitorId,
                            (impressions[entry.competitorId] ?? 5.5) + 0.5,
                          )
                        }
                      >
                        +
                      </IconButton>
                      <Paper
                        variant="outlined"
                        sx={{
                          width: 48,
                          height: 48,
                          minWidth: 48,
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                          bgcolor: locked
                            ? 'action.disabledBackground'
                            : 'background.paper',
                        }}
                      >
                        {impressions[entry.competitorId]?.toFixed(1) ?? '—'}
                      </Paper>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </Box>
        )
      })}

      {!isCallback && duplicateRanks && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          Each finalist needs a unique rank.
        </Alert>
      )}
      {!isCallback && missingMarks.length > 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {missingMarks.length} finalist
          {missingMarks.length === 1 ? '' : 's'} still need a rank.
        </Alert>
      )}

      {sheet && allEntries.length > 0 && sheet.round.status === 'active' && (
        <Box
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            bgcolor: 'background.paper',
            borderTop: 1,
            borderColor: 'divider',
            p: 2,
            pb: 'calc(16px + env(safe-area-inset-bottom))',
          }}
        >
          <Button
            variant="contained"
            size="large"
            fullWidth
            disabled={saving || (!locked && (!isCallback ? duplicateRanks || missingMarks.length > 0 : false))}
            onClick={() => void (locked ? edit() : save())}
          >
            {saving ? 'Saving…' : locked ? 'Edit ballot' : 'Submit ballot'}
          </Button>
        </Box>
      )}
      {sheet && allEntries.length > 0 && sheet.round.status !== 'active' && locked && (
        <Box
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            bgcolor: 'background.paper',
            borderTop: 1,
            borderColor: 'divider',
            p: 2,
            pb: 'calc(16px + env(safe-area-inset-bottom))',
          }}
        >
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={() => void edit()}
          >
            Edit ballot
          </Button>
        </Box>
      )}
    </Box>
  )
}
