import { Chip } from '@mui/material'

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  coordinator: 'Coordinator',
  judge: 'Judge',
}

export default function RoleChip({ role }: { role?: string }) {
  if (!role) return null
  if (role === 'admin') {
    return <Chip size="small" color="error" label="Admin" />
  }
  return (
    <Chip
      size="small"
      variant="outlined"
      label={roleLabels[role] ?? role}
      sx={{ color: 'common.white', borderColor: 'rgba(255, 255, 255, 0.5)' }}
    />
  )
}
