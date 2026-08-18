import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'

function managerHome(role: string) {
  return role === 'judge' ? '/judge/events' : '/events'
}

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('admin@local.dev')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user) {
    return <Navigate to={managerHome(user.role)} replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const session = await login(email, password)
      navigate(managerHome(session.role))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to log in')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
      }}
    >
      <Paper
        component="form"
        onSubmit={handleSubmit}
        sx={{ width: '100%', maxWidth: 420, p: 3 }}
      >
        <Typography variant="h5" component="h1" sx={{ mb: 3 }}>
          Dance Judging
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          fullWidth
          required
          sx={{ mb: 2 }}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          fullWidth
          required
          sx={{ mb: 3 }}
        />
        <Button type="submit" variant="contained" fullWidth disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </Paper>
    </Box>
  )
}
