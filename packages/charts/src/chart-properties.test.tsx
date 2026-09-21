import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { readChart } from './chart'
import type { Chart } from './chart'
import { ChartProperties } from './chart-properties'

/**
 * The panel that changes a chart.
 *
 * It states what should change and hands that over; whether the file ends up
 * right is the serialiser's question, asked in `chart-edit.test.ts`. These
 * tests are about the other half: that the controls show what the chart
 * actually says, and that using one asks for the right edit.
 */

const cache = (tag: string, values: readonly number[]) =>
  `<c:${tag}><c:numRef><c:numCache><c:ptCount val="${String(values.length)}"/>` +
  values
    .map((value, index) => `<c:pt idx="${String(index)}"><c:v>${String(value)}</c:v></c:pt>`)
    .join('') +
  `</c:numCache></c:numRef></c:${tag}>`

const chartOf = (plotArea: string, around = ''): Chart => {
  const chart = readChart(
    `<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:plotArea>${plotArea}</c:plotArea>${around}</c:chart></c:chartSpace>`,
  )
  if (chart === null) throw new Error('the part holds no chart')
  return chart
}

const COLUMNS = chartOf(
  '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>' +
    `<c:ser><c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
    `<c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>${cache('val', [1, 2])}</c:ser>` +
    '<c:dLbls><c:showVal val="1"/></c:dLbls><c:axId val="1"/><c:axId val="2"/></c:barChart>' +
    '<c:catAx><c:axId val="1"/></c:catAx>' +
    '<c:valAx><c:axId val="2"/><c:scaling><c:min val="0"/><c:max val="50"/></c:scaling>' +
    '<c:title><c:tx><c:rich><a:p><a:r><a:t>Millions</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx>',
  '<c:legend><c:legendPos val="b"/></c:legend>',
)

const panel = (chart: Chart = COLUMNS) => {
  const onEdit = vi.fn()
  render(<ChartProperties chart={chart} onEdit={onEdit} />)
  return onEdit
}

describe('what the panel shows', () => {
  it('shows the kind the chart already is', () => {
    panel()
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Chart type' }).value).toBe(
      'bar',
    )
  })

  it('shows where the legend already is', () => {
    panel()
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Legend' }).value).toBe('b')
  })

  it('shows the labels the chart already asks for', () => {
    panel()
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Values' }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Category names' }).checked).toBe(
      false,
    )
  })

  it('shows the scale the chart states, and nothing where it states none', () => {
    panel()
    const value = (name: string) => screen.getByRole<HTMLInputElement>('spinbutton', { name }).value

    expect(value('Minimum')).toBe('0')
    expect(value('Maximum')).toBe('50')
    // Nothing stated: Office decides, which is not the same as a stated zero.
    expect(value('Step')).toBe('')
  })

  it('shows the axis title and the series by name', () => {
    panel()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Axis title' }).value).toBe(
      'Millions',
    )
    expect(screen.queryByLabelText('Colour of Revenue')).not.toBeNull()
  })

  it('asks a pie nothing about an axis it does not have', () => {
    panel(chartOf(`<c:pieChart><c:ser>${cache('val', [1])}</c:ser></c:pieChart>`))
    expect(screen.queryByRole('spinbutton', { name: 'Minimum' })).toBeNull()
  })

  it('offers stacking only to the kinds that can stack', () => {
    panel()
    expect(screen.queryByRole('combobox', { name: 'Stacking' })).not.toBeNull()

    render(
      <ChartProperties
        chart={chartOf(`<c:pieChart><c:ser>${cache('val', [1])}</c:ser></c:pieChart>`)}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.queryAllByRole('combobox', { name: 'Stacking' })).toHaveLength(1)
  })
})

describe('what using it asks for', () => {
  it('changes the kind of the first group', async () => {
    const user = userEvent.setup()
    const onEdit = panel()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Chart type' }), 'line')

    expect(onEdit).toHaveBeenCalledWith([{ kind: 'plotType', plot: 0, to: 'line' }])
  })

  it('turns the bars on their side without changing the kind', async () => {
    const user = userEvent.setup()
    const onEdit = panel()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Bar direction' }), 'bar')

    expect(onEdit).toHaveBeenCalledWith([
      { kind: 'plotType', plot: 0, to: 'bar', direction: 'bar' },
    ])
  })

  it('stacks by changing the grouping of the kind it already is', async () => {
    const user = userEvent.setup()
    const onEdit = panel()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Stacking' }), 'percentStacked')

    expect(onEdit).toHaveBeenCalledWith([
      { kind: 'plotType', plot: 0, to: 'bar', grouping: 'percentStacked' },
    ])
  })

  it('moves the legend, and takes it away for None', async () => {
    const user = userEvent.setup()
    const onEdit = panel()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Legend' }), 't')
    expect(onEdit).toHaveBeenCalledWith([{ kind: 'legend', position: 't' }])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Legend' }), '')
    expect(onEdit).toHaveBeenCalledWith([{ kind: 'legend', position: null }])
  })

  it('asks for one label flag at a time, leaving the rest alone', async () => {
    const user = userEvent.setup()
    const onEdit = panel()

    await user.click(screen.getByRole('checkbox', { name: 'Category names' }))

    expect(onEdit).toHaveBeenCalledWith([{ kind: 'labels', plot: 0, show: { categories: true } }])
  })

  it('sets a bound when the box is left, and unsets it when emptied', async () => {
    const user = userEvent.setup()
    const onEdit = panel()

    const max = screen.getByRole('spinbutton', { name: 'Maximum' })
    await user.clear(max)
    await user.type(max, '80')
    await user.tab()
    expect(onEdit).toHaveBeenCalledWith([{ kind: 'axis', id: '2', max: 80 }])

    const min = screen.getByRole('spinbutton', { name: 'Minimum' })
    await user.clear(min)
    await user.tab()
    expect(onEdit).toHaveBeenCalledWith([{ kind: 'axis', id: '2', min: null }])
  })

  it('says nothing when a box is left exactly as it was', async () => {
    // A panel that wrote on every blur would make a file dirty for being
    // looked at.
    const user = userEvent.setup()
    const onEdit = panel()

    await user.click(screen.getByRole('spinbutton', { name: 'Maximum' }))
    await user.tab()

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('titles the axis, and clears the title when emptied', async () => {
    const user = userEvent.setup()
    const onEdit = panel()

    const title = screen.getByRole('textbox', { name: 'Axis title' })
    await user.clear(title)
    await user.tab()

    expect(onEdit).toHaveBeenCalledWith([{ kind: 'axis', id: '2', title: null }])
  })

  it('colours a series', () => {
    const onEdit = panel()

    // A colour well is dragged rather than typed into, so the change is fired
    // rather than acted out.
    fireEvent.change(screen.getByLabelText('Colour of Revenue'), {
      target: { value: '#00ff00' },
    })

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: 'seriesColor',
        series: 0,
        color: { source: { kind: 'srgb', hex: '#00FF00' }, transforms: [] },
      },
    ])
  })
})

describe('a kind that does not cluster', () => {
  const LINE = chartOf(
    `<c:lineChart><c:ser>${cache('val', [1, 2])}</c:ser><c:axId val="1"/></c:lineChart>` +
      '<c:catAx><c:axId val="1"/></c:catAx>',
  )

  it('is not offered a stacking a line chart has no word for', () => {
    // `clustered` belongs to bar charts alone; written into a `c:lineChart` it
    // is a value the schema has no name for, and Excel offers to repair it.
    panel(LINE)

    const options = [
      ...screen.getByRole('combobox', { name: 'Stacking' }).querySelectorAll('option'),
    ]
    expect(options.map((option) => option.getAttribute('value'))).toEqual([
      'standard',
      'stacked',
      'percentStacked',
    ])
  })

  it('shows what a line chart means by not stacked, rather than a bar’s word', () => {
    panel(LINE)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Stacking' }).value).toBe(
      'standard',
    )
  })
})

describe('the colour a series is drawn in', () => {
  const themed = chartOf(
    `<c:barChart><c:ser>${cache('val', [1])}</c:ser><c:ser>${cache('val', [2])}</c:ser></c:barChart>`,
  )

  it('is the theme’s accent for its position, not a fixed default', () => {
    // A series almost never states a colour of its own. Showing one default
    // for every series tells somebody their green series is blue.
    render(<ChartProperties chart={themed} onEdit={vi.fn()} palette={['#112233', '#445566']} />)

    expect(screen.getByLabelText<HTMLInputElement>('Colour of Series 1').value).toBe('#112233')
    expect(screen.getByLabelText<HTMLInputElement>('Colour of Series 2').value).toBe('#445566')
  })

  it('offers no way back while the series has none of its own', () => {
    render(<ChartProperties chart={themed} onEdit={vi.fn()} palette={['#112233']} />)
    expect(screen.queryByRole('button', { name: /Use the theme colour/u })).toBeNull()
  })

  it('offers the way back once a colour has been stated, and takes it', async () => {
    const user = userEvent.setup()
    const onEdit = panel()

    await user.click(screen.getByRole('button', { name: 'Use the theme colour for Revenue' }))

    expect(onEdit).toHaveBeenCalledWith([{ kind: 'seriesColor', series: 0, color: null }])
  })
})
