import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api,
  type DivisionJudgeStatus,
  type DivisionStatus,
  type PreliminaryPairResult,
  type PreliminaryResult,
} from '../api/client'
import { useAuth } from '../context/auth'

function scopeLabel(
  scope: DivisionJudgeStatus['scope'],
  strictly = false,
) {
  if (strictly && scope === 'lead') return 'Pairs'
  if (scope === 'lead') return 'Leads'
  if (scope === 'follow') return 'Follows'
  if (scope === 'both') return 'Both'
  return 'Not selected'
}

function JudgeList({
  title,
  judges,
  submitted,
  strictly = false,
}: {
  title: string
  judges: DivisionJudgeStatus[]
  submitted: boolean
  strictly?: boolean
}) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">
          {title} ({judges.length})
        </Typography>
        {!judges.length && (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            No judges
          </Typography>
        )}
        <List disablePadding>
          {judges.map((judge) => (
            <ListItem
              key={judge.id}
              disableGutters
              secondaryAction={
                <Chip
                  size="small"
                  color={submitted ? 'success' : 'default'}
                  label={scopeLabel(judge.scope, strictly)}
                />
              }
            >
              <ListItemText
                primary={`${judge.firstName} ${judge.lastName}`}
                secondary={
                  judge.submittedAt
                    ? new Date(judge.submittedAt).toLocaleString()
                    : judge.status === 'editing'
                      ? 'Editing'
                      : 'Not started'
                }
              />
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  )
}

function PairResultsList({ results }: { results: PreliminaryPairResult[] }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">Pairs</Typography>
        {!results.length && (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            No locked scores yet
          </Typography>
        )}
        <List disablePadding>
          {results.map((result) => {
            const names =
              result.leadFirstName && result.followFirstName
                ? ` — ${result.leadFirstName} & ${result.followFirstName}`
                : ''
            return (
              <ListItem key={result.leadCompetitorId} disableGutters>
                <ListItemText
                  primary={`#${result.leadBibNumber}${names}`}
                  secondary={`${result.submittedScoreCount} submitted score${result.submittedScoreCount === 1 ? '' : 's'}`}
                />
                <Typography
                  variant="h6"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {result.average.toFixed(2)}
                </Typography>
              </ListItem>
            )
          })}
        </List>
      </CardContent>
    </Card>
  )
}

function ResultsList({
  title,
  results,
}: {
  title: string
  results: PreliminaryResult[]
}) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">{title}</Typography>
        {!results.length && (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            No locked scores yet
          </Typography>
        )}
        <List disablePadding>
          {results.map((result) => {
            const name =
              result.firstName && result.lastName
                ? ` — ${result.firstName} ${result.lastName}`
                : ''
            return (
              <ListItem key={result.competitorId} disableGutters>
                <ListItemText
                  primary={`#${result.bibNumber}${name}`}
                  secondary={`${result.submittedScoreCount} submitted score${result.submittedScoreCount === 1 ? '' : 's'}`}
                />
                <Typography
                  variant="h6"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {result.average.toFixed(2)}
                </Typography>
              </ListItem>
            )
          })}
        </List>
      </CardContent>
    </Card>
  )
}

export default function DivisionStatusPage() {
  const { eventId = '', divisionId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<DivisionStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<DivisionStatus>(
      `/events/${eventId}/divisions/${divisionId}/status`,
    )
      .then(setStatus)
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : 'Unable to load status',
        )
      })
  }, [divisionId, eventId])

  if (!status && !error) {
    return (
      <Box sx={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading division status" />
      </Box>
    )
  }

  const submittedCount = status?.judges.submitted.length ?? 0
  const pendingCount = status?.judges.pending.length ?? 0
  const isStrictly = status?.division.type === 'strictly'

  return (
    <>
      <Button
        onClick={() =>
          navigate(
            user?.role === 'judge'
              ? `/judge/events/${eventId}/divisions`
              : `/events/${eventId}/divisions`,
          )
        }
        sx={{ mb: 1 }}
      >
        Back to divisions
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
      {status && (
        <Stack spacing={3}>
          <Box>
            <Typography variant="h5" component="h1">
              {status.division.name} status
            </Typography>
            <Typography color="text.secondary">
              {status.event.name}
            </Typography>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 2,
            }}
          >
            <Card variant="outlined">
              <CardContent>
                <Typography color="text.secondary">Submitted</Typography>
                <Typography variant="h4">{submittedCount}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>
                <Typography color="text.secondary">Pending</Typography>
                <Typography variant="h4">{pendingCount}</Typography>
              </CardContent>
            </Card>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: 2,
            }}
          >
            <JudgeList
              title="Submitted"
              judges={status.judges.submitted}
              submitted
              strictly={isStrictly}
            />
            <JudgeList
              title="Pending"
              judges={status.judges.pending}
              submitted={false}
              strictly={isStrictly}
            />
          </Box>

          <Box>
            <Typography variant="h6">Provisional results</Typography>
            <Alert severity="info" sx={{ mt: 1 }}>
              Preliminary — scoring rules not finalized.
            </Alert>
          </Box>
          {isStrictly ? (
            <PairResultsList results={status.preliminaryResults.pairs} />
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 2,
              }}
            >
              <ResultsList
                title="Leads"
                results={status.preliminaryResults.leads}
              />
              <ResultsList
                title="Follows"
                results={status.preliminaryResults.follows}
              />
            </Box>
          )}
        </Stack>
      )}
    </>
  )
}
