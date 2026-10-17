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
  type CallbackVote,
  type DivisionJudgeStatus,
  type DivisionRound,
  type DivisionStatus,
  type RoundResults,
} from '../api/client'
import { useAuth } from '../context/auth'
import JudgeScoreTable from '../components/JudgeScoreTable'
import { competitorLabel, judgeLabel } from '../utils/format'

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
                primary={
                  <>
                    {judge.firstName} {judge.lastName}
                    {judge.isHead && (
                      <Chip size="small" label="Head" sx={{ ml: 1 }} />
                    )}
                  </>
                }
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

const resultRowLabel = competitorLabel

function RoundResultsTable({
  results,
  type,
}: {
  results: RoundResults
  type: DivisionRound['type']
}) {
  const judges = results.judges.submitted.map((judge) => ({
    id: judge.id,
    label: judgeLabel(judge),
    isHead: judge.isHead,
  }))
  const voteBallots = new Map(
    (results.results.voteBallots ?? []).map((ballot) => [
      ballot.judgeId,
      ballot.votes,
    ]),
  )
  const rankBallots = new Map(
    (results.results.ballots ?? []).map((ballot) => [
      ballot.judgeId,
      ballot.ranks,
    ]),
  )
  const voteMark = (vote?: CallbackVote) =>
    vote === 'yes'
      ? 'Y'
      : vote === 'alternate'
        ? 'A'
        : vote === 'no'
          ? 'N'
          : undefined

  if (type === 'callback') {
    const groups = [
      { title: 'Leads', rows: results.results.leads ?? [] },
      { title: 'Follows', rows: results.results.follows ?? [] },
      { title: 'Entries', rows: results.results.entries ?? [] },
    ].filter((group) => group.rows.length)
    if (!groups.length) {
      return (
        <Typography color="text.secondary">No locked ballots yet.</Typography>
      )
    }
    return (
      <Stack spacing={2}>
        {groups.map((group) => (
          <Box key={group.title}>
            {groups.length > 1 && (
              <Typography variant="subtitle2">{group.title}</Typography>
            )}
            <JudgeScoreTable
              judges={judges}
              resultHeaders={['Pts']}
              rows={group.rows.map((row) => ({
                key: row.competitorId,
                label: resultRowLabel(row),
                results: [row.points],
              }))}
              cell={(judgeId, key) => voteMark(voteBallots.get(judgeId)?.[key])}
            />
          </Box>
        ))}
      </Stack>
    )
  }

  const placements = results.results.placements ?? []
  if (!placements.length) {
    return (
      <Typography color="text.secondary">No locked ballots yet.</Typography>
    )
  }
  return (
    <JudgeScoreTable
      judges={judges}
      resultHeaders={['Place']}
      rows={placements.map((row) => ({
        key: row.competitorId,
        label: resultRowLabel(row),
        results: [row.placement ?? '—'],
      }))}
      cell={(judgeId, key) => rankBallots.get(judgeId)?.[key] ?? '—'}
    />
  )
}

function voteMarkLabel(vote?: string, altRank?: number) {
  if (altRank === 1 || altRank === 2) return `A${altRank}`
  if (vote === 'yes') return 'Y'
  if (vote === 'alternate') return 'A'
  if (vote === 'no') return 'N'
  return '—'
}

function NumericResultsTable({
  title,
  rows,
  judges,
  ballotByJudge,
  showAdvancing = false,
  voteBallotByJudge,
}: {
  title: string
  rows: Array<{
    key: string
    label: string
    average: number
    placement: number | null
    advancing?: boolean
  }>
  judges: { id: string; label: string; isHead?: boolean }[]
  ballotByJudge: Map<string, Record<string, number>>
  showAdvancing?: boolean
  voteBallotByJudge?: Map<
    string,
    { votes: Record<string, string>; altRanks: Record<string, number> }
  >
}) {
  const isVoteMode = Boolean(voteBallotByJudge)
  const resultHeaders = [
    isVoteMode ? 'Pts' : 'Avg',
    'Place',
    ...(showAdvancing ? ['Adv'] : []),
  ]
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">{title}</Typography>
        {!rows.length && (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {isVoteMode ? 'No locked ballots yet' : 'No locked scores yet'}
          </Typography>
        )}
        {rows.length > 0 && (
          <JudgeScoreTable
            judges={judges}
            resultHeaders={resultHeaders}
            rows={rows.map((row) => ({
              key: row.key,
              label: row.label,
              results: [
                row.average.toFixed(2),
                row.placement ?? '—',
                ...(showAdvancing
                  ? [
                      row.advancing ? (
                        <Chip
                          key="advancing"
                          size="small"
                          color="success"
                          label="Yes"
                        />
                      ) : (
                        '—'
                      ),
                    ]
                  : []),
              ],
            }))}
            cell={(judgeId, key) =>
              isVoteMode
                ? voteMarkLabel(
                    voteBallotByJudge?.get(judgeId)?.votes[key],
                    voteBallotByJudge?.get(judgeId)?.altRanks[key],
                  )
                : (ballotByJudge.get(judgeId)?.[key] ?? '—')
            }
          />
        )}
      </CardContent>
    </Card>
  )
}

