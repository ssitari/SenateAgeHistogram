// ============================================================
//  config.js  —  Edit this file to use your own data
// ============================================================
//
//  The chart draws two layers on one shared count axis:
//
//    silhouette — the selected number of seats, distributed the way some
//                 baseline population was. What the chamber "should" look like.
//    dots       — one dot per senator actually sitting. What it did look like.
//
//  Because both layers are counts of senators, they share a y scale. There is
//  no second axis and no normalisation trick; the silhouette is simply the
//  baseline's shares multiplied by however many seats are selected.
//
// ============================================================

export const AGES_FILE      = './senate_ages.csv';       // one row per senator x Congress
export const CONGRESS_FILE  = './senate_congresses.csv'; // one row per Congress

export const FIELDS = {
  congress: 'congress',
  convened: 'convened',
  year:     'year',
  id:       'bioguide',
  name:     'name',
  state:    'state',
  party:    'party',
  partyRaw: 'party_raw',
  age:       'age_years',
  ageExact:  'age_exact',
  precision: 'age_precision',   // 'day' | 'month' | 'year'
  seats:        'seats',            // seats filled on the convening date
  seatsWithAge: 'seats_with_age',   // ...of which we know a birth date
  missing:      'missing_birthday',
  median:       'median_age',
};

// Below this share of seats with a known birth date, the coverage note is
// promoted from a quiet aside to a warning. Coverage is complete from the
// 41st Congress (1869) on; the shortfall is almost entirely pre-1830.
export const COVERAGE_WARN = 0.97;

// ============================================================
//  DEFAULTS
// ============================================================

// Which Congresses are selected on load. 'last' = the most recent one.
export const DEFAULT_SELECTION = 'last';

// 'all'  — compare against every Congress, 1789 to now
// 'prior'— compare against the BASELINE_WINDOW Congresses before the selection
export const DEFAULT_BASELINE = 'all';
export const BASELINE_WINDOW  = 20;

// ============================================================
//  COLOR
//  Six families, checked for colorblind separation of adjacent pairs.
//  Order here is the legend order and the within-column stacking order.
// ============================================================

export const PARTY_COLORS = [
  { id: 'Federalist',            label: 'Federalist',            color: '#6a51a3' },
  { id: 'Democratic-Republican', label: 'Democratic-Republican', color: '#41ab5d' },
  { id: 'Whig',                  label: 'Whig',                  color: '#a63603' },
  { id: 'Democratic',            label: 'Democratic',            color: '#3182bd' },
  { id: 'Republican',            label: 'Republican',            color: '#cb181d' },
  { id: 'Other',                 label: 'Other / Independent',   color: '#009e9e' },
];

// The expectation layer. Deliberately quiet — it is a reference, not a reading.
export const SILHOUETTE_FILL   = '#d9d7d2';
export const SILHOUETTE_STROKE = '#c2bfb8';

// Ring drawn on the hovered senator's dot.
export const HOVER_COLOR = '#1a1a1a';

// The timeline strip's median-age trace.
export const TREND_COLOR = '#7a7772';

// ============================================================
//  LAYOUT
// ============================================================

export const DOT_GAP  = 1.5; // surface gap between neighbouring dots, px
export const DOT_MIN  = 2;   // dots never render smaller than this diameter
export const DOT_MAX  = 20;  // ...nor larger
export const TIMELINE_HEIGHT = 92;
