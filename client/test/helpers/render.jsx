import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter } from 'react-router'

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(ui, {
  route = '/',
  queryClient = createTestQueryClient(),
  withRouter = true,
} = {}) {
  const content = (
    <QueryClientProvider client={queryClient}>
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="id">
        {ui}
      </LocalizationProvider>
    </QueryClientProvider>
  )
  const result = render(
    withRouter ? <MemoryRouter initialEntries={[route]}>{content}</MemoryRouter> : content,
  )

  return { ...result, user: userEvent.setup(), queryClient }
}
