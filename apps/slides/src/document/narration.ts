import { mediaContentTypeFor } from '@orangery/ooxml-drawingml'

/**
 * Recording what is said over each slide.
 *
 * One recording per slide rather than one for the talk: a slide gone back to is
 * recorded again, and a single track would have to be cut afterwards by
 * somebody who no longer remembers where the joins were.
 *
 * The format is whatever the engine produces. Chromium gives WebM with Opus
 * inside, WebKit gives MP4 with AAC — asking for a particular one and being
 * refused would mean no recording at all, and a deck with a sound it cannot
 * play is better answered by the machine that made it than by this code.
 */

export interface Recording {
  bytes: Uint8Array
  fileName: string
  contentType: string
}

/** The extension for what the recorder says it is producing. */
function extensionFor(mimeType: string): string {
  const type = mimeType.split(';')[0]?.trim() ?? ''
  switch (type) {
    case 'audio/mp4':
      return 'm4a'
    case 'audio/mpeg':
      return 'mp3'
    case 'audio/wav':
      return 'wav'
    case 'audio/ogg':
      return 'ogg'
    default:
      return 'weba'
  }
}

export interface NarrationRecorder {
  /** Closes off what is being recorded and starts a new piece. */
  cut: () => Promise<Recording | null>
  /** Stops for good and gives back the last piece. */
  stop: () => Promise<Recording | null>
}

/**
 * Starts recording, or answers null where there is no microphone to record
 * from — no permission, no device, no support.
 *
 * Null rather than a thrown error: a show that refused to start because the
 * microphone was busy would be a show that did not happen.
 */
export async function startRecording(): Promise<NarrationRecorder | null> {
  if (typeof MediaRecorder === 'undefined' || typeof navigator.mediaDevices === 'undefined') {
    return null
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    return null
  }

  let recorder = new MediaRecorder(stream)
  let chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.start()

  /** Waits for the recorder to stop, then hands back what it produced. */
  const collect = async (): Promise<Recording | null> => {
    const mimeType = recorder.mimeType
    const finished = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        resolve()
      }
    })

    if (recorder.state !== 'inactive') recorder.stop()
    await finished

    const blob = new Blob(chunks, { type: mimeType })
    chunks = []
    if (blob.size === 0) return null

    const extension = extensionFor(mimeType)
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      fileName: `narration.${extension}`,
      contentType: mediaContentTypeFor(`x.${extension}`) ?? 'audio/mpeg',
    }
  }

  return {
    cut: async () => {
      const piece = await collect()
      // A fresh recorder for the next slide: one restarted after stopping
      // gives a file that players read as two, which is a file nobody can cut.
      recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.start()
      return piece
    },

    stop: async () => {
      const piece = await collect()
      for (const track of stream.getTracks()) track.stop()
      return piece
    },
  }
}
