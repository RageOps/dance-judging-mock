import {
  Alert,
  Button,
  Card,
  CardActions,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { api, type Competitor, type Event } from '../api/client'

type CompetitorForm = { firstName: string; lastName: string }
const emptyForm: CompetitorForm = { firstName: '', lastName: '' }

export default function CompetitorsPage() {
  const { eventId = '' } = useParams()
  const [event, setEvent] = useState<Event | null>(null)
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<Competitor | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    try {
      const [eventResult, competitorResult] = await Promise.all([
        api<Event>(`/events/${eventId}`),
        api<Competitor[]>(`/events/${eventId}/competitors`),
      ])
      setEvent(eventResult)
      setCompetitors(competitorResult)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load competitors')
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  async function addCompetitor(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    setError('')
    try {
      const created = await api<Competitor>(`/events/${eventId}/competitors`, {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setCompetitors((current) => [...current, created])
      setForm(emptyForm)
      setSuccess(`Created bib #${created.bibNumber}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add competitor')
    }
  }

  async function saveEdit(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    if (!editing) return
    try {
      const updated = await api<Competitor>(
        `/events/${eventId}/competitors/${editing.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            firstName: editing.firstName,
            lastName: editing.lastName,
          }),
        },
      )
      setCompetitors((current) =>
        current.map((competitor) => competitor.id === updated.id ? updated : competitor),
      )
      setEditing(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update competitor')
    }
  }

  async function removeCompetitor(competitor: Competitor) {
    if (!window.confirm(`Delete #${competitor.bibNumber} ${competitor.firstName} ${competitor.lastName}?`)) return
    try {
      await api<void>(`/events/${eventId}/competitors/${competitor.id}`, {
        method: 'DELETE',
      })
      setCompetitors((current) => current.filter((item) => item.id !== competitor.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete competitor')
    }
  }

  return (
    <>
      <Typography variant="h5" component="h1">{event?.name ?? 'Event'} competitors</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Bib numbers are assigned automatically.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Stack component="form" onSubmit={addCompetitor} spacing={2} sx={{ mb: 4 }}>
        <TextField
          label="First name"
          value={form.firstName}
          onChange={(event) => setForm({ ...form, firstName: event.target.value })}
          required
        />
        <TextField
          label="Last name"
          value={form.lastName}
          onChange={(event) => setForm({ ...form, lastName: event.target.value })}
          required
        />
        <Button type="submit" variant="contained" size="large">Add competitor</Button>
      </Stack>

      <Stack spacing={2}>
        {competitors.map((competitor) => (
          <Card key={competitor.id} variant="outlined">
            <CardContent>
              <Typography variant="h6">
                #{competitor.bibNumber} — {competitor.firstName} {competitor.lastName}
              </Typography>
            </CardContent>
            <CardActions>
              <Button onClick={() => setEditing(competitor)}>Edit</Button>
              <Button color="error" onClick={() => void removeCompetitor(competitor)}>Delete</Button>
            </CardActions>
          </Card>
        ))}
      </Stack>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth>
        {editing && (
          <form onSubmit={saveEdit}>
            <DialogTitle>Edit competitor #{editing.bibNumber}</DialogTitle>
            <DialogContent>
              <TextField
                label="First name"
                value={editing.firstName}
                onChange={(event) => setEditing({ ...editing, firstName: event.target.value })}
                fullWidth
                required
                sx={{ mt: 1, mb: 2 }}
              />
              <TextField
                label="Last name"
                value={editing.lastName}
                onChange={(event) => setEditing({ ...editing, lastName: event.target.value })}
                fullWidth
                required
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" variant="contained">Save</Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      <Snackbar
        open={Boolean(success)}
        message={success}
        autoHideDuration={3000}
        onClose={() => setSuccess('')}
      />
    </>
  )
}
