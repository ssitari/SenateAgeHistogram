# Senate ages by Congress

Age of every sitting senator on the day each Congress convened, 1789–2025.
Not the incoming class — the whole chamber, so a senator serving thirty years
contributes fifteen observations at fifteen different ages.

## The chart

`index.html` + `app.js` + `config.js`. ES modules and `fetch`, so serve it:

```bash
python3 -m http.server 8000
```

Two layers on **one shared count axis**, which is the whole idea:

- a **grey silhouette** — the number of seats you have selected, distributed
  the way some comparison population was. What the chamber would look like if
  it were ordinary.
- **dots** — one per senator actually sitting, coloured by party. What it
  looked like.

There is no second y axis and no normalisation trick. Both layers count
senators; the silhouette is simply the comparison population's shares
multiplied by however many seats are selected, so the two are directly
readable against each other.

**Every Congress is selected on load.** With the comparison also set to all of
them, the two layers are the same population and the dots cover the grey shape
exactly — which shows what the comparison means before you have touched
anything. Brushing then moves the dots off it.

**Drag the timeline** at the bottom to select a run of Congresses, or click it
for a single one. The strip plots median chamber age with **one marker per
Congress**, filled when selected and grey when not, so the selection is
countable rather than approximate; the readout names the range and the count. A
dashed rule marks the all-time median, the same number the chart uses as its
comparison when the baseline is set to every Congress.

Hovering any dot gives the senator's name, party, state and age. Below about
seven pixels a dot is too small to aim at, so hit targets are dropped and the
chart draws one plain circle per senator — otherwise the all-selected view
would be nearly 37,000 SVG nodes and would take seconds to paint.

**Compare with** switches the silhouette between all 119 Congresses and the 20
immediately preceding the selection. This matters more than it sounds: the
1831–1883 Senate reads as *young* against all of history (median 50 against
55) and as *old* against the twenty Congresses before it (50 against 46).
Which one is right depends on the question you are asking.

Within an age bin, dots are blocked by party, then ordered by exact age. When a
selection is large the bin packs **k dots per row** rather than letting the
column go thin — the age axis stays fixed so shapes remain comparable between
a single Congress and a whole era.

```bash
python3 build_senate_ages.py            # first run downloads ~15 MB into data/
python3 build_senate_ages.py --refresh  # re-download the source
```

Stdlib only. Source is [unitedstates/congress-legislators][cl], public domain.

[cl]: https://github.com/unitedstates/congress-legislators

## Outputs

| File | Rows | What it is |
|---|---|---|
| `senate_ages.csv` | 9,299 | One row per senator × Congress — the dots |
| `senate_congresses.csv` | 119 | Per Congress: convening date, seats, age summary, coverage |
| `senate_age_totals.csv` | 70 | Integer age × count, all Congresses collapsed — the envelope |
| `senate_missing.csv` | 0 | Observations dropped for want of a birthday — now empty |
| `birthdays_supplement.csv` | 51 | Hand-carried birth dates with a citation each (input, not output) |

Ages come three ways, as in the presidents tables: `age_years` (integer, for
binning), `age_days` (days past that birthday), `age_exact` (decimal).

## What the numbers say

Range is **29 to 98**, mode 57. Median age of the chamber has risen from **47
in 1789 to 64 in 2025**, and almost all of that move happened in two steps —
flat around 47–49 until the 1870s, a jump to 57 by 1891, then flat again at 57
for a century before the recent climb.

The tallest single column is **339 observations** at age 57. That settles the
layer question: the all-time distribution has to be drawn as a silhouette, not
as countable dots, or one Congress's ~100 dots will be a sliver on the floor.

## Decisions baked in

**The convening date is derived, not assumed.** Term *end* dates in the source
are constitutional (March 3 / January 3), but term *start* dates before 1935
are the day the senator actually began serving — which is the day the Congress
first sat, and that could be October, as it was in 1807. A hardcoded March 4
snapshot finds almost nobody in the early republic: outgoing terms ended March
3, incoming ones had not begun. So each Congress's date is the modal start date
among the terms opening inside its span, where a class turnover of thirty-odd
senators always outvotes the ones and twos of mid-term appointments.

