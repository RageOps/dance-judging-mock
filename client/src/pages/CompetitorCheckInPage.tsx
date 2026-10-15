import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type Competitor, type Event } from '../api/client'

export default function CompetitorCheckInPage() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<Event | null>(null)
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<Competitor | null>(null)
  const [bibInput, setBibInput] = useState('')
  const [dialogError, setDialogError] = useState('')

  const load = useCallback(async () => {
    try {
      const [eventResult, competitorResult] = await Promise.all([
        api<Event>(`/events/${eventId}`),
        api<Competitor[]>(`/events/${eventId}/competitors`),
      ])
      setEvent(eventResult)
      setCompetitors(competitorResult)
      setLoaded(true)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to load competitors',
      )
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return competitors
    return competitors.filter(
      (competitor) =>
        `${competitor.firstName} ${competitor.lastName}`
          .toLowerCase()
          .includes(term) || String(competitor.bibNumber).includes(term),
    )
  }, [competitors, search])

  function openDialog(competitor: Competitor) {
    setSelected(competitor)
    setBibInput(String(competitor.bibNumber))
    setDialogError('')
  }

  async function checkIn() {
    if (!selected) return
    const bibNumber = Number(bibInput)
    if (!Number.isInteger(bibNumber) || bibNumber < 1) {
      setDialogError('Enter a positive whole bib number')
      return
    }
    setDialogError('')
    try {
      const updated = await api<Competitor>(
        `/events/${eventId}/competitors/${selected.id}/check-in`,
        { method: 'PUT', body: JSON.stringify({ bibNumber }) },
      )
      setCompetitors((current) =>
        current
          .map((item) =>
            item.id === updated.id ? { ...item, ...updated } : item,
          )
          .sort((a, b) => a.bibNumber - b.bibNumber),
      )
      setSelected(null)
    } catch (reason) {
      setDialogError(
        reason instanceof Error ? reason.message : 'Unable to check in',
      )
    }
  }

  async function undoCheckIn() {
    if (!selected) return
    setDialogError('')
    try {
      await api<void>(
        `/events/${eventId}/competitors/${selected.id}/check-in`,
        { method: 'DELETE' },
      )
      setCompetitors((current) =>
        current.map((item) =>
          item.id === selected.id ? { ...item, checkedInAt: null } : item,
        ),
      )
      setSelected(null)
    } catch (reason) {
      setDialogError(
        reason instanceof Error ? reason.message : 'Unable to undo check-in',
      )
    }
  }

  if (!loaded && !error) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <>
      <Button
        onClick={() => navigate(`/events/${eventId}/competitors`)}
        sx={{ mb: 1 }}
      >
        Back to competitors
      </Button>
      <Typography variant="h5" component="h1" sx={{ mb: 1 }}>
        {event?.name ?? 'Event'} competitor check-in
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Search for a competitor, confirm their divisions, and assign their bib
        number to check them in.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <TextField
        label="Search by name or bib number"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        fullWidth
        sx={{ mb: 2 }}
      />

      {!filtered.length && (
        <Typography color="text.secondary">
          {competitors.length
            ? 'No competitors match that search.'
            : 'No competitors registered for this event.'}
        </Typography>
      )}
      <List disablePadding>
        {filtered.map((competitor) => (
          <ListItem key={competitor.id} disablePadding>
            <ListItemButton onClick={() => openDialog(competitor)}>
              <ListItemText
                primary={`#${competitor.bibNumber} ${competitor.firstName} ${competitor.lastName}`}
                secondary={
                  competitor.divisions?.length
                    ? competitor.divisions
                        .map((division) => `${division.name} (${division.role})`)
                        .join(', ')
                    : 'No divisions'
                }
              />
              {competitor.checkedInAt && (
                <Chip size="small" color="success" label="Checked in" />
              )}
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        fullWidth
      >
        {selected && (
          <>
            <DialogTitle>
              {selected.firstName} {selected.lastName}
            </DialogTitle>
            <DialogContent>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 1 }}>
                {selected.divisions?.length ? (
                  selected.divisions.map((division) => (
                    <Chip
                      key={division.id}
                      variant="outlined"
                      label={`${division.name} — ${division.role}`}
                    />
                  ))
                ) : (
                  <Typography color="text.secondary">
                    Not registered in any divisions.
                  </Typography>
                )}
              </Box>
              <TextField
                label="Bib number"
                type="number"
                value={bibInput}
                onChange={(event) => setBibInput(event.target.value)}
                slotProps={{ htmlInput: { min: 1, step: 1 } }}
                fullWidth
                required
                sx={{ mt: 2 }}
              />
              {dialogError && (
                <Alert severity="error" sx={{ mt: 2 }}>{dialogError}</Alert>
              )}
            </DialogContent>
            <DialogActions>
              {selected.checkedInAt && (
                <Button color="warning" onClick={() => void undoCheckIn()}>
                  Undo check-in
                </Button>
              )}
              <Box sx={{ flexGrow: 1 }} />
              <Button onClick={() => setSelected(null)}>Cancel</Button>
              <Button variant="contained" onClick={() => void checkIn()}>
                {selected.checkedInAt ? 'Update bib' : 'Check in'}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  )
}
