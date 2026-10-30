import './styles/global.css'
import { installFakeShell } from '@orangery/ui-kit/gallery/fake-shell'

// Before anything that imports the launch module: whether the page is inside
// Tauri is decided when that module first loads.
installFakeShell()

const { mountGallery } = await import('@orangery/ui-kit/gallery')

// Sheets' recovery strip is written inline in its shell rather than as a
// component, so it is not here; it is drawn with this app's own utilities,
// which Tailwind always found.
mountGallery()
