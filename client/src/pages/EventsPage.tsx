import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Event } from '../api/client'

export default function EventsPage() {
  const navigate = useNavigate()
  const [events, setEvents] = useState<Event[]>([])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api<Event[]>('/events').then(setEvents).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Unable to load events')
    })
  }, [])

  async function createEvent(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    setError('')
    try {
      const created = await api<Event>('/events', {
        method: 'POST',
        body: JSON.stringify({ name, eventDate: eventDate || null }),
      })
      setEvents((current) => [...current, created])
      setName('')
      setEventDate('')
      setOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create event')
    }
  }

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" component="h1">Events</Typography>
        <Button variant="contained" onClick={() => setOpen(true)}>Create event</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!events.length && !error && (
        <Typography color="text.secondary">No events yet. Create one to begin.</Typography>
      )}
      <Stack spacing={2}>
        {events.map((event) => (
          <Card key={event.id} variant="outlined">
            <CardActionArea onClick={() => navigate(`/events/${event.id}/competitors`)}>
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

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth>
        <form onSubmit={createEvent}>
          <DialogTitle>Create event</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              label="Event name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              fullWidth
              sx={{ mt: 1, mb: 2 }}
            />
            <TextField
              label="Event date"
              type="date"
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Create</Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  )
}
