import { Box, CircularProgress } from '@mui/material'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/auth'

export default function ProtectedRoute({
  adminOnly = false,
  judgeOnly = false,
}: {
  adminOnly?: boolean
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
    return <Navigate to="/judge/events" replace />
  }
  if (judgeOnly && user.role !== 'judge') {
    return <Navigate to="/events" replace />
  }
  return <Outlet />
}
