import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
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
  type ScoreCompetitor,
  type ScoreSheet,
} from '../api/client'
import ScoreSliderRow from '../components/ScoreSliderRow'

type Scope = 'lead' | 'follow' | 'both'

function competitorLabel(
  competitor: ScoreCompetitor | undefined,
  isPairMode: boolean,
) {
  if (!competitor) return ''
  if (isPairMode) {
    return `#${competitor.bibNumber}${
      competitor.leadFirstName && competitor.followFirstName
        ? ` ${competitor.leadFirstName} & ${competitor.followFirstName}`
        : ''
    }`
  }
  return `#${competitor.bibNumber}${
    competitor.firstName ? ` ${competitor.firstName}` : ''
  }${competitor.lastName ? ` ${competitor.lastName}` : ''}`
}

function groupTitle(role: 'lead' | 'follow' | 'pair') {
  if (role === 'lead') return 'Leads'
  if (role === 'follow') return 'Follows'
  return 'Pairs'
}

export default function ScoringPage() {
  const { eventId = '', divisionId = '' } = useParams()
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<ScoreSheet | null>(null)
  const [values, setValues] = useState<Record<string, number>>({})
  const [marks, setMarks] = useState<Record<string, CallbackVote>>({})
  const [altPicks, setAltPicks] = useState<Record<string, 1 | 2>>({})
  const [scope, setScope] = useState<Scope>('both')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const result = await api<ScoreSheet>(
        `/judge/events/${eventId}/divisions/${divisionId}/scores`,
      )
      setSheet(result)
      setScope(result.scope)
      setValues(
        Object.fromEntries(
          result.competitors.map((competitor) => [
            competitor.competitorId,
            competitor.score ?? 5,
          ]),
        ),
      )
      const nextMarks: Record<string, CallbackVote> = {}
      const nextAltPicks: Record<string, 1 | 2> = {}
      for (const competitor of result.competitors) {
        if (competitor.mark) nextMarks[competitor.competitorId] = competitor.mark
        if (competitor.altRank === 1 || competitor.altRank === 2) {
          nextAltPicks[competitor.competitorId] = competitor.altRank
        }
      }
      setMarks(nextMarks)
      setAltPicks(nextAltPicks)
      setDirty(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load scores')
    }
  }, [divisionId, eventId])

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

  async function saveScores() {
    if (!sheet) return
    const pairMode = sheet.scoringMode === 'pairs'
    const useVotes = Boolean(sheet.advancement)
    setSaving(true)
    setError('')
    try {
      const entries = pairMode
        ? sheet.competitors
        : sheet.competitors.filter(
            (competitor) => scope === 'both' || competitor.role === scope,
          )
      await api(`/judge/events/${eventId}/divisions/${divisionId}/scores`, {
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: sheet.revision,
          ...(pairMode ? {} : { scope }),
          ...(useVotes
            ? {
                votes: entries.map((competitor) => ({
                  competitorId: competitor.competitorId,
                  vote: marks[competitor.competitorId] ?? 'no',
                })),
              }
            : {
                scores: entries.map((competitor) => ({
                  competitorId: competitor.competitorId,
                  score: values[competitor.competitorId],
                })),
              }),
        }),
      })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save scores')
    } finally {
      setSaving(false)
    }
  }

  async function saveAlternates() {
    if (!sheet) return
    setSaving(true)
    setError('')
    try {
      await api(
        `/judge/events/${eventId}/divisions/${divisionId}/scores/alternates`,
        {
          method: 'PUT',
          body: JSON.stringify({
            alternates: Object.entries(altPicks).map(
              ([competitorId, rank]) => ({ competitorId, rank }),
            ),
          }),
        },
      )
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to save alternates',
      )
    } finally {
      setSaving(false)
    }
  }

  async function editScores() {
    if (!sheet) return
    setError('')
    try {
      await api(
        `/judge/events/${eventId}/divisions/${divisionId}/scores/edit`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedRevision: sheet.revision }),
        },
      )
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to edit scores')
    }
  }

  function setAltPick(groupIds: Set<string>, competitorId: string, rank: 1 | 2) {
    setAltPicks((current) => {
      const next = { ...current }
      for (const [id, currentRank] of Object.entries(next)) {
        if (groupIds.has(id) && currentRank === rank) delete next[id]
      }
      if (next[competitorId] === rank) delete next[competitorId]
      else next[competitorId] = rank
      return next
    })
  }

  function goBack() {
    if (dirty && !window.confirm('Discard your unsaved score changes?')) return
    navigate(`/judge/events/${eventId}/divisions`)
  }

  if (!sheet && !error) {
    return (
      <Box sx={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading scores" />
      </Box>
    )
  }

  const locked = sheet?.status === 'locked'
  const isPairMode = sheet?.scoringMode === 'pairs'
  const advancement = sheet?.advancement ?? null
  const visibleCompetitors = isPairMode
    ? (sheet?.competitors ?? [])
    : (sheet?.competitors.filter(
        (competitor) => scope === 'both' || competitor.role === scope,
      ) ?? [])
  const competitorById = new Map(
    (sheet?.competitors ?? []).map((competitor) => [
      competitor.competitorId,
      competitor,
    ]),
  )
  const confirmGroups = (advancement?.groups ?? []).filter(
    (group) =>
      group.role === 'pair' || scope === 'both' || group.role === scope,
  )
  const alternatesComplete = confirmGroups.every((group) => {
    const remaining = group.results.filter((row) => !row.advancing)
    const needed = Math.min(2, remaining.length)
    const picked = remaining.filter(
      (row) => altPicks[row.competitorId] !== undefined,
    ).length
    return picked === needed
  })

  return (
    <Box sx={{ pb: 'calc(88px + env(safe-area-inset-bottom))' }}>
      <Button onClick={goBack} sx={{ mb: 1 }}>
        Back to divisions
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
                {sheet.division.name}
              </Typography>
              <Typography color="text.secondary">{sheet.event.name}</Typography>
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
          <Button
            variant="text"
            onClick={() =>
              navigate(
                `/judge/events/${eventId}/divisions/${divisionId}/status`,
              )
            }
          >
            View division status
          </Button>
        </>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ my: 2 }}>
          {error}
        </Alert>
      )}
      {locked && (
        <Alert severity="success" sx={{ my: 2 }}>
          {advancement
            ? 'These marks are saved and locked. Select Edit marks to make changes.'
            : 'These scores are saved and locked. Select Edit scores to make changes.'}
        </Alert>
      )}
      {sheet && !sheet.competitors.length && (
        <Alert severity="info" sx={{ my: 2 }}>
          {isPairMode
            ? 'No pairs are configured in this division.'
            : 'No competitors are registered in this division.'}
        </Alert>
      )}

      {sheet && !isPairMode && sheet.competitors.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography
            component="label"
            id="judging-scope-label"
            variant="subtitle2"
          >
            Score competitors
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            value={scope}
            disabled={locked}
            aria-labelledby="judging-scope-label"
            onChange={(_event, nextScope: Scope | null) => {
              if (!nextScope || nextScope === scope) return
              setScope(nextScope)
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

      {sheet && !isPairMode && sheet.competitors.length > 0 && !visibleCompetitors.length && (
        <Alert severity="info" sx={{ mt: 2 }}>
          No {scope === 'lead' ? 'leads' : 'follows'} are registered in this division.
        </Alert>
      )}

      <Stack spacing={2} sx={{ mt: 3 }}>
        {visibleCompetitors.map((competitor) => (
          <Card key={competitor.competitorId} variant="outlined">
            {advancement ? (
              <CardContent
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  flexWrap: 'wrap',
                }}
              >
                <Typography variant="subtitle1">
                  {competitorLabel(competitor, Boolean(isPairMode))}
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="large"
                  value={marks[competitor.competitorId] ?? null}
                  disabled={locked}
                  onChange={(_event, vote: CallbackVote | null) => {
                    if (!vote) return
                    setMarks((current) => ({
                      ...current,
                      [competitor.competitorId]: vote,
                    }))
                    setDirty(true)
                  }}
                >
                  <ToggleButton value="yes">Yes</ToggleButton>
                  <ToggleButton value="alternate">Alt</ToggleButton>
                  <ToggleButton value="no">No</ToggleButton>
                </ToggleButtonGroup>
              </CardContent>
            ) : (
              <CardContent>
                <ScoreSliderRow
                  bibNumber={competitor.bibNumber}
                  competitorName={
                    isPairMode
                      ? competitor.leadFirstName && competitor.followFirstName
                        ? `${competitor.leadFirstName} & ${competitor.followFirstName}`
                        : undefined
                      : competitor.firstName
                        ? `${competitor.firstName}`
                        : undefined
                  }
                  role={isPairMode ? undefined : competitor.role}
                  score={values[competitor.competitorId] ?? 5}
                  disabled={locked}
                  onScoreChange={(score) => {
                    setValues((current) => ({
                      ...current,
                      [competitor.competitorId]: score,
                    }))
                    setDirty(true)
                  }}
                />
              </CardContent>
            )}
          </Card>
        ))}
      </Stack>

      {locked && advancement && confirmGroups.length > 0 && (
        <Card variant="outlined" sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Confirm advancement
            </Typography>
            <Stack spacing={3}>
              {confirmGroups.map((group) => {
                const advancing = group.results.filter((row) => row.advancing)
                const remaining = group.results.filter((row) => !row.advancing)
                const remainingIds = new Set(
                  remaining.map((row) => row.competitorId),
                )
                return (
                  <Box key={group.role}>
                    {confirmGroups.length > 1 && (
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        {groupTitle(group.role)}
                      </Typography>
                    )}
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      These competitors will advance:
                    </Typography>
                    {advancing.length ? (
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ mb: 2, flexWrap: 'wrap' }}
                      >
                        {advancing.map((row) => (
                          <Chip
                            key={row.competitorId}
                            size="small"
                            color="success"
                            label={competitorLabel(
                              competitorById.get(row.competitorId),
                              Boolean(isPairMode),
                            )}
                          />
                        ))}
                      </Stack>
                    ) : (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 2 }}
                      >
                        None yet — waiting on other judges.
                      </Typography>
                    )}
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      Choose your ALT 1 and ALT 2:
                    </Typography>
                    {remaining.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        No remaining competitors to choose from.
                      </Typography>
                    )}
                    <Stack spacing={1}>
                      {remaining.map((row) => (
                        <Box
                          key={row.competitorId}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 2,
                            flexWrap: 'wrap',
                          }}
                        >
                          <Typography variant="body2">
                            {competitorLabel(
                              competitorById.get(row.competitorId),
                              Boolean(isPairMode),
                            )}{' '}
                            ({row.points})
                          </Typography>
                          <ToggleButtonGroup
                            exclusive
                            size="small"
                            value={altPicks[row.competitorId] ?? null}
                            onChange={(_event, rank: 1 | 2 | null) => {
                              if (!rank) return
                              setAltPick(
                                remainingIds,
                                row.competitorId,
                                rank,
                              )
                            }}
                          >
                            <ToggleButton value={1}>Alt 1</ToggleButton>
                            <ToggleButton value={2}>Alt 2</ToggleButton>
                          </ToggleButtonGroup>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                )
              })}
              <Button
                variant="contained"
                onClick={() => void saveAlternates()}
                disabled={saving || !alternatesComplete}
              >
                {saving ? 'Saving…' : 'Confirm alternates'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {sheet && sheet.competitors.length > 0 && (
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
            disabled={saving}
            onClick={() => void (locked ? editScores() : saveScores())}
          >
            {saving
              ? 'Saving…'
              : locked
                ? advancement
                  ? 'Edit marks'
                  : 'Edit scores'
                : advancement
                  ? 'Submit marks'
                  : 'Save scores'}
          </Button>
        </Box>
      )}
    </Box>
  )
}
