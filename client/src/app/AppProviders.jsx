import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '../features/auth/context/AuthContext.jsx'
import { showErrorToast } from '../lib/toast.js'

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => showErrorToast(error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => showErrorToast(error),
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 1000 * 60 * 2,
    },
  },
})

export function AppProviders({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
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
    </QueryClientProvider>
  )
}
