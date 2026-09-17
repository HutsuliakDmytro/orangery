import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { initI18n } from '../i18n'

// The app renders translated strings, so tests need the same bundles the app uses.
initI18n('en')

afterEach(() => {
  cleanup()
})
