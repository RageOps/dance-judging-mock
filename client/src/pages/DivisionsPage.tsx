import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api,
  type Competitor,
  type Division,
  type DivisionPair,
  type Event,
  type Registration,
} from '../api/client'

type Role = 'lead' | 'follow'

type DivisionForm = {
  name: string
  type: 'jack_and_jill' | 'strictly'
  scoringMode: 'numeric' | 'rounds'
  showCompetitorNames: boolean
  advanceCount: string
}

const emptyDivisionForm: DivisionForm = {
  name: '',
  type: 'jack_and_jill',
  scoringMode: 'numeric',
  showCompetitorNames: true,
  advanceCount: '',
}

function parseAdvanceCount(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed || null : undefined
}

function divisionFormFields(
  form: DivisionForm,
  setForm: (form: DivisionForm) => void,
) {
  return (
    <>
      <TextField
        label="Division name"
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
        required
      />
      <FormControl>
        <InputLabel id="division-type-label">Division type</InputLabel>
        <Select
          labelId="division-type-label"
          label="Division type"
          value={form.type}
          onChange={(event) =>
            setForm({
              ...form,
              type: event.target.value as 'jack_and_jill' | 'strictly',
            })
          }
        >
          <MenuItem value="jack_and_jill">Jack & Jill</MenuItem>
          <MenuItem value="strictly">Strictly</MenuItem>
        </Select>
      </FormControl>
      <FormControl>
        <InputLabel id="division-scoring-label">Scoring</InputLabel>
        <Select
          labelId="division-scoring-label"
          label="Scoring"
          value={form.scoringMode}
          onChange={(event) =>
            setForm({
              ...form,
              scoringMode: event.target.value as 'numeric' | 'rounds',
            })
          }
        >
          <MenuItem value="numeric">Numeric (1–10)</MenuItem>
          <MenuItem value="rounds">
            Rounds (callback + relative placement)
          </MenuItem>
        </Select>
      </FormControl>
      <TextField
        label="Advance to next round (top N)"
        type="number"
        value={form.advanceCount}
        onChange={(event) =>
          setForm({ ...form, advanceCount: event.target.value })
        }
        slotProps={{ htmlInput: { min: 1 } }}
        helperText="Numeric scoring: the N highest-scoring entries in each group are marked as advancing. Blank for no cutoff."
      />
      <FormControlLabel
        control={
          <Switch
            checked={form.showCompetitorNames}
            onChange={(event) =>
              setForm({ ...form, showCompetitorNames: event.target.checked })
            }
          />
        }
        label="Show competitor names to judges"
      />
      <Typography variant="body2" color="text.secondary">
        When disabled, judges see only bib numbers and lead/follow roles.
      </Typography>
    </>
  )
}

const judgingStatusChip: Record<
  Division['judgingStatus'],
  { label: string; color: 'default' | 'warning' | 'success' }
> = {
  not_started: { label: 'Judging not started', color: 'default' },
  in_progress: { label: 'Judging in progress', color: 'warning' },
  completed: { label: 'Judging complete', color: 'success' },
}

