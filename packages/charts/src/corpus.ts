import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'

/**
 * Chart parts, out of whatever real files somebody has put in the corpus.
 *
 * Kept apart from the test that uses it because the report script uses it too:
 * one of them asks whether the corpus round-trips and the other asks what is
 * in it, and both need the same answer to "which parts are charts".
 */

export interface CorpusChart {
  /** The file it came out of, for a failure message that names it. */
  file: string
  part: string
  xml: string
}

const PACKAGES = ['.pptx', '.docx', '.xlsx', '.pptm', '.docm', '.xlsm']

/** Where the corpus is: beside the repository, or wherever `ORANGERY_CORPUS` says. */
export const corpusDirectory = (): string =>
  process.env['ORANGERY_CORPUS'] ?? join(process.cwd(), '../../tests/fixtures/office')

/**
 * Every package under a directory, however deep.
 *
 * The public corpus keeps its files in `docx/`, `pptx/` and `xlsx/` so that a
 * hundred and twenty of them can be looked at; a private corpus somebody
 * points `ORANGERY_CORPUS` at may be laid out any way at all. Walking is the
 * one reading of "the corpus is at this path" that is right for both.
 */
async function filesIn(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    // No directory is the ordinary case for a checkout nobody has added files
    // to; it is not a failure, it is an empty corpus.
    return []
  }

  const files: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesIn(path)))
    else if (entry.isFile() && PACKAGES.some((end) => entry.name.endsWith(end))) files.push(path)
  }

  return files.sort()
}

/** Every chart part in every package of the corpus. */
export async function readCorpus(directory = corpusDirectory()): Promise<CorpusChart[]> {
  const charts: CorpusChart[] = []

  for (const file of await filesIn(directory)) {
    const zip = await JSZip.loadAsync(await readFile(file))

    for (const path of Object.keys(zip.files)) {
      // Charts live in `charts/chartN.xml` in every host format; `colors1.xml`
      // and `style1.xml` sit beside them and are not charts.
      if (!/\/charts\/chart\d*\.xml$/u.test(path)) continue

      const entry = zip.file(path)
      if (entry === null) continue

      charts.push({
        file: file.split('/').pop() ?? file,
        part: path,
        xml: await entry.async('string'),
      })
    }
  }

  return charts
}
