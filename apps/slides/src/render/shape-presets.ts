/**
 * The shapes a slide can be given, grouped the way PowerPoint groups them.
 *
 * Every entry here is a preset this app draws faithfully. Offering one it
 * cannot would put a rectangle on the slide wearing another shape's name, and
 * the person would find out on somebody else's screen.
 *
 * Data rather than part of the gallery component, so a test can walk it and
 * check that claim against the geometry table.
 */

export interface ShapeGroup {
  name: string
  presets: readonly (readonly [string, string])[]
}

export const SHAPE_GROUPS: readonly ShapeGroup[] = [
  {
    name: 'Rectangles',
    presets: [
      ['rect', 'Rectangle'],
      ['roundRect', 'Rounded Rectangle'],
      ['parallelogram', 'Parallelogram'],
      ['trapezoid', 'Trapezoid'],
    ],
  },
  {
    name: 'Basic',
    presets: [
      ['ellipse', 'Ellipse'],
      ['triangle', 'Triangle'],
      ['rtTriangle', 'Right Triangle'],
      ['diamond', 'Diamond'],
      ['pentagon', 'Pentagon'],
      ['hexagon', 'Hexagon'],
    ],
  },
  {
    name: 'Arrows',
    presets: [
      ['rightArrow', 'Right Arrow'],
      ['leftArrow', 'Left Arrow'],
      ['upArrow', 'Up Arrow'],
      ['downArrow', 'Down Arrow'],
    ],
  },
  {
    name: 'Stars',
    presets: [
      ['star4', 'Four-Point Star'],
      ['star5', 'Five-Point Star'],
      ['star6', 'Six-Point Star'],
      ['star8', 'Eight-Point Star'],
    ],
  },
  {
    name: 'Callouts',
    presets: [
      ['wedgeRectCallout', 'Rectangular Callout'],
      ['wedgeEllipseCallout', 'Oval Callout'],
    ],
  },
  {
    name: 'Flowchart',
    presets: [
      ['flowChartProcess', 'Process'],
      ['flowChartDecision', 'Decision'],
      ['flowChartTerminator', 'Terminator'],
      ['flowChartInputOutput', 'Data'],
      ['flowChartPreparation', 'Preparation'],
      ['flowChartConnector', 'Connector'],
    ],
  },
  {
    name: 'Lines',
    presets: [['line', 'Line']],
  },
]
