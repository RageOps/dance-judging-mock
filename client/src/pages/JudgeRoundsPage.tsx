import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api,
  type Division,
  type DivisionRound,
  type Event,
  type RoundStatus,
} from '../api/client'

const statusLabel = {
  not_started: 'Not started',
  editing: 'Editing',
  locked: 'Submitted',
} as const

const statusColor = {
  not_started: 'default',
  editing: 'warning',
  locked: 'success',
} as const

const roundStatusLabel: Record<RoundStatus, string> = {
  pending: 'Not open',
  active: 'Open',
  complete: 'Complete',
}

export default function JudgeRoundsPage() {
  const { eventId = '', divisionId = '' } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<Event | null>(null)
  const [division, setDivision] = useState<Division | null>(null)
  const [rounds, setRounds] = useState<DivisionRound[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api<Event>(`/events/${eventId}`),
      api<Division[]>(`/events/${eventId}/divisions`),
      api<DivisionRound[]>(
        `/events/${eventId}/divisions/${divisionId}/rounds`,
      ),
    ])
      .then(([eventRow, divisionRows, roundRows]) => {
        setEvent(eventRow)
        setDivision(divisionRows.find((row) => row.id === divisionId) ?? null)
        setRounds(roundRows)
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : 'Unable to load rounds',
        )
      })
  }, [divisionId, eventId])

  return (
    <>
      <Button
        onClick={() => navigate(`/judge/events/${eventId}/divisions`)}
        sx={{ mb: 1 }}
      >
        Back to divisions
      </Button>
      <Typography variant="h5" component="h1">
        {division?.name ?? 'Division'} rounds
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {event?.name}
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!rounds.length && !error && (
        <Alert severity="info">This division has no rounds yet.</Alert>
      )}
      <Stack spacing={2}>
        {rounds.map((round) => {
          const entryCount = round.heats.reduce(
            (total, heat) => total + heat.entries.length,
            0,
          )
          return (
            <Card key={round.id} variant="outlined">
              <CardActionArea
                disabled={round.status === 'pending'}
                onClick={() =>
                  navigate(
                    `/judge/events/${eventId}/divisions/${divisionId}/rounds/${round.id}/score`,
                  )
                }
              >
                <CardContent>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 1,
                      mb: 1,
                    }}
                  >
                    <Typography variant="h6">
                      {round.position}. {round.name}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={roundStatusLabel[round.status]}
                      />
                      <Chip
                        size="small"
                        color={statusColor[round.myStatus ?? 'not_started']}
                        label={statusLabel[round.myStatus ?? 'not_started']}
                      />
                    </Box>
                  </Box>
                  <Typography color="text.secondary">
                    {round.type === 'callback'
                      ? 'Callback round'
                      : 'Final — relative placement'}
                    {' · '}
                    {entryCount} entries
                    {round.heats.length > 1
                      ? ` in ${round.heats.length} heats`
                      : ''}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          )
        })}
      </Stack>
    </>
  )
}
