#!/usr/bin/env python3
"""
Build Senate-age tables for distribution charts.

The question this answers: for every Congress, how old was each sitting senator
on the day that Congress convened? Not just the incoming class — the whole
chamber, so a senator serving thirty years contributes fifteen observations at
fifteen different ages.

Outputs:
  senate_ages.csv        - one row per senator x Congress (the dots)
  senate_congresses.csv  - one row per Congress: date, seats, age summary, coverage
  senate_age_totals.csv  - integer age x count, all Congresses collapsed (the envelope)
  senate_missing.csv     - senator-Congress rows dropped for want of a birthday

Source: unitedstates/congress-legislators, public domain.
Stdlib only. First run downloads ~15 MB into data/ and caches it; pass
--refresh to re-download.
"""

import csv
import json
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path
from statistics import median

AS_OF = date(2026, 8, 11)  # caps the last Congress considered

BASE = "https://unitedstates.github.io/congress-legislators"
SOURCES = ["legislators-current.json", "legislators-historical.json"]
DATA_DIR = Path(__file__).parent / "data"
OUT_DIR = Path(__file__).parent

# ---------------------------------------------------------------------------
#  PARTY FOLDING
#
#  Five families plus Other. The early-republic folds are the conventional
#  ones — Pro-Administration into Federalist, Anti-Administration into
#  Democratic-Republican, the Jackson/Adams factions into their successor
#  parties. They are a historiographical convenience, not a fact about how
#  these men described themselves; edit freely.
#
#  Independents fold into Other by choice: there are only a few dozen across
#  all of history and they never form a shape worth its own hue.
# ---------------------------------------------------------------------------

PARTY_MAP = {
    "Federalist": "Federalist",
    "Pro-Administration": "Federalist",

    "Democratic Republican": "Democratic-Republican",
    "Democratic-Republican": "Democratic-Republican",
    "Anti-Administration": "Democratic-Republican",
    "Crawford Republican": "Democratic-Republican",

    "Whig": "Whig",
    "Anti-Jacksonian": "Whig",
    "Adams": "Whig",

    "Democrat": "Democratic",
    "Democratic": "Democratic",
    "Jackson": "Democratic",
    "Jacksonian": "Democratic",

    "Republican": "Republican",
}
OTHER = "Other"

# "Republican" names two unrelated parties in this source. It is the bare label
# for Jefferson's Democratic-Republicans through the 19th Congress (1825), then
# does not appear at all until the modern party arrives in the 34th (1855). The
# fourteen-Congress gap makes the cutoff a fact about the data rather than a
# judgment call — without it, Andrew Jackson comes out coloured as a modern
# Republican.
JEFFERSONIAN_REPUBLICAN_THROUGH = 19


def fold_party(raw, congress):
    if raw == "Republican" and congress <= JEFFERSONIAN_REPUBLICAN_THROUGH:
        return "Democratic-Republican"
    return PARTY_MAP.get(raw, OTHER)

# ---------------------------------------------------------------------------


def fetch(refresh=False):
    """Download the legislator files once, then read from data/."""
    DATA_DIR.mkdir(exist_ok=True)
    people = []
    for name in SOURCES:
        path = DATA_DIR / name
        if refresh or not path.exists():
            print(f"  downloading {name} ...", flush=True)
            urllib.request.urlretrieve(f"{BASE}/{name}", path)
        with open(path, encoding="utf-8") as fh:
            people.extend(json.load(fh))
    return people


def iso(s):
    return date(*map(int, s.split("-")))


def senate_terms(people):
    """Flatten to (person, term) pairs for Senate service only."""
    out = []
    for p in people:
        for t in p.get("terms", []):
            if t.get("type") == "sen" and t.get("start") and t.get("end"):
                out.append((p, t))
    return out


def congress_opens(n):
    """The constitutional start of Congress n."""
    year = 1789 + 2 * (n - 1)
    return date(year, 3, 4) if n <= 73 else date(year, 1, 3)


