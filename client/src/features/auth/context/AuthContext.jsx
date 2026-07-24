import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '../api/authApi.js'
import { AuthContext } from './authContext.js'

const AUTH_QUERY_KEY = ['auth', 'current-user']

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()

  const sessionQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: authApi.currentUser,
  })

  const loginMutation = useMutation({
    mutationFn: authApi.loginWithGoogle,
    onSuccess: (user) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, user)
    },
  })

  const logoutMutation = useMutation({
    mutationFn: () => authApi.logout(sessionQuery.data?.type),
    onSettled: () => {
      queryClient.setQueryData(AUTH_QUERY_KEY, null)
    },
  })

  const loginWithGoogle = useCallback(
    (code) => loginMutation.mutateAsync(code),
    [loginMutation],
  )

  const logout = useCallback(
    () => logoutMutation.mutateAsync(),
    [logoutMutation],
  )

  const value = useMemo(
    () => ({
      user: sessionQuery.data,
      isAuthenticated: Boolean(sessionQuery.data),
      isSessionLoading: sessionQuery.isPending,
      sessionError: sessionQuery.error,
      loginWithGoogle,
      logout,
      isLoggingIn: loginMutation.isPending,
      isLoggingOut: logoutMutation.isPending,
    }),
    [
      sessionQuery.data,
      sessionQuery.error,
      sessionQuery.isPending,
      loginWithGoogle,
      logout,
      loginMutation.isPending,
      logoutMutation.isPending,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
