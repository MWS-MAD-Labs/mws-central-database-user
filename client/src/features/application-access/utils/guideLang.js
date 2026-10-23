import { createContext, useContext } from 'react'

// The language a guide is read in. English is the default, Indonesian the other one. Buttons and labels of the app
// stay as they are on screen, so the text names them in English in both.
export const GUIDE_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'id', label: 'Indonesia' },
]

export const GuideLangContext = createContext('en')

export const isGuideLang = (value) => GUIDE_LANGUAGES.some((item) => item.value === value)

export function useGuideLang() {
  return useContext(GuideLangContext)
}

// t('English text', 'Teks Indonesia') picks the one of the language being read.
export function useT() {
  const lang = useGuideLang()
  return (en, id) => (lang === 'id' ? id : en)
}
