/**
 * The colours a formula's references are shown in.
 *
 * One list, used twice and only useful because it is used twice: the third
 * reference in the text is the same colour as the third box on the sheet, and
 * that correspondence *is* the feature. Somebody writing `=SUM(B2:B9)/C1`
 * reads which part of it is which by looking at the sheet, not at the text.
 *
 * Excel's own five, in Excel's own order, because somebody coming from Excel
 * reads them without being told.
 */
export const REFERENCE_COLORS = ['#2A6FC9', '#C0392B', '#8E44AD', '#1E8449', '#B9770E'] as const

export const colorOfReference = (index: number): string =>
  REFERENCE_COLORS[index % REFERENCE_COLORS.length] ?? REFERENCE_COLORS[0]
