import { ConfirmDialog } from '@orangery/ui-kit'
import { megabytes, usePicturesStore } from '../document/pictures-offer'

/**
 * The offer to shrink the pictures, on the way to disk.
 *
 * "About", because the saving is worked out from pixel counts: that is close
 * for a photograph and meaningless for a flat-coloured screenshot, and the word
 * is the difference between an estimate and a promise.
 */
export function PicturesDialog() {
  const offer = usePicturesStore((state) => state.offer)
  if (offer === null) return null

  const count = offer.plan.length
  const pictures = count === 1 ? 'One picture is' : `${String(count)} pictures are`

  return (
    <ConfirmDialog
      title="Large presentation"
      message={`This presentation carries ${megabytes(offer.total)} of pictures. ${pictures} larger than the space ${count === 1 ? 'it is' : 'they are'} drawn in; shrinking ${count === 1 ? 'it' : 'them'} would save about ${megabytes(offer.saving)}.`}
      onCancel={() => {
        offer.answer('cancel')
      }}
      choices={[
        {
          label: 'Save as is',
          onChoose: () => {
            offer.answer('keep')
          },
        },
        {
          label: 'Cancel',
          onChoose: () => {
            offer.answer('cancel')
          },
        },
        {
          label: 'Shrink and Save',
          primary: true,
          onChoose: () => {
            offer.answer('compress')
          },
        },
      ]}
    />
  )
}
