import { SlideView } from '../render/slide-view'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { WelcomeScreen } from './welcome-screen'

/** The slide being edited, centred with room around it. */
export function Canvas() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const error = useDeckStore((state) => state.error)
  const selection = useDeckStore((state) => state.selection)
  const selectShapes = useDeckStore((state) => state.selectShapes)

  if (error !== null) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p role="alert" className="max-w-md text-center text-sm text-danger">
          {error}
        </p>
      </div>
    )
  }

  if (open === null || slide === null) return <WelcomeScreen />

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <SlideView
        deck={open.deck}
        slide={slide}
        themes={open.themes}
        package={open.package}
        selection={selection}
        onSelect={(id, extend) => {
          selectShapes(id === null ? [] : [id], extend && id !== null)
        }}
        className="w-full max-w-4xl shadow-lg"
      />
    </div>
  )
}
