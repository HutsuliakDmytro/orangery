import { create } from 'zustand'
import type { Deck } from '@orangery/ooxml-presentation'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { compressPictures } from './compress-media'
import {
  estimatedSaving,
  MEDIA_LIMIT_BYTES,
  mediaBytes,
  pictureUses,
  shrinkPlan,
} from './media-plan'
import type { Shrink } from './media-plan'

/**
 * Offering to make a large deck smaller, on the way to disk.
 *
 * Offering, never doing. Shrinking a picture is the one edit in the app that
 * cannot be undone by opening the file again, so it is never the consequence of
 * something else the person asked for.
 *
 * The question only comes up for a deck big enough to be a nuisance to send,
 * and only when there is something to gain: a twenty-megabyte deck whose
 * pictures are all the size they are drawn has nothing to offer and is not
 * asked about.
 */

export type PicturesChoice = 'compress' | 'keep' | 'cancel'

interface Offer {
  /** Bytes of media in the deck as it stands. */
  total: number
  plan: Shrink[]
  saving: number
  answer: (choice: PicturesChoice) => void
}

interface OfferState {
  offer: Offer | null
  set: (offer: Offer | null) => void
}

export const usePicturesStore = create<OfferState>((set) => ({
  offer: null,
  set: (offer) => {
    set({ offer })
  },
}))

/**
 * Asks about the pictures if there is anything to ask, and does what was said.
 *
 * Answers whether the save should go ahead — Cancel means the person wanted
 * neither outcome, and writing the file anyway would be answering for them.
 */
export async function compressIfAsked(pkg: OoxmlPackage, deck: Deck): Promise<boolean> {
  const total = mediaBytes(pkg)
  if (total < MEDIA_LIMIT_BYTES) return true

  const plan = shrinkPlan(pictureUses(pkg, deck))
  if (plan.length === 0) return true

  const choice = await new Promise<PicturesChoice>((resolve) => {
    usePicturesStore.getState().set({
      total,
      plan,
      saving: estimatedSaving(plan),
      answer: (answered) => {
        usePicturesStore.getState().set(null)
        resolve(answered)
      },
    })
  })

  if (choice === 'cancel') return false
  if (choice === 'compress') await compressPictures(pkg, plan)
  return true
}

/** Megabytes, to one decimal, which is the precision anyone acts on. */
export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
