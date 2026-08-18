import {
  AppBar,
  Box,
  Button,
  Container,
  Toolbar,
  Typography,
} from '@mui/material'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/auth'

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { eventId } = useParams()

  return (
    <Box sx={{ minHeight: '100vh', pb: 'env(safe-area-inset-bottom)' }}>
      <AppBar position="sticky">
        <Toolbar sx={{ gap: 1 }}>
          <Typography
            variant="h6"
            sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }}
          >
            Dance Judging
          </Typography>
          <Button color="inherit" onClick={() => navigate('/events')}>
            Events
          </Button>
          {user?.role === 'admin' && (
            <>
              <Button color="inherit" onClick={() => navigate('/judges')}>
                Judges
              </Button>
              <Button color="inherit" onClick={() => navigate('/coordinators')}>
                Coordinators
              </Button>
            </>
          )}
          <Button
            color="inherit"
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
          >
            Log out
          </Button>
        </Toolbar>
      </AppBar>

      {eventId && (
        <Box
          component="nav"
          sx={{
            display: 'flex',
            position: 'sticky',
            top: 64,
            zIndex: 1,
            bgcolor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Button
            fullWidth
            onClick={() => navigate(`/events/${eventId}/competitors`)}
          >
            Competitors
          </Button>
          <Button
            fullWidth
            onClick={() => navigate(`/events/${eventId}/divisions`)}
          >
            Divisions
          </Button>
        </Box>
      )}

      <Container component="main" maxWidth="md" sx={{ py: 3 }}>
        <Outlet />
      </Container>
    </Box>
  )
}
