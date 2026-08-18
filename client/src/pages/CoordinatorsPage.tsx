import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type Coordinator, type Event } from '../api/client'

type CoordinatorForm = {
  firstName: string
  lastName: string
  email: string
  password: string
  eventIds: string[]
}

const emptyForm: CoordinatorForm = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  eventIds: [],
}

function EventSelect({
  events,
  value,
  onChange,
}: {
  events: Event[]
  value: string[]
  onChange: (eventIds: string[]) => void
}) {
  return (
    <FormControl fullWidth>
      <InputLabel id="coordinator-events-label">Assigned events</InputLabel>
      <Select
        labelId="coordinator-events-label"
        multiple
        value={value}
        onChange={(event) =>
          onChange(
            typeof event.target.value === 'string'
              ? event.target.value.split(',')
              : event.target.value,
          )
        }
        input={<OutlinedInput label="Assigned events" />}
        renderValue={(selected) =>
          events
            .filter((event) => selected.includes(event.id))
            .map((event) => event.name)
            .join(', ')
        }
      >
        {events.map((event) => (
          <MenuItem key={event.id} value={event.id}>
            <Checkbox checked={value.includes(event.id)} />
            <ListItemText primary={event.name} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

export default function CoordinatorsPage() {
  const [coordinators, setCoordinators] = useState<Coordinator[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [form, setForm] = useState<CoordinatorForm>(emptyForm)
  const [editing, setEditing] = useState<
    (CoordinatorForm & { id: string }) | null
  >(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    try {
      const [coordinatorRows, eventRows] = await Promise.all([
        api<Coordinator[]>('/coordinators'),
        api<Event[]>('/events'),
      ])
      setCoordinators(coordinatorRows)
      setEvents(eventRows)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to load coordinators',
      )
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createCoordinator(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    setError('')
    try {
      await api<Coordinator>('/coordinators', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setForm(emptyForm)
      setSuccess('Coordinator account created')
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to create coordinator',
      )
    }
  }

  function openEdit(coordinator: Coordinator) {
    setEditing({
      id: coordinator.id,
      firstName: coordinator.firstName,
      lastName: coordinator.lastName,
      email: coordinator.email,
      password: '',
      eventIds: coordinator.events.map((event) => event.id),
    })
  }

  async function saveEdit(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    if (!editing) return
    setError('')
    try {
      await api(`/coordinators/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: editing.firstName,
          lastName: editing.lastName,
          email: editing.email,
          password: editing.password,
        }),
      })
      await api<void>(`/coordinators/${editing.id}/events`, {
        method: 'PUT',
        body: JSON.stringify({ eventIds: editing.eventIds }),
      })
      setEditing(null)
      setSuccess('Coordinator profile updated')
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to update coordinator',
      )
    }
  }

  async function removeCoordinator(coordinator: Coordinator) {
    if (
      !window.confirm(
        `Delete coordinator ${coordinator.firstName} ${coordinator.lastName}? This cannot be undone.`,
      )
    ) {
      return
    }
    try {
      await api<void>(`/coordinators/${coordinator.id}`, { method: 'DELETE' })
      setSuccess('Coordinator deleted')
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to delete coordinator',
      )
    }
  }

  return (
    <>
      <Typography variant="h5" component="h1">
        Coordinators
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Create coordinator logins and assign each coordinator to one or more
        events.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Add coordinator
          </Typography>
          <Stack component="form" onSubmit={createCoordinator} spacing={2}>
            <TextField
              label="First name"
              value={form.firstName}
              onChange={(event) =>
                setForm({ ...form, firstName: event.target.value })
              }
              required
            />
            <TextField
              label="Last name"
              value={form.lastName}
              onChange={(event) =>
                setForm({ ...form, lastName: event.target.value })
              }
              required
            />
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
            />
            <TextField
              label="Initial password"
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
              helperText="At least 8 characters. Share this securely with the coordinator."
              required
            />
            <EventSelect
              events={events}
              value={form.eventIds}
              onChange={(eventIds) => setForm({ ...form, eventIds })}
            />
            <Button type="submit" variant="contained" size="large">
              Create coordinator
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Stack spacing={2}>
        {coordinators.map((coordinator) => (
          <Card key={coordinator.id} variant="outlined">
            <CardContent>
              <Typography variant="h6">
                {coordinator.firstName} {coordinator.lastName}
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 1.5 }}>
                {coordinator.email}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {coordinator.events.length ? (
                  coordinator.events.map((event) => (
                    <Chip key={event.id} label={event.name ?? 'Assigned event'} />
                  ))
                ) : (
                  <Chip label="No events assigned" variant="outlined" />
                )}
              </Box>
            </CardContent>
            <CardActions>
              <Button onClick={() => openEdit(coordinator)}>Edit</Button>
              <Button
                color="error"
                onClick={() => void removeCoordinator(coordinator)}
              >
                Delete
              </Button>
            </CardActions>
          </Card>
        ))}
      </Stack>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth>
        {editing && (
          <form onSubmit={saveEdit}>
            <DialogTitle>Edit coordinator</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <TextField
                  label="First name"
                  value={editing.firstName}
                  onChange={(event) =>
                    setEditing({ ...editing, firstName: event.target.value })
                  }
                  required
                />
                <TextField
                  label="Last name"
                  value={editing.lastName}
                  onChange={(event) =>
                    setEditing({ ...editing, lastName: event.target.value })
                  }
                  required
                />
                <TextField
                  label="Email"
                  type="email"
                  value={editing.email}
                  onChange={(event) =>
                    setEditing({ ...editing, email: event.target.value })
                  }
                  required
                />
                <TextField
                  label="New password (optional)"
                  type="password"
                  value={editing.password}
                  onChange={(event) =>
                    setEditing({ ...editing, password: event.target.value })
                  }
                  helperText="Leave blank to keep the current password."
                />
                <EventSelect
                  events={events}
                  value={editing.eventIds}
                  onChange={(eventIds) => setEditing({ ...editing, eventIds })}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" variant="contained">
                Save
              </Button>
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
