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
import RoleChip from './RoleChip'

export default function JudgeLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <Box sx={{ minHeight: '100vh', pb: 'env(safe-area-inset-bottom)' }}>
      <AppBar position="sticky">
        <Toolbar sx={{ gap: 1 }}>
          <Box
            sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <Typography variant="h6">
              {user?.firstName ? `Judge ${user.firstName}` : 'Dance Judging'}
            </Typography>
            <RoleChip role={user?.role} />
          </Box>
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
