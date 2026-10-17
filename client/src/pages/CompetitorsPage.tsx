import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api,
  type Competitor,
  type Division,
  type Event,
  type ImportPreview,
  type ImportResult,
} from '../api/client'

type CompetitorForm = { firstName: string; lastName: string }
const emptyForm: CompetitorForm = { firstName: '', lastName: '' }

export default function CompetitorsPage() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<Event | null>(null)
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<Competitor | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importCsv, setImportCsv] = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importJackAndJill, setImportJackAndJill] = useState('')
  const [importStrictly, setImportStrictly] = useState('')
  const [importError, setImportError] = useState('')

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
      setDialogOpen(false)
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

  function closeImport() {
    setImportOpen(false)
    setImportCsv('')
    setImportFileName('')
    setImportPreview(null)
    setImportError('')
  }

  async function chooseImportFile(changeEvent: ChangeEvent<HTMLInputElement>) {
    const file = changeEvent.target.files?.[0]
    changeEvent.target.value = ''
    if (!file) return
    setImportError('')
    setImportBusy(true)
    try {
      const csv = await file.text()
      const preview = await api<ImportPreview>(
        `/events/${eventId}/competitors/import`,
        {
          method: 'POST',
          body: JSON.stringify({ csv, dryRun: true }),
        },
      )
      setImportCsv(csv)
      setImportFileName(file.name)
      setImportPreview(preview)
      setImportJackAndJill(preview.divisions.jackAndJill ?? '')
      setImportStrictly(preview.divisions.strictly ?? '')
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : 'Unable to parse CSV')
    } finally {
      setImportBusy(false)
    }
  }

  async function runImport() {
    setImportError('')
    setImportBusy(true)
    try {
      const result = await api<ImportResult>(
        `/events/${eventId}/competitors/import`,
        {
          method: 'POST',
          body: JSON.stringify({
            csv: importCsv,
            divisions: {
              jackAndJill: importJackAndJill || null,
              strictly: importStrictly || null,
            },
          }),
        },
      )
      closeImport()
      setSuccess(
        `Imported ${result.competitorsCreated} competitors (${result.competitorsMatched} already existed), ` +
          `${result.registrationsAdded} registrations added` +
          (result.warnings.length ? ` — ${result.warnings.length} warning(s)` : ''),
      )
      void load()
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : 'Unable to import')
    } finally {
      setImportBusy(false)
    }
  }

  const competitorFormFields = (
    <>
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
    </>
  )

  return (
    <>
      <Button onClick={() => navigate('/events')} sx={{ mb: 1 }}>
        Back to events
      </Button>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" component="h1">{event?.name ?? 'Event'} competitors</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {competitors.length > 0 && (
            <Button variant="contained" onClick={() => setDialogOpen(true)}>
              Add competitor
            </Button>
          )}
          <Button
            variant="outlined"
            onClick={() => setImportOpen(true)}
          >
            Import CSV
          </Button>
          <Button
            variant="outlined"
            onClick={() => navigate(`/events/${eventId}/competitors/check-in`)}
          >
            Competitor check-in
          </Button>
        </Box>
      </Box>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Bib numbers are provisional until assigned at competitor check-in.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {loaded && !competitors.length && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Stack component="form" onSubmit={addCompetitor} spacing={2}>
              {competitorFormFields}
              <Button type="submit" variant="contained" size="large">
                Add competitor
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

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

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        fullWidth
      >
        <form onSubmit={addCompetitor}>
          <DialogTitle>Add competitor</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {competitorFormFields}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">
              Add competitor
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog
        open={importOpen}
        onClose={closeImport}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Import competitors from CSV</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {importError && (
              <Alert severity="error" onClose={() => setImportError('')}>
                {importError}
              </Alert>
            )}
            <Typography variant="body2" color="text.secondary">
              Upload a Danceplace customer list report. Competitors are created
              from paid competition tickets (Jack &amp; Jill / Strictly);
              day-pass-only attendees are skipped.
            </Typography>
            <Box>
              <Button component="label" variant="outlined" disabled={importBusy}>
                {importPreview ? 'Choose a different file' : 'Choose CSV file'}
                <input
                  hidden
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void chooseImportFile(event)}
                />
              </Button>
              {importFileName && (
                <Typography component="span" variant="body2" sx={{ ml: 2 }}>
                  {importFileName}
                </Typography>
              )}
            </Box>
            {importBusy && !importPreview && (
              <Typography color="text.secondary">Parsing…</Typography>
            )}
            {importPreview && (
              <>
                {importPreview.warnings.map((warning) => (
                  <Alert key={warning} severity="warning">
                    {warning}
                  </Alert>
                ))}
                <Stack direction="row" spacing={2}>
                  <FormControl fullWidth>
                    <InputLabel id="import-jj-label">
                      Jack &amp; Jill division
                    </InputLabel>
                    <Select
                      labelId="import-jj-label"
                      label="Jack & Jill division"
                      value={importJackAndJill}
                      onChange={(event) => setImportJackAndJill(event.target.value)}
                    >
                      <MenuItem value="">Don't import</MenuItem>
                      {divisions
                        .filter((division) => division.type === 'jack_and_jill')
                        .map((division) => (
                          <MenuItem key={division.id} value={division.id}>
                            {division.name}
                          </MenuItem>
                        ))}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth>
                    <InputLabel id="import-strictly-label">
                      Strictly division
                    </InputLabel>
                    <Select
                      labelId="import-strictly-label"
                      label="Strictly division"
                      value={importStrictly}
                      onChange={(event) => setImportStrictly(event.target.value)}
                    >
                      <MenuItem value="">Don't import</MenuItem>
                      {divisions
                        .filter((division) => division.type === 'strictly')
                        .map((division) => (
                          <MenuItem key={division.id} value={division.id}>
                            {division.name}
                          </MenuItem>
                        ))}
                    </Select>
                  </FormControl>
                </Stack>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Jack &amp; Jill</TableCell>
                      <TableCell>Strictly</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {importPreview.people.map((person) => (
                      <TableRow key={person.name}>
                        <TableCell>
                          {person.firstName} {person.lastName}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={person.existing ? 'default' : 'success'}
                            label={person.existing ? 'Existing' : 'New'}
                          />
                        </TableCell>
                        <TableCell>
                          {person.jackAndJillRole
                            ? person.jackAndJillRole === 'lead'
                              ? 'Lead'
                              : 'Follow'
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {person.inStrictly
                            ? person.strictlyRole === 'lead'
                              ? 'Lead'
                              : person.strictlyRole === 'follow'
                                ? 'Follow'
                                : 'Role unknown'
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeImport}>Cancel</Button>
          {importPreview && (
            <Button
              variant="contained"
              onClick={() => void runImport()}
              disabled={importBusy}
            >
              Import {importPreview.people.length} competitors
            </Button>
          )}
        </DialogActions>
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
