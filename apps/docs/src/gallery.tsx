import './styles/global.css'
import { installFakeShell } from '@orangery/ui-kit/gallery/fake-shell'

// Before anything that imports the launch module: whether the page is inside
// Tauri is decided when that module first loads.
installFakeShell()

const { mountGallery } = await import('@orangery/ui-kit/gallery')
const { RecoveryBanner } = await import('./components/recovery-banner')
const never = () => undefined

mountGallery({
  recovery: (
    <RecoveryBanner
      candidates={[
        {
          key: 'a',
          snapshot: {
            version: 1,
            path: '/Users/somebody/Report.docx',
            savedAt: '',
            doc: { type: 'doc' },
          },
        },
        { key: 'b', snapshot: { version: 1, path: null, savedAt: '', doc: { type: 'doc' } } },
      ]}
      onRecover={never}
      onDiscard={never}
      onDiscardAll={never}
    />
  ),
})
