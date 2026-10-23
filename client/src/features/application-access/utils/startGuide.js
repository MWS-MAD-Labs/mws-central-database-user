// Where the Start Here guide lives and how to open one of its parts.
export const START_GUIDE_PATH = '/application-access/guides'

export const startGuideHref = (part) => (part ? `${START_GUIDE_PATH}?part=${part}` : START_GUIDE_PATH)

// The same page with one application picked, so its names and values are filled in.
export const appGuideHref = (applicationId, part) => {
  const query = new URLSearchParams({ ...(part ? { part } : {}), app: applicationId })
  return `${START_GUIDE_PATH}?${query.toString()}`
}

export const ENVIRONMENT_NAMES = { development: 'Development', staging: 'Staging', production: 'Production' }