function RoundsStatusList({
  eventId,
  divisionId,
}: {
  eventId: string
  divisionId: string
}) {
  const [rounds, setRounds] = useState<DivisionRound[]>([])
  const [results, setResults] = useState<Record<string, RoundResults>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    api<DivisionRound[]>(`/events/${eventId}/divisions/${divisionId}/rounds`)
      .then(async (roundRows) => {
        setRounds(roundRows)
        const entries = await Promise.all(
          roundRows.map(async (round) => [
            round.id,
            await api<RoundResults>(
              `/events/${eventId}/divisions/${divisionId}/rounds/${round.id}/results`,
            ),
          ]),
        )
        setResults(Object.fromEntries(entries))
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : 'Unable to load rounds',
        )
      })
  }, [divisionId, eventId])

  if (error) return <Alert severity="error">{error}</Alert>
  if (!rounds.length) {
    return <Alert severity="info">This division has no rounds yet.</Alert>
  }

  return (
    <Stack spacing={2}>
      {rounds.map((round) => {
        const result = results[round.id]
        return (
          <Card key={round.id} variant="outlined">
            <CardContent>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 1,
                  mb: 1,
                  flexWrap: 'wrap',
                }}
              >
                <Typography variant="h6">
                  {round.position}. {round.name}
                </Typography>
                <Chip
                  size="small"
                  label={`${round.status} · ${round.lockedSubmissions} ballots`}
                />
              </Box>
              <Typography color="text.secondary" sx={{ mb: 1 }}>
                {round.type === 'callback'
                  ? 'Callback'
                  : 'Relative placement'}
              </Typography>
              {result ? (
                <RoundResultsTable results={result} type={round.type} />
              ) : (
                <Typography color="text.secondary">
                  Loading results…
                </Typography>
              )}
            </CardContent>
          </Card>
        )
      })}
    </Stack>
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
  const advanceCount = status?.division.advanceCount ?? null
  const showAdvancing = Boolean(advanceCount && advanceCount > 0)
  const ballotByJudge = new Map(
    (status?.ballots ?? []).map((ballot) => [ballot.judgeId, ballot.scores]),
  )
  const voteBallotByJudge =
    status?.voteBallots && status.voteBallots.length
      ? new Map(
          status.voteBallots.map((ballot) => [
            ballot.judgeId,
            { votes: ballot.votes, altRanks: ballot.altRanks },
          ]),
        )
      : undefined
  const judgeColumns = (status?.judges.submitted ?? []).map((judge) => ({
    id: judge.id,
    label: judgeLabel(judge),
    isHead: judge.isHead,
  }))

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

          {status.division.scoringMode === 'rounds' ? (
            <RoundsStatusList
              eventId={eventId}
              divisionId={divisionId}
            />
          ) : (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
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
                  {showAdvancing
                    ? ` Top ${advanceCount} highest-scoring entries in each group are marked as advancing.`
                    : ''}
                </Alert>
              </Box>
              {isStrictly ? (
                <NumericResultsTable
                  title="Pairs"
                  rows={status.preliminaryResults.pairs.map((pair) => ({
                    key: pair.leadCompetitorId,
                    label: `#${pair.leadBibNumber}${
                      pair.leadFirstName && pair.followFirstName
                        ? ` — ${pair.leadFirstName} & ${pair.followFirstName}`
                        : ''
                    }`,
                    average: pair.points ?? pair.average,
                    placement: pair.placement,
                    advancing: pair.advancing,
                  }))}
                  judges={judgeColumns}
                  ballotByJudge={ballotByJudge}
                  showAdvancing={showAdvancing}
                  voteBallotByJudge={voteBallotByJudge}
                />
              ) : (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 2,
                  }}
                >
                  <NumericResultsTable
                    title="Leads"
                    rows={status.preliminaryResults.leads.map((row) => ({
                      key: row.competitorId,
                      label: `#${row.bibNumber}${
                        row.firstName && row.lastName
                          ? ` — ${row.firstName} ${row.lastName}`
                          : ''
                      }`,
                      average: row.points ?? row.average,
                      placement: row.placement,
                      advancing: row.advancing,
                    }))}
                    judges={judgeColumns}
                    ballotByJudge={ballotByJudge}
                    showAdvancing={showAdvancing}
                    voteBallotByJudge={voteBallotByJudge}
                  />
                  <NumericResultsTable
                    title="Follows"
                    rows={status.preliminaryResults.follows.map((row) => ({
                      key: row.competitorId,
                      label: `#${row.bibNumber}${
                        row.firstName && row.lastName
                          ? ` — ${row.firstName} ${row.lastName}`
                          : ''
                      }`,
                      average: row.points ?? row.average,
                      placement: row.placement,
                      advancing: row.advancing,
                    }))}
                    judges={judgeColumns}
                    ballotByJudge={ballotByJudge}
                    showAdvancing={showAdvancing}
                    voteBallotByJudge={voteBallotByJudge}
                  />
                </Box>
              )}
            </>
          )}
        </Stack>
      )}
    </>
  )
}
