// Five calm palettes. Each is five stops walking from the deepest, slowest
// part of the flow to its brightest filaments, plus the two background tones
// the composite pass gradients between.

export const PALETTES = [
  {
    id: 'deep-ocean',
    name: 'Deep Ocean',
    bg: [[0.008, 0.020, 0.038], [0.018, 0.052, 0.078]],
    stops: [
      [0.04, 0.12, 0.26],
      [0.06, 0.28, 0.48],
      [0.10, 0.52, 0.68],
      [0.36, 0.78, 0.82],
      [0.78, 0.95, 0.94],
    ],
  },
  {
    id: 'purple-nebula',
    name: 'Purple Nebula',
    bg: [[0.020, 0.010, 0.035], [0.062, 0.024, 0.086]],
    stops: [
      [0.14, 0.06, 0.28],
      [0.31, 0.11, 0.48],
      [0.55, 0.22, 0.66],
      [0.78, 0.42, 0.80],
      [0.96, 0.80, 0.98],
    ],
  },
  {
    id: 'sunset-amber',
    name: 'Sunset Amber',
    bg: [[0.030, 0.014, 0.014], [0.078, 0.036, 0.022]],
    stops: [
      [0.24, 0.07, 0.10],
      [0.50, 0.16, 0.12],
      [0.76, 0.35, 0.14],
      [0.93, 0.60, 0.28],
      [1.00, 0.86, 0.64],
    ],
  },
  {
    id: 'emerald-aurora',
    name: 'Emerald Aurora',
    bg: [[0.006, 0.024, 0.026], [0.014, 0.056, 0.052]],
    stops: [
      [0.03, 0.18, 0.18],
      [0.05, 0.40, 0.32],
      [0.16, 0.64, 0.44],
      [0.44, 0.86, 0.58],
      [0.82, 0.98, 0.86],
    ],
  },
  {
    id: 'monochrome-blue',
    name: 'Monochrome Blue',
    bg: [[0.014, 0.018, 0.028], [0.036, 0.046, 0.066]],
    stops: [
      [0.10, 0.13, 0.20],
      [0.20, 0.26, 0.38],
      [0.36, 0.44, 0.60],
      [0.58, 0.67, 0.82],
      [0.88, 0.93, 1.00],
    ],
  },
];
