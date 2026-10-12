// Where the Hub groups an application card. Keep in step with the server and the Hub.
export const CATEGORIES = [
  { value: 'safespace', label: 'Safespace' },
  { value: 'learnspace', label: 'Learnspace' },
  { value: 'carespace', label: 'Carespace' },
  { value: 'shieldspace', label: 'Shieldspace' },
  { value: 'others', label: 'Others' },
]

export const DEFAULT_CATEGORY = 'others'

export const categoryLabel = (value) => CATEGORIES.find((item) => item.value === value)?.label ?? 'Others'
