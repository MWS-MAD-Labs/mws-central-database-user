import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { Toaster } from 'react-hot-toast'
import { ConfirmProvider } from '../components/ui/ConfirmDialog.jsx'
import { AuthProvider } from '../features/auth/context/AuthContext.jsx'
import { showErrorToast } from '../lib/toast.js'
import 'dayjs/locale/id'

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => showErrorToast(error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => showErrorToast(error),
  }),
  defaultOptions: {
    queries: {
      // Refetches stale (>staleTime) queries when a tab/window regains
      // focus - the tab an admin left open still shows what it had when
      // they switched away, since each tab's cache lives in its own memory
      // with no cross-tab sync. Cheap: still respects staleTime below, so
      // switching back within 2 minutes of the last fetch is a no-op, not
      // an extra request every time.
      refetchOnWindowFocus: true,
      retry: false,
      staleTime: 1000 * 60 * 2,
    },
  },
})

export function AppProviders({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="id">
        <AuthProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                border: '1px solid var(--mws-line)',
                borderRadius: '16px',
                color: 'var(--mws-charcoal)',
                fontSize: '14px',
                maxWidth: '420px',
                padding: '12px 14px',
              },
              error: {
                iconTheme: {
                  primary: 'var(--mws-rose)',
                  secondary: '#fff',
                },
              },
              success: {
                iconTheme: {
                  primary: 'var(--mws-sage)',
                  secondary: '#fff',
                },
              },
            }}
          />
        </AuthProvider>
      </LocalizationProvider>
    </QueryClientProvider>
  )
}
