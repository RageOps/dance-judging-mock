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
          pairs: leads.map((lead) => ({
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
        Judges score each pair once using the lead&apos;s bib number.
      </Typography>
      {leads.length !== follows.length && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Strictly divisions need equal lead and follow counts before pairing (
          {leads.length} leads, {follows.length} follows).
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
              #{lead.bibNumber} {lead.firstName} {lead.lastName}
            </InputLabel>
            <Select
              labelId={`pair-${lead.competitorId}-label`}
              label={`#${lead.bibNumber} ${lead.firstName} ${lead.lastName}`}
              value={pairs[lead.competitorId] ?? ''}
              onChange={(event) =>
                setPairs((current) => ({
                  ...current,
                  [lead.competitorId]: event.target.value,
                }))
              }
            >
              {follows.map((follow) => (
                <MenuItem key={follow.competitorId} value={follow.competitorId}>
                  #{follow.bibNumber} {follow.firstName} {follow.lastName}
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
          disabled={leads.length !== follows.length}
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
                  primary={`#${competitor.bibNumber} ${competitor.firstName} ${competitor.lastName}`}
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
  const [name, setName] = useState('')
  const [type, setType] = useState<'jack_and_jill' | 'strictly'>('jack_and_jill')
  const [showCompetitorNames, setShowCompetitorNames] = useState(true)
  const [error, setError] = useState('')
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
    try {
      const created = await api<Division>(`/events/${eventId}/divisions`, {
        method: 'POST',
        body: JSON.stringify({ name, type, showCompetitorNames }),
      })
      setDivisions((current) => [...current, { ...created, registrationCount: 0 }])
      setName('')
      setShowCompetitorNames(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create division')
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
      <Typography variant="h5" component="h1" sx={{ mb: 3 }}>
        {event?.name ?? 'Event'} divisions
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Stack component="form" onSubmit={createDivision} spacing={2}>
            <TextField
              label="Division name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <FormControl>
              <InputLabel id="division-type-label">Division type</InputLabel>
              <Select
                labelId="division-type-label"
                label="Division type"
                value={type}
                onChange={(event) =>
                  setType(event.target.value as 'jack_and_jill' | 'strictly')
                }
              >
                <MenuItem value="jack_and_jill">Jack & Jill</MenuItem>
                <MenuItem value="strictly">Strictly</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={showCompetitorNames}
                  onChange={(event) =>
                    setShowCompetitorNames(event.target.checked)
                  }
                />
              }
              label="Show competitor names to judges"
            />
            <Typography variant="body2" color="text.secondary">
              When disabled, judges see only bib numbers and lead/follow roles.
            </Typography>
            <Button type="submit" variant="contained" size="large">Create division</Button>
          </Stack>
        </CardContent>
      </Card>

      {divisions.map((division) => (
        <Accordion key={division.id}>
          <AccordionSummary>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
              <Typography sx={{ flexGrow: 1 }}>{division.name}</Typography>
              <Chip
                size="small"
                label={division.type === 'jack_and_jill' ? 'Jack & Jill' : 'Strictly'}
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
    </>
  )
}
