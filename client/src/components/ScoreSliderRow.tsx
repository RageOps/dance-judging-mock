import { Box, Chip, IconButton, Paper, Slider, Typography } from '@mui/material'

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
          gap: 1,
        }}
      >
        <IconButton
          size="small"
          aria-label="Decrease score"
          disabled={disabled || score <= 1}
          onClick={() => onScoreChange(Math.max(1, score - 0.5))}
        >
          −
        </IconButton>
        <Slider
          value={score}
          onChange={(_, value) => onScoreChange(value as number)}
          disabled={disabled}
          min={1}
          max={10}
          step={0.5}
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
        <IconButton
          size="small"
          aria-label="Increase score"
          disabled={disabled || score >= 10}
          onClick={() => onScoreChange(Math.min(10, score + 0.5))}
        >
          +
        </IconButton>

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