function DivisionPairings({
  eventId,
  division,
  reloadToken,
}: {
  eventId: string
  division: Division
  reloadToken: number
}) {
  const [pairs, setPairs] = useState<Record<string, string>>({})
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const leads = registrations.filter((row) => row.role === 'lead')
  const follows = registrations.filter((row) => row.role === 'follow')

  useEffect(() => {
    setLoaded(false)
    Promise.all([
      api<Registration[]>(
        `/events/${eventId}/divisions/${division.id}/registrations`,
      ),
      api<DivisionPair[]>(`/events/${eventId}/divisions/${division.id}/pairs`),
    ])
      .then(([registrationRows, savedPairs]) => {
        setRegistrations(registrationRows)
        setPairs(
          Object.fromEntries(
            savedPairs.map((pair) => [
              pair.leadCompetitorId,
              pair.followCompetitorId,
            ]),
          ),
        )
        setLoaded(true)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Unable to load pairs')
      })
  }, [division.id, eventId, reloadToken])

  async function savePairs() {
    setError('')
    try {
      await api<void>(`/events/${eventId}/divisions/${division.id}/pairs`, {
        method: 'PUT',
        body: JSON.stringify({
          pairs: leads
            .filter((lead) => pairs[lead.competitorId])
            .map((lead) => ({
              leadCompetitorId: lead.competitorId,
              followCompetitorId: pairs[lead.competitorId],
            })),
        }),
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save pairs')
    }
  }

  if (!loaded && !error) return <Typography>Loading pairs…</Typography>

  return (
    <Box sx={{ mt: 3, pt: 3, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Lead/follow pairs
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Judges score each pair once using the lead&apos;s bib number. Leads
        left unpaired are saved as unpaired and won&apos;t appear on judges&apos;
        sheets until paired.
      </Typography>
      {leads.length !== follows.length && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {leads.length} leads, {follows.length} follows — you can save partial
          pairings and fill in the rest later.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!leads.length && (
        <Typography color="text.secondary">
          Assign leads and follows before creating pairs.
        </Typography>
      )}
      <Stack spacing={2}>
        {leads.map((lead) => (
          <FormControl key={lead.competitorId} fullWidth>
            <InputLabel id={`pair-${lead.competitorId}-label`}>
              #{lead.bibNumber} {lead.firstName}
            </InputLabel>
            <Select
              labelId={`pair-${lead.competitorId}-label`}
              label={`#${lead.bibNumber} ${lead.firstName}`}
              value={pairs[lead.competitorId] ?? ''}
              onChange={(event) =>
                setPairs((current) => ({
                  ...current,
                  [lead.competitorId]: event.target.value,
                }))
              }
            >
              <MenuItem value="">
                <em>Unpaired</em>
              </MenuItem>
              {follows.map((follow) => (
                <MenuItem key={follow.competitorId} value={follow.competitorId}>
                  #{follow.bibNumber} {follow.firstName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ))}
      </Stack>
      {leads.length > 0 && (
        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={() => void savePairs()}
          sx={{ mt: 2, py: 1.5 }}
        >
          Save pairs
        </Button>
      )}
    </Box>
  )
}

function DivisionAssignments({
  eventId,
  division,
  competitors,
  onSaved,
}: {
  eventId: string
  division: Division
  competitors: Competitor[]
  onSaved: () => void
}) {
  const [roles, setRoles] = useState<Record<string, Role>>({})
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api<Registration[]>(
      `/events/${eventId}/divisions/${division.id}/registrations`,
    )
      .then((registrations) => {
        setRoles(
          Object.fromEntries(
            registrations.map((registration) => [
              registration.competitorId,
              registration.role,
            ]),
          ),
        )
        setLoaded(true)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Unable to load assignments')
      })
  }, [division.id, eventId])

  function toggle(competitorId: string) {
    setRoles((current) => {
      const next = { ...current }
      if (next[competitorId]) delete next[competitorId]
      else next[competitorId] = 'lead'
      return next
    })
  }

  async function save() {
    setError('')
    try {
      await api<void>(
        `/events/${eventId}/divisions/${division.id}/registrations`,
        {
          method: 'PUT',
          body: JSON.stringify({
            registrations: Object.entries(roles).map(([competitorId, role]) => ({
              competitorId,
              role,
            })),
          }),
        },
      )
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save assignments')
    }
  }

  if (!loaded && !error) return <Typography>Loading assignments…</Typography>

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!competitors.length && (
        <Typography color="text.secondary">
          Add competitors to this event before assigning the division.
        </Typography>
      )}
      <List disablePadding>
        {competitors.map((competitor) => {
          const selected = Boolean(roles[competitor.id])
          return (
            <ListItem
              key={competitor.id}
              disablePadding
              secondaryAction={
                selected ? (
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={roles[competitor.id]}
                    onChange={(_event, role: Role | null) => {
                      if (role) setRoles((current) => ({ ...current, [competitor.id]: role }))
                    }}
                    aria-label={`Role for ${competitor.firstName} ${competitor.lastName}`}
                  >
                    <ToggleButton value="lead">Lead</ToggleButton>
                    <ToggleButton value="follow">Follow</ToggleButton>
                  </ToggleButtonGroup>
                ) : null
              }
            >
              <ListItemButton
                onClick={() => toggle(competitor.id)}
                sx={{ pr: selected ? 20 : 2 }}
              >
                <Checkbox checked={selected} tabIndex={-1} disableRipple />
                <ListItemText
                  primary={`#${competitor.bibNumber} ${competitor.firstName}`}
                />
              </ListItemButton>
            </ListItem>
          )
        })}
      </List>
      <Button
        variant="contained"
        fullWidth
        size="large"
        onClick={() => void save()}
        sx={{
          position: 'sticky',
          bottom: 0,
          mt: 2,
          py: 1.5,
        }}
      >
        Save assignments
      </Button>
    </>
  )
}

export default function DivisionsPage() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<Event | null>(null)
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])
  const [form, setForm] = useState(emptyDivisionForm)
  const [editing, setEditing] = useState<
    (DivisionForm & { id: string }) | null
  >(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pairingsVersion, setPairingsVersion] = useState(0)

  const load = useCallback(async () => {
    try {
      const [eventResult, competitorResult, divisionResult] = await Promise.all([
        api<Event>(`/events/${eventId}`),
        api<Competitor[]>(`/events/${eventId}/competitors`),
        api<Division[]>(`/events/${eventId}/divisions`),
      ])
      setEvent(eventResult)
      setCompetitors(competitorResult)
      setDivisions(divisionResult)
      setLoaded(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load divisions')
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  async function createDivision(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    setError('')
    const advanceCount = parseAdvanceCount(form.advanceCount)
    if (advanceCount === undefined) {
      setError('Advance count must be a positive whole number')
      return
    }
    try {
      const created = await api<Division>(`/events/${eventId}/divisions`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          scoringMode: form.scoringMode,
          showCompetitorNames: form.showCompetitorNames,
          advanceCount,
        }),
      })
      setDivisions((current) => [
        ...current,
        { ...created, registrationCount: 0, judgingStatus: 'not_started' },
      ])
      setForm(emptyDivisionForm)
      setDialogOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create division')
    }
  }

  function openEdit(division: Division) {
    setEditing({
      id: division.id,
      name: division.name,
      type: division.type,
      scoringMode: division.scoringMode,
      showCompetitorNames: division.showCompetitorNames,
      advanceCount: division.advanceCount?.toString() ?? '',
    })
  }

  async function saveEdit(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    if (!editing) return
    setError('')
    const advanceCount = parseAdvanceCount(editing.advanceCount)
    if (advanceCount === undefined) {
      setError('Advance count must be a positive whole number')
      return
    }
    try {
      const updated = await api<Division>(
        `/events/${eventId}/divisions/${editing.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: editing.name,
            type: editing.type,
            scoringMode: editing.scoringMode,
            showCompetitorNames: editing.showCompetitorNames,
            advanceCount,
          }),
        },
      )
      setDivisions((current) =>
        current.map((division) =>
          division.id === updated.id ? { ...division, ...updated } : division,
        ),
      )
      setEditing(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update division')
    }
  }

  async function deleteDivision(division: Division) {
    if (
      !window.confirm(
        `Delete division "${division.name}" and all its registrations, scores, and rounds?`,
      )
    )
      return
    setError('')
    try {
      await api(`/events/${eventId}/divisions/${division.id}`, {
        method: 'DELETE',
      })
      setDivisions((current) =>
        current.filter((item) => item.id !== division.id),
      )
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to delete division',
      )
    }
  }

  async function updateNameVisibility(
    division: Division,
    showNames: boolean,
  ) {
    setError('')
    try {
      await api<Division>(`/events/${eventId}/divisions/${division.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: division.name,
          type: division.type,
          showCompetitorNames: showNames,
        }),
      })
      setDivisions((current) =>
        current.map((item) =>
          item.id === division.id
            ? { ...item, showCompetitorNames: showNames }
            : item,
        ),
      )
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to update name visibility',
      )
    }
  }

  return (
    <>
      <Button onClick={() => navigate('/events')} sx={{ mb: 1 }}>
        Back to events
      </Button>
      <Typography variant="h5" component="h1" sx={{ mb: 3 }}>
        {event?.name ?? 'Event'} divisions
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loaded && !divisions.length && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Stack component="form" onSubmit={createDivision} spacing={2}>
              {divisionFormFields(form, setForm)}
              <Button type="submit" variant="contained" size="large">
                Create division
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {divisions.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 2,
          }}
        >
          <Typography variant="h6" component="h2">
            Manage Divisions
          </Typography>
          <Button variant="contained" onClick={() => setDialogOpen(true)}>
            New division
          </Button>
        </Box>
      )}

      {divisions.map((division) => (
        <Accordion key={division.id}>
          <AccordionSummary>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', flexWrap: 'wrap' }}>
              <Typography sx={{ flexGrow: 1, minWidth: '40%' }}>{division.name}</Typography>
              <Chip
                size="small"
                label={division.type === 'jack_and_jill' ? 'Jack & Jill' : 'Strictly'}
              />
              <Chip
                size="small"
                variant="outlined"
                label={division.scoringMode === 'rounds' ? 'Rounds' : 'Numeric'}
              />
              {division.advanceCount != null && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Top ${division.advanceCount} advance`}
                />
              )}
              {division.lineUpCheckInCompletedAt && (
                <Chip
                  size="small"
                  color="success"
                  label="Check-in complete"
                />
              )}
              <Chip
                size="small"
                variant="outlined"
                color={judgingStatusChip[division.judgingStatus].color}
                label={judgingStatusChip[division.judgingStatus].label}
              />
              <Chip size="small" variant="outlined" label={division.registrationCount} />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                mb: 2,
                pb: 2,
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={division.showCompetitorNames}
                    onChange={(event) =>
                      void updateNameVisibility(
                        division,
                        event.target.checked,
                      )
                    }
                  />
                }
                label="Show names to judges"
              />
              {division.scoringMode === 'rounds' && (
                <Button
                  variant="outlined"
                  onClick={() =>
                    navigate(
                      `/events/${eventId}/divisions/${division.id}/rounds`,
                    )
                  }
                >
                  Rounds
                </Button>
              )}
              <Button
                variant="outlined"
                onClick={() =>
                  navigate(
                    `/events/${eventId}/divisions/${division.id}/check-in`,
                  )
                }
              >
                Line up check-in
              </Button>
              <Button
                variant="outlined"
                onClick={() =>
                  navigate(
                    `/events/${eventId}/divisions/${division.id}/status`,
                  )
                }
              >
                Division status
              </Button>
              <Button variant="outlined" onClick={() => openEdit(division)}>
                Edit
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={() => void deleteDivision(division)}
              >
                Delete
              </Button>
            </Box>
            <DivisionAssignments
              eventId={eventId}
              division={division}
              competitors={competitors}
              onSaved={() => {
                setPairingsVersion((current) => current + 1)
                void load()
              }}
            />
            {division.type === 'strictly' && (
              <DivisionPairings
                eventId={eventId}
                division={division}
                reloadToken={pairingsVersion}
              />
            )}
          </AccordionDetails>
        </Accordion>
      ))}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        fullWidth
      >
        <form onSubmit={createDivision}>
          <DialogTitle>New division</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {divisionFormFields(form, setForm)}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">
              Create division
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        fullWidth
      >
        {editing && (
          <form onSubmit={saveEdit}>
            <DialogTitle>Edit division</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {divisionFormFields(editing, (next) =>
                  setEditing({ ...editing, ...next }),
                )}
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
    </>
  )
}
