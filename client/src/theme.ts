import { createTheme } from '@mui/material/styles'

const theme = createTheme({
  breakpoints: {
    values: {
      xs: 0,
      sm: 600,
      md: 900,
      lg: 1200,
      xl: 1536,
    },
  },
  typography: {
    fontSize: 16,
    h5: {
      fontWeight: 700,
    },
  },
  components: {
    MuiSlider: {
      styleOverrides: {
        root: {
          padding: '16px 0',
        },
        thumb: {
          width: 28,
          height: 28,
          '&:hover, &.Mui-focusVisible': {
            boxShadow: '0 0 0 8px rgba(25, 118, 210, 0.16)',
          },
        },
        rail: {
          height: 6,
        },
        track: {
          height: 6,
        },
      },
    },
  },
})

export default theme
