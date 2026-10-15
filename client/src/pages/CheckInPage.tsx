import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, type Division, type Registration } from '../api/client'

export default function CheckInPage() {
  const { eventId = '', divisionId = '' } = useParams()
  const [division, setDivision] = useState<Division | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [scratchTarget, setScratchTarget] = useState<Registration | null>(null)
  const [confirmUnchecked, setConfirmUnchecked] = useState(false)

  const load = useCallback(async () => {
    try {
      const [divisionResult, registrationResult] = await Promise.all([
        api<Division[]>(`/events/${eventId}/divisions`),
        api<Registration[]>(
          `/events/${eventId}/divisions/${divisionId}/registrations`,
        ),
      ])
      setDivision(
        divisionResult.find((item) => item.id === divisionId) ?? null,
      )
      setRegistrations(registrationResult)
      setLoaded(true)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to load check-in',
      )
    }
  }, [eventId, divisionId])

  useEffect(() => {
    void load()
  }, [load])

  const checkedInIds = new Set(
    registrations
      .filter((registration) => registration.checkedInAt)
      .map((registration) => registration.competitorId),
  )
  const uncheckedCount = registrations.length - checkedInIds.size

  async function saveCheckIn(ids: Set<string>) {
    setError('')
    try {
      await api<void>(
        `/events/${eventId}/divisions/${divisionId}/check-in`,
        {
          method: 'PUT',
          body: JSON.stringify({ competitorIds: [...ids] }),
        },
      )
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to save check-in',
      )
      await load()
    }
  }

  function toggle(registration: Registration) {
    const next = new Set(checkedInIds)
    if (next.has(registration.competitorId)) {
      next.delete(registration.competitorId)
    } else {
      next.add(registration.competitorId)
    }
    const checkedInAt = next.has(registration.competitorId)
      ? new Date().toISOString()
      : null
    setRegistrations((current) =>
      current.map((item) =>
        item.competitorId === registration.competitorId
          ? { ...item, checkedInAt }
          : item,
      ),
    )
    void saveCheckIn(next)
  }

  async function scratch(registration: Registration) {
    setError('')
    try {
      await api<void>(
        `/events/${eventId}/divisions/${divisionId}/registrations/${registration.competitorId}`,
        { method: 'DELETE' },
      )
      setRegistrations((current) =>
        current.filter(
          (item) => item.competitorId !== registration.competitorId,
        ),
      )
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to scratch competitor',
      )
    } finally {
      setScratchTarget(null)
    }
  }

  async function scratchUnchecked() {
    setConfirmUnchecked(false)
    for (const registration of registrations.filter(
      (item) => !item.checkedInAt,
    )) {
      await scratch(registration)
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
      <Typography variant="h5" component="h1" sx={{ mb: 1 }}>
        {division?.name ?? 'Division'} check-in
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Check off competitors as they appear in the line up. Scratch a
        competitor to remove them from this division.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Chip
          label={`${checkedInIds.size} checked in`}
          color="primary"
          variant="outlined"
        />
        <Chip label={`${uncheckedCount} pending`} variant="outlined" />
        <Box sx={{ flexGrow: 1 }} />
        <Button
          color="error"
          variant="outlined"
          disabled={!uncheckedCount}
          onClick={() => setConfirmUnchecked(true)}
        >
          Scratch unchecked
        </Button>
      </Box>
      {!registrations.length && (
        <Typography color="text.secondary">
          No competitors are registered in this division.
        </Typography>
      )}
      <List disablePadding>
        {registrations.map((registration) => (
          <ListItem
            key={registration.competitorId}
            disablePadding
            secondaryAction={
              <Button
                color="error"
                size="small"
                onClick={() => setScratchTarget(registration)}
              >
                Scratch
              </Button>
            }
          >
            <ListItemButton
              onClick={() => toggle(registration)}
              sx={{ pr: 12 }}
            >
              <Checkbox
                checked={checkedInIds.has(registration.competitorId)}
                tabIndex={-1}
                disableRipple
              />
              <ListItemText
                primary={`#${registration.bibNumber} ${registration.firstName} ${registration.lastName}`}
                secondary={registration.role}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      <Dialog
        open={Boolean(scratchTarget)}
        onClose={() => setScratchTarget(null)}
      >
        <DialogTitle>Scratch competitor?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            #{scratchTarget?.bibNumber} {scratchTarget?.firstName}{' '}
            {scratchTarget?.lastName} will be removed from this division,
            including any pair and recorded scores. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScratchTarget(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (scratchTarget) void scratch(scratchTarget)
            }}
          >
            Scratch
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmUnchecked}
        onClose={() => setConfirmUnchecked(false)}
      >
        <DialogTitle>Scratch all unchecked?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {uncheckedCount} competitor{uncheckedCount === 1 ? '' : 's'} who
            {uncheckedCount === 1 ? ' is' : ' are'} not checked in will be
            removed from this division. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmUnchecked(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void scratchUnchecked()}
          >
            Scratch all
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
