import { useLocation, useNavigate } from 'react-router'

// Back goes to the page the person came from. With nothing before it in the app (a page opened directly)
// it goes to the fallback.
export function useBack(fallback) {
  const navigate = useNavigate()
  const location = useLocation()
  return () => (location.key !== 'default' ? navigate(-1) : navigate(fallback))
}
