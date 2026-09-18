import { flatten, readTransition, relationshipTarget } from '@orangery/ooxml-presentation'
import type { Deck, Slide } from '@orangery/ooxml-presentation'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import type { Theme } from '@orangery/ooxml-drawingml'
import { slideSvg } from './export-image'

/**
 * The deck as a film.
 *
 * Each slide is drawn once, into a canvas, and held there for as long as the
 * deck says it should be. The canvas is recorded — `captureStream` and
 * `MediaRecorder`, which every engine this app runs in already has. An encoder
 * of our own, or a bundled `ffmpeg`, would be a second way of drawing a slide
 * and a much larger thing to ship for a feature nobody uses twice a day.
 *
 * Three limits, all of them worth knowing before starting:
 *
 *   **It runs in real time.** A recorder timestamps by the wall clock, so a
 *   twenty-minute deck takes twenty minutes. Nothing here can hurry it.
 *
 *   **The container is the engine's.** WebM from Chromium, MP4 from WebKit.
 *   Asking for a particular one and being refused would mean no film at all.
 *
 *   **The sound is whatever the slides carry.** A deck that was never recorded
 *   makes a silent film, which is the right answer rather than a missing one.
 */

/** What a slide is held for when the deck states no timing of its own. */
const DEFAULT_HOLD = 5000

/**
 * How long each slide stays on screen, in milliseconds.
 *
 * What the deck states, which is what rehearsing wrote down. A slide that waits
 * for a press has nothing to wait for in a film, and a slide shown for no time
 * is a slide nobody saw.
 */
export function holdsFor(slides: readonly Slide[], fallback = DEFAULT_HOLD): number[] {
  return slides.map((slide) => {
    const stated = readTransition(slide)?.advanceAfter
    return stated !== null && stated !== undefined && stated > 0 ? stated : fallback
  })
}

/**
 * The narration on a slide, as bytes.
 *
 * A sound placed on the slide, which is what recording a run leaves behind and
 * what PowerPoint puts there too. A film that ignored it would be a film of a
 * talk with the talking taken out.
 */
function narrationOf(pkg: OoxmlPackage, slide: Slide): Uint8Array | undefined {
  for (const shape of flatten(slide.shapes)) {
    if (shape.media?.kind !== 'audio') continue

    const id = shape.media.embeddedId ?? shape.media.relationshipId
    const target = id === null ? null : relationshipTarget(pkg, slide.path, id)
    const bytes = target === null ? undefined : pkg.parts.get(target)?.bytes
    if (bytes !== undefined) return bytes
  }

  return undefined
}

/**
 * The sound of the film, as a track a recorder can take.
 *
 * Built once and played into slide by slide. A destination per slide would be
 * a track per slide, and a recorder takes the tracks it was given when it
 * started and no others.
 */
interface Sound {
  track: MediaStreamTrack
  context: AudioContext
  /** What every slide's narration is played into, and the recorder listens to. */
  destination: MediaStreamAudioDestinationNode
}

function openSound(): Sound | null {
  // Every engine this runs in has one; the test environment does not, and a
  // film with no sound is the right answer there rather than a failure.
  if (typeof AudioContext === 'undefined') return null

  const context = new AudioContext()
  const destination = context.createMediaStreamDestination()
  const [track] = destination.stream.getAudioTracks()

  return track === undefined ? null : { track, context, destination }
}

export interface VideoOptions {
  deck: Deck
  themes: Map<string, Theme>
  package: OoxmlPackage
  /** The longest side in pixels; the other follows the slide's shape. */
  width?: number
  /** Told the slide being recorded, so something can say how far along it is. */
  onProgress?: (index: number, count: number) => void
  /** Answers true to stop early, which keeps what has been recorded so far. */
  cancelled?: () => boolean
}

export interface Video {
  bytes: Uint8Array
  /** `webm` or `mp4`, whichever the engine produced. */
  extension: string
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/** The file extension for what the recorder says it made. */
function extensionFor(mimeType: string): string {
  const type = mimeType.split(';')[0]?.trim() ?? ''
  return type === 'video/mp4' ? 'mp4' : 'webm'
}

/**
 * Records the deck. Returns null where this engine cannot make a film at all.
 *
 * Null rather than a thrown error for the one case that is not a failure: a
 * build without `MediaRecorder` is a build where the command should not have
 * been offered, and saying so is more use than a stack trace.
 */
export async function exportVideo(options: VideoOptions): Promise<Video | null> {
  if (typeof MediaRecorder === 'undefined') return null

  const size = options.deck.slideSize
  const width = Math.max(Math.round(options.width ?? 1280), 16)
  const height = Math.max(Math.round((width * size.height) / size.width), 16)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (context === null || typeof canvas.captureStream !== 'function') return null

  // Thirty a second, which is what a deck of still pictures needs and no more.
  const stream = canvas.captureStream(30)
  const sound = openSound()
  if (sound !== null) stream.addTrack(sound.track)

  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const holds = holdsFor(options.deck.slides)
  recorder.start()

  try {
    for (const [index, slide] of options.deck.slides.entries()) {
      if (options.cancelled?.() === true) break
      options.onProgress?.(index, options.deck.slides.length)

      const markup = slideSvg(options.deck, slide, options.themes, options.package)
      const image = await new Promise<HTMLImageElement | null>((resolve) => {
        const loading = new Image()
        loading.addEventListener('load', () => {
          resolve(loading)
        })
        loading.addEventListener('error', () => {
          resolve(null)
        })
        loading.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
      })

      // A slide the engine will not rasterise is drawn white rather than
      // skipped: a film that is missing slide 7 is worse than one where slide 7
      // is blank, because only one of the two is obvious.
      context.fillStyle = '#FFFFFF'
      context.fillRect(0, 0, width, height)
      if (image !== null) context.drawImage(image, 0, 0, width, height)

      // The slide is held for as long as what is said over it, or for what the
      // deck says, whichever is longer: cutting a sentence in half to keep to
      // a timing would be keeping the wrong promise.
      const spoken = await play(sound, options.package, slide)
      await sleep(Math.max(holds[index] ?? DEFAULT_HOLD, spoken))
    }
  } finally {
    void sound?.context.close()

    const finished = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        resolve()
      }
    })
    if (recorder.state !== 'inactive') recorder.stop()
    await finished
    for (const track of stream.getTracks()) track.stop()
  }

  const blob = new Blob(chunks, { type: recorder.mimeType })
  if (blob.size === 0) return null

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    extension: extensionFor(recorder.mimeType),
  }
}

/**
 * Starts the slide's narration, and answers how long it runs for.
 *
 * Zero where there is nothing to play, or where this engine cannot decode what
 * was recorded — a film that stopped because one sound was unreadable would
 * lose the other thirty-nine slides as well.
 */
async function play(sound: Sound | null, pkg: OoxmlPackage, slide: Slide): Promise<number> {
  if (sound === null) return 0

  const bytes = narrationOf(pkg, slide)
  if (bytes === undefined) return 0

  try {
    const decoded = await sound.context.decodeAudioData(bytes.slice().buffer)
    const source = sound.context.createBufferSource()
    source.buffer = decoded

    // Into what the recorder is listening to, and not to the speakers: a film
    // being made is not a film being played.
    source.connect(sound.destination)
    source.start()

    return decoded.duration * 1000
  } catch {
    return 0
  }
}
