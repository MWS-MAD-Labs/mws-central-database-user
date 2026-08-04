import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '../api/authApi.js'
import { AuthContext } from './authContext.js'
import {
  clearClientSession,
  createClientSession,
  isClientSessionExpired,
  readClientSession,
} from '../../../lib/clientSession.js'

const AUTH_QUERY_KEY = ['auth', 'current-user']

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [sessionMeta, setSessionMeta] = useState(() => readClientSession())

  const sessionQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      if (isClientSessionExpired()) {
        clearClientSession()
        return null
      }
      return authApi.currentUser()
    },
  })

  const loginMutation = useMutation({
    mutationFn: authApi.loginWithGoogle,
    onSuccess: (user) => {
      setSessionMeta(createClientSession(user))
      queryClient.setQueryData(AUTH_QUERY_KEY, user)
    },
  })

  const logoutMutation = useMutation({
    mutationFn: () => authApi.logout(sessionQuery.data?.type),
    onSettled: () => {
      clearClientSession()
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

  useEffect(() => {
    if (!sessionQuery.data) return
    const currentSession = readClientSession()
    if (!currentSession || isClientSessionExpired(currentSession)) {
      createClientSession(sessionQuery.data)
    }
  }, [sessionQuery.data])

  useEffect(() => {
    function handleSessionChange() {
      setSessionMeta(readClientSession())
    }

    window.addEventListener('mws:client-session-change', handleSessionChange)
    return () =>
      window.removeEventListener('mws:client-session-change', handleSessionChange)
  }, [])

  useEffect(() => {
    if (!sessionMeta?.expires_at) return undefined

    const expiresAt = new Date(sessionMeta.expires_at).getTime()
    const delay = Math.max(expiresAt - Date.now(), 0)
    const timeout = window.setTimeout(() => {
      clearClientSession()
      setSessionMeta(null)
      queryClient.setQueryData(AUTH_QUERY_KEY, null)
    }, delay)

    return () => window.clearTimeout(timeout)
  }, [queryClient, sessionMeta])

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
      sessionExpiresAt: sessionMeta?.expires_at || null,
    }),
    [
      sessionQuery.data,
      sessionQuery.error,
      sessionQuery.isPending,
      loginWithGoogle,
      logout,
      loginMutation.isPending,
      logoutMutation.isPending,
      sessionMeta?.expires_at,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
