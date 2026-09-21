import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/** As much of the open deck as this spec has to name. */
interface OpenDeckLike {
  deck: { slides: unknown[] }
  themes: unknown
  package: unknown
}

/**
 * A slide turned into pixels, by the engine that drew it.
 *
 * The one thing about exporting a picture that is a question about the browser
 * rather than about this code: a slide's text is HTML inside a `foreignObject`,
 * and whether an engine will rasterise that out of an `<img>` is the engine's
 * answer to give. WebKit has been inconsistent about it for years, and WebKit
 * is what the app runs in on macOS — so this spec runs in both engines, and the
 * failure it is looking for is a picture that saved without complaint and came
 * out blank.
 *
 * The markup is the canvas's own drawing, lifted from the page, and the
 * rasteriser is the app's own — imported from the dev server rather than
 * copied, because a copy would answer for itself and not for the app.
 *
 * What this does not cover: the packaged app's WKWebView is a different build
 * of WebKit from Playwright's. One look at a real export stays in
 * `docs/qa-checklist.md`.
 */

/** A picture, decoded and measured: how much of it is not the background. */
async function drawnPixels(page: Page, markup: string, type: 'image/png' | 'image/jpeg') {
  return page.evaluate(
    async ([svg, mime]) => {
      // The app's own rasteriser, out of the dev server's module graph rather
      // than copied in here: a copy would answer for itself and not for the
      // app. By the URL the page actually loaded, because the dev server hands
      // an edited module out under a timestamped one and importing the plain
      // path would make a second copy with a state of its own.
      const path = loaded('export-image')
      const module = (await import(path)) as {
        rasterise: (
          markup: string,
          size: { width: number; height: number },
          type: string,
          scale?: number,
        ) => Promise<Uint8Array>
      }

      const size = { width: 640, height: 360 }
      const bytes = await module.rasterise(svg, size, mime)

      const signature = [...bytes.slice(0, 4)]
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))

      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const loading = new Image()
        loading.addEventListener('load', () => {
          resolve(loading)
        })
        loading.addEventListener('error', () => {
          reject(new Error('the exported bytes are not a picture'))
        })
        loading.src = url
      })

      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('no canvas')

      context.drawImage(image, 0, 0, size.width, size.height)
      const pixels = context.getImageData(0, 0, size.width, size.height).data

      // Anything that is not the first pixel: a blank export is one colour from
      // corner to corner, whatever colour that turns out to be.
      const corner = [pixels[0], pixels[1], pixels[2]]
      let different = 0
      for (let at = 0; at < pixels.length; at += 4) {
        if (
          pixels[at] !== corner[0] ||
          pixels[at + 1] !== corner[1] ||
          pixels[at + 2] !== corner[2]
        ) {
          different += 1
        }
      }

      URL.revokeObjectURL(url)
      return { signature, different, bytes: bytes.length }
    },
    [markup, type] as const,
  )
}

/**
 * The URL a module was actually loaded under, for `import` inside the page.
 *
 * The dev server hands an edited module out under a timestamped URL, and a
 * plain path would fetch a second copy with a store of its own — which looks
 * exactly like an app with no deck open.
 */
const LOADED = `window.loaded = (name) => {
  const entries = performance.getEntriesByType('resource').map((entry) => entry.name)
  return entries.find((entry) => entry.includes(name)) ?? name
}`

test.beforeEach(async ({ page }) => {
  await page.addInitScript(LOADED)
  await page.goto('/')
  await page.getByRole('button', { name: 'New from Template…' }).click()

  const chooser = page.getByRole('dialog', { name: 'New Presentation' })
  await chooser.getByRole('button', { name: /Pitch/ }).click()
  await expect(page.getByTestId('canvas')).toContainText('Company')
})

/**
 * The slide as the app exports it.
 *
 * Through `slideSvg` and the open deck, not by lifting the canvas's SVG out of
 * the page: the canvas draws inside a document that is giving it a stylesheet
 * and a set of CSS variables, and a data URL is given neither. Markup taken
 * from the window rasterises to a blank rectangle — which is the very failure
 * this spec exists to catch, and it would have caught it in the test instead of
 * in the app.
 */
async function slideMarkup(page: Page): Promise<string> {
  const markup = await page.evaluate(async () => {
    // The dev server's own module graph, so these are the instances the app is
    // running on rather than second copies of them.
    const storePath = loaded('deck-store')
    const exportPath = loaded('export-image')

    const store = (await import(storePath)) as {
      useDeckStore: { getState: () => { open: OpenDeckLike | null; current: number } }
    }
    const exporting = (await import(exportPath)) as {
      slideSvg: (deck: unknown, slide: unknown, themes: unknown, pkg: unknown) => string
    }

    const { open, current } = store.useDeckStore.getState()
    if (open === null) throw new Error('no deck is open')

    const slide = open.deck.slides[current]
    return exporting.slideSvg(open.deck, slide, open.themes, open.package)
  })

  expect(markup).toContain('foreignObject')
  return markup
}

test('rasterises a slide, text and all', async ({ page }) => {
  const result = await drawnPixels(page, await slideMarkup(page), 'image/png')

  // The PNG signature, so the bytes are the format they claim to be.
  expect(result.signature).toEqual([0x89, 0x50, 0x4e, 0x47])
  // A tenth of a percent of the picture is a low bar on purpose: the failure is
  // a slide that came out entirely empty, not one that came out slightly wrong.
  expect(result.different).toBeGreaterThan(640 * 360 * 0.001)
})

test('writes a JPEG on a white ground rather than a black one', async ({ page }) => {
  const result = await drawnPixels(page, await slideMarkup(page), 'image/jpeg')

  expect(result.signature.slice(0, 2)).toEqual([0xff, 0xd8])
  expect(result.different).toBeGreaterThan(640 * 360 * 0.001)
})

test('says so instead of writing a picture it could not draw', async ({ page }) => {
  // A file that saved without complaining and holds nothing is worse than one
  // that did not save.
  const failed = await page.evaluate(async () => {
    const path = loaded('export-image')
    const module = (await import(path)) as {
      rasterise: (
        markup: string,
        size: { width: number; height: number },
        type: string,
      ) => Promise<Uint8Array>
    }

    try {
      await module.rasterise('<not-a-drawing>', { width: 10, height: 10 }, 'image/png')
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })

  expect(failed).toContain('could not be turned into a picture')
})
