import {
  AppBar,
  Box,
  Button,
  Container,
  Toolbar,
  Typography,
} from '@mui/material'
import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'

export default function JudgeLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <Box sx={{ minHeight: '100vh', pb: 'env(safe-area-inset-bottom)' }}>
      <AppBar position="sticky">
        <Toolbar sx={{ gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {user?.firstName ? `Judge ${user.firstName}` : 'Dance Judging'}
          </Typography>
          <Button color="inherit" onClick={() => navigate('/judge/events')}>
            Events
          </Button>
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
      <Container component="main" maxWidth="md" sx={{ py: 3 }}>
        <Outlet />
      </Container>
    </Box>
  )
}