The span itself is bracketed by the *next* Congress's opening rather than a
nominal two years, because the 20th Amendment cut the 73rd short — it ran to
January 1935, not March. Computing the two independently makes them overlap,
and the search then finds the 74th's incoming class sitting inside the 73rd.

**Membership is half-open**: `start <= convened < end`. An expiring term and
its renewal share a boundary date, so this seats the incoming term exactly once
and drops the outgoing one. Mid-term appointees appear in the *next* Congress,
not the one they joined partway through — which is the exclusion we wanted.
Seat counts reflect real vacancies: the 119th shows 99, because Florida's
second seat was not filled until January 21, 2025.

**Party is taken per term, not per person**, so a senator who switches is
recorded correctly in each Congress. Five families plus Other:

| Family | Folded in |
|---|---|
| Federalist | Pro-Administration |
| Democratic-Republican | Anti-Administration, Crawford Republican, **Republican through the 19th Congress** |
| Whig | Anti-Jacksonian, Adams |
| Democratic | Jackson |
| Republican | Republican, 34th Congress onward |
| Other | Independents and everything else |

**`"Republican"` names two unrelated parties in this source**, and getting it
wrong is not subtle — it puts Andrew Jackson in the modern Republican Party. It
is the bare label for Jefferson's Democratic-Republicans through the 19th
Congress (1825), then does not appear *at all* for fourteen Congresses, then
returns in the 34th (1855) as the party we know. That gap is what makes the
cutoff a fact about the data rather than a judgment call; `fold_party()` in the
build script applies it.

The early-republic folds are conventional but they are a historiographical
convenience, not a fact about how these men described themselves. Everything
that falls through to Other is printed with counts when the script runs; it
comes to 162 observations, under 2%. `PARTY_MAP` is at the top of the script.

## Birthday coverage

**100% in every era**, but only because of the supplement below. Out of the box,
`congress-legislators` has no birth date at all for 51 senators — 138
observations, almost entirely pre-1830, with the 5th Congress missing 9 of 35
seats. Coverage from the 41st Congress (1869) forward was already complete.

### The supplement

All 51 have a Wikidata date of birth, so `birthdays_supplement.csv` carries them
with a `wikidata_id`, a `source` URL and a `retrieved` date per row.
`build_senate_ages.py` uses it only as a fallback, never overriding
`congress-legislators`.

It is a checked-in file rather than a live query on purpose. Fetching at build
time would make the pipeline depend on a database that can change under it, and
would make old runs unreproducible.

Precision is the catch: **35 of the 51 are year-only**, 6 to the month, 10 to
the exact day. A date is derived from the stated precision — mid-year, mid-month
or as-given — so the age lands within a year of truth, and the precision travels
with the row as `age_precision`. **The chart draws those dots outlined rather
than filled**, with a note giving the count, so an approximate age is never
mistaken for a measured one. Selecting the 5th Congress reads *"8 of 35 seats
(23%) are dated from a birth year rather than a full date."*

### Was the gap biased?

Worth asking, because missingness correlating with age would bias the medians
rather than just thin them. Within a Congress, older senators were born earlier,
when records were worse, so the concern is real.

Measured against Wikidata, the previously-missing senators run **+0.95 years
older** than their chamber's median on average — but the split is **69 of 138
older, 69 younger**, an exact 50/50. The mean is dragged by a few much-older
outliers rather than by a systematic tilt, and a median does not care how far
out a tail value sits, only which side it falls on.

So the series held: across the 40 affected Congresses the median shifted by
**+0.03 years on average**. Individual Congresses moved more — the 4th and 6th
both up a full year, the 12th down 1.5 — which is why the fix was worth making
before anyone quotes a single early Congress.

## Known artifacts

**Rush Holt appears in the 74th Congress at 29**, below the constitutional
minimum. He was elected at 29 and waited until his thirtieth birthday in June
1935 to be sworn in, but the source records his term as starting January 3, so
the snapshot seats him. Fixing it would need oath dates, which this source does
not carry. John Henry Eaton's 29 in the 16th Congress is not an artifact — he
really was seated under age.

**The 1st Congress shows 24 seats.** North Carolina and Rhode Island had not
yet ratified, and the chamber lacked a quorum until April 1789; the early
roster is genuinely ragged rather than wrong.