def congress_span(n):
    """
    Bounds used only to bracket the search for a convening date.

    The end is taken from the *next* Congress's opening rather than from this
    one's nominal +2 years, because the 20th Amendment cut the 73rd short: it
    ran to January 1935, not March. Computing the two independently overlaps
    them, and the search then finds the 74th's incoming class inside the 73rd.
    """
    return congress_opens(n), congress_opens(n + 1) - timedelta(days=1)


def convening_dates(terms):
    """
    Find the day each Congress actually sat.

    Term *end* dates in this source are constitutional (March 3 / January 3),
    but term *start* dates before 1935 are the day the senator actually began
    serving, which is the day the Congress convened — and that could be
    October, as in 1807. So the snapshot date cannot be assumed; it is the
    modal start date among the terms opening inside each Congress's span,
    where a class turnover of thirty-odd senators always outvotes the ones
    and twos of mid-term appointments.
    """
    dates = {}
    n = 1
    while True:
        lo, hi = congress_span(n)
        if lo > AS_OF:
            break
        starts = Counter(iso(t["start"]) for _, t in terms if lo <= iso(t["start"]) <= hi)
        if starts:
            dates[n] = starts.most_common(1)[0][0]
        n += 1
    return dates


def roster(terms, when):
    """
    Every senator holding a seat on `when`.

    Half-open on purpose: an expiring term and its renewal share a boundary
    date, so `start <= when < end` seats the incoming term exactly once and
    drops the outgoing one.
    """
    seated = {}
    for p, t in terms:
        if iso(t["start"]) <= when < iso(t["end"]):
            # A person can only hold one seat; later start wins on the freak
            # overlaps present in the historical file.
            key = p["id"]["bioguide"]
            if key not in seated or iso(t["start"]) > iso(seated[key][1]["start"]):
                seated[key] = (p, t)
    return list(seated.values())


def full_name(p):
    n = p["name"]
    if n.get("official_full"):
        return n["official_full"]
    return " ".join(x for x in [n.get("first"), n.get("middle"), n.get("last")] if x)


def age_at(born, when):
    """Integer years, days past that birthday, and the decimal form."""
    years = when.year - born.year - ((when.month, when.day) < (born.month, born.day))
    try:
        last = born.replace(year=born.year + years)
    except ValueError:                       # born Feb 29
        last = born.replace(year=born.year + years, day=28)
    try:
        nxt = born.replace(year=born.year + years + 1)
    except ValueError:
        nxt = born.replace(year=born.year + years + 1, day=28)
    days = (when - last).days
    exact = years + days / (nxt - last).days
    return years, days, round(exact, 4)


