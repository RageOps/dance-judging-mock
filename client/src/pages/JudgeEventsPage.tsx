import {
  Alert,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Event } from '../api/client'

export default function JudgeEventsPage() {
  const navigate = useNavigate()
  const [events, setEvents] = useState<Event[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<Event[]>('/judge/events')
      .then(setEvents)
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : 'Unable to load assigned events',
        )
      })
  }, [])

  return (
    <>
      <Typography variant="h5" component="h1">
        Select an event
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Choose the competition you are currently judging.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!events.length && !error && (
        <Alert severity="info">
          You are not assigned to any events. Contact an administrator.
        </Alert>
      )}
      <Stack spacing={2}>
        {events.map((event) => (
          <Card key={event.id} variant="outlined">
            <CardActionArea
              onClick={() => navigate(`/judge/events/${event.id}/divisions`)}
            >
              <CardContent>
                <Typography variant="h6">{event.name}</Typography>
                <Typography color="text.secondary">
                  {event.eventDate || 'Date not set'}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
    </>
  )
}
