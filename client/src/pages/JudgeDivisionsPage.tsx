import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type Event, type JudgeDivision } from '../api/client'

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

export default function JudgeDivisionsPage() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<Event | null>(null)
  const [divisions, setDivisions] = useState<JudgeDivision[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api<Event>(`/events/${eventId}`),
      api<JudgeDivision[]>(`/judge/events/${eventId}/divisions`),
    ])
      .then(([eventRow, divisionRows]) => {
        setEvent(eventRow)
        setDivisions(divisionRows)
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : 'Unable to load divisions',
        )
      })
  }, [eventId])

  return (
    <>
      <Typography variant="h5" component="h1">
        {event?.name ?? 'Event'} divisions
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Select a division to enter or review your scores.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!divisions.length && !error && (
        <Alert severity="info">This event has no divisions yet.</Alert>
      )}
      <Stack spacing={2}>
        {divisions.map((division) => (
          <Card key={division.id} variant="outlined">
            <CardActionArea
              onClick={() =>
                navigate(
                  `/judge/events/${eventId}/divisions/${division.id}/score`,
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
                  <Typography variant="h6">{division.name}</Typography>
                  <Chip
                    size="small"
                    color={statusColor[division.submissionStatus]}
                    label={statusLabel[division.submissionStatus]}
                  />
                </Box>
                <Typography color="text.secondary">
                  {division.type === 'jack_and_jill' ? 'Jack & Jill' : 'Strictly'}
                  {' · '}
                  {division.competitorCount} competitors
                </Typography>
              </CardContent>
            </CardActionArea>
            <CardActions>
              <Button
                onClick={() =>
                  navigate(
                    `/judge/events/${eventId}/divisions/${division.id}/status`,
                  )
                }
              >
                Division status
              </Button>
            </CardActions>
          </Card>
        ))}
      </Stack>
    </>
  )
}
