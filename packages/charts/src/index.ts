/**
 * Charts, for every app in the suite.
 *
 * A chart is the same `c:chartSpace` in a deck, a document and a workbook, so
 * it is read, drawn and edited in one place — see
 * `apps/sheets/docs/adr/0001-charts-model.md`. What differs between the apps is
 * where the part sits and where its numbers come from, and both of those are
 * the host app's business, not this package's.
 */

export { allSeries, axesOfPlot, chartKind, readChart } from './chart'
export type {
  AxisKind,
  CellRange,
  Chart,
  ChartAxis,
  ChartKind,
  ChartMarker,
  ChartPlot,
  ChartSeries,
  ChartSource,
  DataLabels,
  DataPoint,
  DataTable,
  ErrorBars,
  ManualLayout,
  Trendline,
  UnsupportedChart,
} from './chart'
export { ChartView, themeAccents } from './chart-view'
export { parseTypedNumber } from './typed-number'
export type { TypedNumber } from './typed-number'
export { applyChartEdits } from './chart-edit'
export { ChartProperties } from './chart-properties'
export { chartTitleFor, defaultChartData, newChartPart, newChartWorkbook } from './chart-template'
export type { ChartData, NewChartKind } from './chart-template'
export type { ChartPropertiesProps } from './chart-properties'
export type { ChartEdit, LabelFlags } from './chart-edit'
export {
  patchedWorkbook,
  patchedWorkbookRows,
  writeCategoriesIn,
  writeChartCache,
  writeChartCategories,
  writeChartPoints,
  writeChartSeriesName,
  writeChartXValues,
  writeSeriesNameIn,
  writeXValuesIn,
  writePointsIn,
  writeValuesIn,
} from './chart-data'
export type { ChartCategories, ChartSeriesName, ChartValues, ChartXValues } from './chart-data'
