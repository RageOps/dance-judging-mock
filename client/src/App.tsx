import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import JudgeLayout from './components/JudgeLayout'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/auth'
import CompetitorsPage from './pages/CompetitorsPage'
import DivisionsPage from './pages/DivisionsPage'
import DivisionStatusPage from './pages/DivisionStatusPage'
import EventsPage from './pages/EventsPage'
import JudgeDivisionsPage from './pages/JudgeDivisionsPage'
import JudgeEventsPage from './pages/JudgeEventsPage'
import JudgesPage from './pages/JudgesPage'
import LoginPage from './pages/LoginPage'
import ScoringPage from './pages/ScoringPage'

function HomeRedirect() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return (
    <Navigate
      to={user.role === 'admin' ? '/events' : '/judge/events'}
      replace
    />
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute adminOnly />}>
            <Route element={<AppLayout />}>
              <Route path="/events" element={<EventsPage />} />
              <Route path="/judges" element={<JudgesPage />} />
              <Route
                path="/events/:eventId/competitors"
                element={<CompetitorsPage />}
              />
              <Route
                path="/events/:eventId/divisions"
                element={<DivisionsPage />}
              />
              <Route
                path="/events/:eventId/divisions/:divisionId/status"
                element={<DivisionStatusPage />}
              />
            </Route>
          </Route>

          <Route element={<ProtectedRoute judgeOnly />}>
            <Route element={<JudgeLayout />}>
              <Route path="/judge/events" element={<JudgeEventsPage />} />
              <Route
                path="/judge/events/:eventId/divisions"
                element={<JudgeDivisionsPage />}
              />
              <Route
                path="/judge/events/:eventId/divisions/:divisionId/score"
                element={<ScoringPage />}
              />
              <Route
                path="/judge/events/:eventId/divisions/:divisionId/status"
                element={<DivisionStatusPage />}
              />
            </Route>
          </Route>

          <Route path="/" element={<HomeRedirect />} />
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