def main(refresh=False):
    print("Reading congress-legislators ...")
    people = fetch(refresh)
    terms = senate_terms(people)
    print(f"  {len(people):,} legislators, {len(terms):,} Senate terms")

    dates = convening_dates(terms)
    print(f"  {len(dates)} Congresses, {dates[1]} through {dates[max(dates)]}")

    rows, missing, unmapped = [], [], Counter()

    for n in sorted(dates):
        when = dates[n]
        for p, t in roster(terms, when):
            raw = t.get("party") or ""
            party = fold_party(raw, n)
            if raw and raw not in PARTY_MAP:
                unmapped[raw] += 1

            rec = {
                "congress": n,
                "convened": when.isoformat(),
                "bioguide": p["id"]["bioguide"],
                "name": full_name(p),
                "state": t.get("state", ""),
                "senate_class": t.get("class", ""),
                "party": party,
                "party_raw": raw,
            }

            born = p.get("bio", {}).get("birthday")
            if not born:
                missing.append(rec)
                continue

            years, days, exact = age_at(iso(born), when)
            rec.update({
                "birthday": born,
                "age_years": years,
                "age_days": days,
                "age_exact": exact,
            })
            rows.append(rec)

    # ── senate_ages.csv ──
    cols = ["congress", "convened", "bioguide", "name", "state", "senate_class",
            "party", "party_raw", "birthday", "age_years", "age_days", "age_exact"]
    write(OUT_DIR / "senate_ages.csv", cols, rows)

    # ── senate_congresses.csv ──
    by_congress = defaultdict(list)
    for r in rows:
        by_congress[r["congress"]].append(r["age_years"])
    dropped = Counter(r["congress"] for r in missing)

    summary = []
    for n in sorted(dates):
        ages = by_congress.get(n, [])
        seats = len(ages) + dropped.get(n, 0)
        summary.append({
            "congress": n,
            "convened": dates[n].isoformat(),
            "year": dates[n].year,
            "seats": seats,
            "seats_with_age": len(ages),
            "missing_birthday": dropped.get(n, 0),
            "median_age": f"{median(ages):.1f}" if ages else "",
            "mean_age": round(sum(ages) / len(ages), 1) if ages else "",
            "min_age": min(ages) if ages else "",
            "max_age": max(ages) if ages else "",
        })
    write(OUT_DIR / "senate_congresses.csv", list(summary[0]), summary)

    # ── senate_age_totals.csv — the desaturated envelope ──
    tally = Counter(r["age_years"] for r in rows)
    totals = [{"age_years": a, "count": tally[a],
               "share": round(tally[a] / len(rows), 5)}
              for a in range(min(tally), max(tally) + 1)]
    write(OUT_DIR / "senate_age_totals.csv", ["age_years", "count", "share"], totals)

    # ── senate_missing.csv ──
    write(OUT_DIR / "senate_missing.csv",
          ["congress", "convened", "bioguide", "name", "state",
           "senate_class", "party", "party_raw"], missing)

    report(rows, missing, summary, unmapped, tally)


def write(path, cols, rows):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"  wrote {path.name:26s} {len(rows):6,d} rows")


def report(rows, missing, summary, unmapped, tally):
    print("\n" + "=" * 68)
    total = len(rows) + len(missing)
    print(f"{total:,} senator-Congress observations; "
          f"{len(missing):,} dropped for want of a birthday "
          f"({len(missing) / total:.1%})")

    print("\nBirthday coverage by era — this is what decides how far left the")
    print("chart can honestly reach:")
    eras = [(1, 20), (21, 40), (41, 60), (61, 80), (81, 100), (101, 119)]
    for lo, hi in eras:
        band = [s for s in summary if lo <= s["congress"] <= hi]
        if not band:
            continue
        seats = sum(s["seats"] for s in band)
        drop = sum(s["missing_birthday"] for s in band)
        y0, y1 = band[0]["year"], band[-1]["year"]
        bar = "#" * round(40 * (1 - drop / seats)) if seats else ""
        print(f"  Congress {lo:3d}-{hi:3d}  {y0}-{y1}  "
              f"{seats - drop:5,d}/{seats:5,d} = {1 - drop / seats:6.1%}  {bar}")

    worst = sorted(summary, key=lambda s: -s["missing_birthday"])[:5]
    if worst[0]["missing_birthday"]:
        print("\nWorst single Congresses:")
        for s in worst:
            if s["missing_birthday"]:
                print(f"  {s['congress']:3d}th ({s['year']}): "
                      f"{s['missing_birthday']} of {s['seats']} missing")

    print(f"\nAge range {min(tally)}-{max(tally)}; "
          f"mode {max(tally, key=tally.get)} ({max(tally.values()):,} observations)")
    print(f"Tallest column is {max(tally.values()):,} dots — draw the "
          f"all-time layer as a silhouette, not as ink.")

    if unmapped:
        print("\nParty values that fell through to Other "
              "(edit PARTY_MAP if any deserve a slot):")
        for k, v in unmapped.most_common():
            print(f"  {v:5d}  {k}")


if __name__ == "__main__":
    main(refresh="--refresh" in sys.argv)
