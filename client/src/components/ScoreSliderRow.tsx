import { Box, Chip, Paper, Slider, Typography } from '@mui/material'

type ScoreSliderRowProps = {
  bibNumber: number
  competitorName?: string
  role?: 'lead' | 'follow'
  score: number
  disabled?: boolean
  onScoreChange: (score: number) => void
}

export default function ScoreSliderRow({
  bibNumber,
  competitorName,
  role,
  score,
  disabled = false,
  onScoreChange,
}: ScoreSliderRowProps) {
  return (
    <Box
      sx={{
        width: '100%',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 1.5,
        }}
      >
        <Typography sx={{ fontWeight: 700, fontSize: '1.15rem' }}>
          #{bibNumber}
        </Typography>
        {competitorName && (
          <Typography sx={{ flexGrow: 1 }}>{competitorName}</Typography>
        )}
        {role && (
          <Chip
            size="small"
            variant="outlined"
            sx={{ ml: 'auto' }}
            label={role === 'lead' ? 'Lead' : 'Follow'}
          />
        )}
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Slider
          value={score}
          onChange={(_, value) => onScoreChange(value as number)}
          disabled={disabled}
          min={1}
          max={10}
          step={1}
          valueLabelDisplay="off"
          marks={[
            { value: 1, label: '1' },
            { value: 10, label: '10' },
          ]}
          sx={{
            flex: 1,
            minWidth: 0,
          }}
        />

        <Paper
          variant="outlined"
          sx={{
            width: 48,
            height: 48,
            minWidth: 48,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            fontWeight: 700,
            fontSize: '1.25rem',
            fontVariantNumeric: 'tabular-nums',
            bgcolor: disabled ? 'action.disabledBackground' : 'background.paper',
          }}
        >
          {score}
        </Paper>
      </Box>
    </Box>
  )
}
