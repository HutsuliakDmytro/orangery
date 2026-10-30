import { Bold, Italic, Strikethrough, Underline } from 'lucide-react'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { register, resetRegistry } from '../commands/registry'
import { CommandSourceProvider } from '../commands/source-provider'
import type { CommandSource } from '../commands/source'
import type { CommandContext } from '../commands/types'
import { TEXT_COLOR_SWATCHES } from '../colors'
import { ColorPicker } from '../components/color-picker'
import { CommandPalette } from '../components/command-palette'
import { ConfirmDialog } from '../components/confirm-dialog'
import { ErrorBoundary } from '../components/error-boundary'
import { PickerPopover } from '../components/picker-popover'
import { RecentFilesMenu } from '../components/recent-files-menu'
import { ToolbarButton, ToolbarSeparator } from '../components/toolbar-button'
import { LaunchScreen } from '../launch/launch-screen'
import { useLaunchRequests } from '../launch/use-launch-requests'
import { PreviousRunBanner } from '../launch/previous-run-banner'

/**
 * Every shared component, one at a time, drawn with an app's own stylesheet.
 *
 * The components live here and their styles do not: each app runs Tailwind
 * over its own sources and — since a fix in October 2026 — this package's,
 * and a utility nobody's stylesheet contains is no style at all. jsdom does
 * not draw, so no unit test can see that. These pages exist so a browser can.
 *
 * Each app has a `gallery.html` that imports its own `global.css` and calls
 * `mountGallery`. `?show=<name>` picks the component; `?theme=light|dark`
 * the theme. The page's own layout is inline styles on purpose, so nothing
 * about how the gallery itself is drawn depends on what is being compared.
 *
 * Development only: `vite build` builds `index.html` and nothing else.
 */

const ROOT_STYLE = { padding: 24, minHeight: '100vh', boxSizing: 'border-box' } as const

/**
 * A context of no particular shape. Each app declares its own `CommandContext`
 * — Docs' carries an editor — and the gallery is shared by all three; the
 * sample commands below read nothing from it.
 */
function standIn(value: unknown): CommandContext {
  // why: see above — no one shape is right in every app this is built into.
  return value as CommandContext
}

const sampleContext = standIn({ value: 'selected' })

const source: CommandSource = {
  read: () => sampleContext,
  subscribe: () => () => undefined,
}

function registerSampleCommands(): void {
  resetRegistry()
  const commands = [
    { id: 'gallery.bold', label: 'Bold', shortcut: 'Mod+b', active: true },
    { id: 'gallery.italic', label: 'Italic', shortcut: 'Mod+i', active: false },
    { id: 'gallery.underline', label: 'Underline', shortcut: 'Mod+u', active: false },
    { id: 'gallery.strike', label: 'Strikethrough', shortcut: null, active: false, disabled: true },
  ]
  for (const command of commands) {
    register({
      id: command.id,
      label: command.label,
      group: 'format',
      ...(command.shortcut === null ? {} : { shortcut: command.shortcut }),
      run: () => undefined,
      isActive: () => command.active,
      isEnabled: () => command.disabled !== true,
    })
  }
}

function Thrown(): ReactNode {
  throw new Error('a chart nobody could draw')
}

/** Drives the launch screen the way a real window does, with a file that will not open. */
function LaunchFailing() {
  useLaunchRequests({
    ready: true,
    vacant: true,
    open: () =>
      Promise.resolve(
        'You do not have permission to read this file. Check its sharing and permissions, or copy it somewhere you own.',
      ),
  })
  return <LaunchScreen appName="Orangery" onOpenAnother={() => undefined} />
}

/** The same, with a file that is still opening. */
function LaunchOpening() {
  useLaunchRequests({ ready: true, vacant: true, open: () => new Promise(() => undefined) })
  return <LaunchScreen appName="Orangery" onOpenAnother={() => undefined} />
}

function shared(): Record<string, ReactNode> {
  return {
    toolbar: (
      <div className="flex items-center gap-1 border-b border-border bg-surface px-2 py-1">
        <ToolbarButton id="gallery.bold" icon={Bold} />
        <ToolbarButton id="gallery.italic" icon={Italic} />
        <ToolbarButton id="gallery.underline" icon={Underline} />
        <ToolbarSeparator />
        <ToolbarButton id="gallery.strike" icon={Strikethrough} />
      </div>
    ),
    palette: <CommandPalette />,
    confirm: (
      <ConfirmDialog
        title="Do you want to save the changes you made to “Report”?"
        message="Your changes will be lost if you don't save them."
        choices={[
          { label: "Don't Save", danger: true, onChoose: () => undefined },
          { label: 'Cancel', onChoose: () => undefined },
          { label: 'Save', primary: true, onChoose: () => undefined },
        ]}
        onCancel={() => undefined}
      />
    ),
    color: (
      <ColorPicker
        title="Text colour"
        swatches={TEXT_COLOR_SWATCHES}
        resetLabel="Automatic"
        onPick={() => undefined}
        onReset={() => undefined}
        onClose={() => undefined}
      />
    ),
    popover: (
      <PickerPopover title="Line spacing" onClose={() => undefined}>
        <ul className="text-sm text-text">
          <li className="px-2 py-1">Single</li>
          <li className="px-2 py-1">1.15</li>
          <li className="px-2 py-1">Double</li>
        </ul>
      </PickerPopover>
    ),
    recent: (
      <RecentFilesMenu
        files={[
          { path: '/Users/somebody/Report.docx', name: 'Report.docx' },
          { path: '/Users/somebody/Quarterly figures.xlsx', name: 'Quarterly figures.xlsx' },
          { path: '/Users/somebody/Pitch.pptx', name: 'Pitch.pptx' },
        ]}
        onPick={() => undefined}
      />
    ),
    error: (
      <ErrorBoundary>
        <Thrown />
      </ErrorBoundary>
    ),
    'launch-failure': <LaunchFailing />,
    'launch-opening': <LaunchOpening />,
    'previous-run': <PreviousRunBanner appName="Orangery" />,
  }
}

/** The names a spec can ask for: the shared ones, and whatever an app adds. */
export const SHARED_SECTIONS = [
  'toolbar',
  'palette',
  'confirm',
  'color',
  'popover',
  'recent',
  'error',
  'launch-failure',
  'launch-opening',
  'previous-run',
] as const

export function mountGallery(extra: Record<string, ReactNode> = {}): void {
  const params = new URLSearchParams(window.location.search)
  const show = params.get('show') ?? 'toolbar'
  document.documentElement.dataset['theme'] = params.get('theme') ?? 'dark'

  registerSampleCommands()
  const section = { ...shared(), ...extra }[show] ?? <p>Nothing called “{show}”.</p>

  const element = document.getElementById('root')
  if (element === null) return
  createRoot(element).render(
    <StrictMode>
      <CommandSourceProvider source={source}>
        <div data-gallery={show} className="bg-bg text-text" style={ROOT_STYLE}>
          {section}
        </div>
      </CommandSourceProvider>
    </StrictMode>,
  )
}
