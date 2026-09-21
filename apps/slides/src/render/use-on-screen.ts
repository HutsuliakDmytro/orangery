import { useEffect, useRef, useState } from 'react'

/**
 * Whether an element is near enough the window to be worth drawing.
 *
 * A deck of three hundred slides is three hundred thumbnails, and each one is
 * the slide renderer: shapes, gradients, and a block of laid-out text per text
 * box. Drawing the twelve a person can see costs a fortieth of drawing all of
 * them, and the other two hundred and eighty are not being looked at.
 *
 * The margin is generous on purpose. Mounting exactly what is visible means
 * scrolling always waits for something to draw; two screens' worth either side
 * means it almost never does.
 *
 * Where there is no `IntersectionObserver` — jsdom, an old engine — everything
 * is drawn. Drawing nothing would be the other way to answer "we cannot tell",
 * and it is the wrong one.
 */
export function useOnScreen(margin = '600px') {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const node = ref.current
    if (node === null || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        setShown(entries.some((entry) => entry.isIntersecting))
      },
      { rootMargin: margin },
    )

    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [margin])

  return { ref, shown }
}
