import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { guessOptions } from '../document/csv-file'
import type { ImportOptions } from '../document/csv-file'
import { CsvWizard } from './csv-wizard'

/**
 * The questions a text file cannot answer for itself.
 *
 * What makes this a wizard rather than a page of settings is the table: the
 * point of every control here is that changing it changes what is shown, so
 * somebody who has never heard of Windows-1251 can still see that their file
 * is in it.
 */

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

/** The wizard as the app holds it: the answers live outside, as they do there. */
function Wizard({ bytes }: { bytes: Uint8Array }) {
  const [options, setOptions] = useState<ImportOptions>(() => guessOptions(bytes))

  return (
    <CsvWizard
      bytes={bytes}
      name="prices.csv"
      options={options}
      onChange={setOptions}
      onImport={() => undefined}
      onCancel={() => undefined}
    />
  )
}

const shown = () =>
  screen
    .getAllByRole('row')
    .map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent))

describe('the import wizard', () => {
  it('shows the file cut up the way it guessed', () => {
    render(<Wizard bytes={bytesOf('name;price\nchair;12,50\n')} />)

    expect(shown()).toEqual([
      ['name', 'price'],
      ['chair', '12,50'],
    ])
  })

  it('says which separator it guessed, so it can be corrected', () => {
    render(<Wizard bytes={bytesOf('name;price\nchair;12,50\n')} />)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Separator' }).value).toBe(';')
  })

  it('cuts the file again when told a different separator', async () => {
    render(<Wizard bytes={bytesOf('a;b,c\n1;2,3\n')} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Separator' }), ',')

    expect(shown()).toEqual([
      ['a;b', 'c'],
      ['1;2', '3'],
    ])
  })

  it('reads the file again when told a different encoding', async () => {
    // The whole reason the preview is there: nobody knows their file is
    // Windows-1251, but everybody can see that the words are wrong.
    render(<Wizard bytes={new Uint8Array([0xca, 0xe8, 0xbf, 0xe2, 0x2c, 0x31])} />)
    expect(shown()[0]?.[0]).not.toBe('Київ')

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Encoding' }),
      'windows-1251',
    )

    expect(shown()[0]?.[0]).toBe('Київ')
  })

  it('marks the header row it is about to make one', async () => {
    render(<Wizard bytes={bytesOf('name,price\nchair,12\n')} />)
    const header = screen.getAllByRole('row')[0]?.querySelector('td')

    expect(header?.className).toContain('font-bold')

    await userEvent.click(screen.getByRole('checkbox', { name: 'First row is a header' }))
    expect(screen.getAllByRole('row')[0]?.querySelector('td')?.className).not.toContain('font-bold')
  })

  it('shows no more than a screenful, and says so', () => {
    const text = Array.from({ length: 50 }, (_, row) => `${String(row)},x`).join('\n')
    render(<Wizard bytes={bytesOf(text)} />)

    expect(screen.getAllByRole('row')).toHaveLength(20)
    expect(screen.getByText('20 rows shown.')).toBeDefined()
  })
})
