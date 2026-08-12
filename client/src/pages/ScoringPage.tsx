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
import { api, type ScoreSheet } from '../api/client'
import ScoreSliderRow from '../components/ScoreSliderRow'

type Scope = 'lead' | 'follow' | 'both'

export default function ScoringPage() {
  const { eventId = '', divisionId = '' } = useParams()
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<ScoreSheet | null>(null)
  const [values, setValues] = useState<Record<string, number>>({})
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
    setSaving(true)
    setError('')
    try {
      await api(
        `/judge/events/${eventId}/divisions/${divisionId}/scores`,
        {
          method: 'PUT',
          body: JSON.stringify({
            expectedRevision: sheet.revision,
            ...(pairMode ? {} : { scope }),
            scores: (pairMode
              ? sheet.competitors
              : sheet.competitors.filter(
                  (competitor) =>
                    scope === 'both' || competitor.role === scope,
                )
            ).map((competitor) => ({
              competitorId: competitor.competitorId,
              score: values[competitor.competitorId],
            })),
          }),
        },
      )
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save scores')
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
  const visibleCompetitors = isPairMode
    ? (sheet?.competitors ?? [])
    : (sheet?.competitors.filter(
        (competitor) => scope === 'both' || competitor.role === scope,
      ) ?? [])

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
          These scores are saved and locked. Select Edit scores to make changes.
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
            <CardContent>
              <ScoreSliderRow
                bibNumber={competitor.bibNumber}
                competitorName={
                  isPairMode
                    ? competitor.leadFirstName && competitor.followFirstName
                      ? `${competitor.leadFirstName} & ${competitor.followFirstName}`
                      : undefined
                    : competitor.firstName && competitor.lastName
                      ? `${competitor.firstName} ${competitor.lastName}`
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
          </Card>
        ))}
      </Stack>

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
            {saving ? 'Saving…' : locked ? 'Edit scores' : 'Save scores'}
          </Button>
        </Box>
      )}
    </Box>
  )
}
