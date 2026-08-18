import { Box, CircularProgress } from '@mui/material'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/auth'

function managerHome(role: string) {
  return role === 'judge' ? '/judge/events' : '/events'
}

export default function ProtectedRoute({
  adminOnly = false,
  managerOnly = false,
  judgeOnly = false,
}: {
  adminOnly?: boolean
  managerOnly?: boolean
  judgeOnly?: boolean
}) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading session" />
      </Box>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && user.role !== 'admin') {
    return <Navigate to={managerHome(user.role)} replace />
  }
  if (
    managerOnly &&
    user.role !== 'admin' &&
    user.role !== 'coordinator'
  ) {
    return <Navigate to={managerHome(user.role)} replace />
  }
  if (judgeOnly && user.role !== 'judge') {
    return <Navigate to={managerHome(user.role)} replace />
  }
  return <Outlet />
}
