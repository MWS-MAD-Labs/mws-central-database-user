// Where the Start Here guide lives and how to open one of its parts.
export const START_GUIDE_PATH = '/application-access/guide'

export const startGuideHref = (part) => (part ? `${START_GUIDE_PATH}?part=${part}` : START_GUIDE_PATH)
