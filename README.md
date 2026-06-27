# ical-event-utils

Retrieve `.ics` / iCal feeds and translate `VEVENT` entries into timezone-aware native JavaScript event objects.

This package is dependency-free, CommonJS-compatible, and licensed under MIT.

## Install

```sh
npm install ical-event-utils
```

The package is published as `ical-event-utils`.

## Quick Start

```js
const { IcalClient } = require('ical-event-utils');

const client = new IcalClient({
  timezone: 'Europe/London',
});

const events = await client.fetchEvents('https://example.com/calendar.ics');

for (const event of events) {
  console.log(event.start, event.summary);
}
```

Events are sorted by start datetime before they are returned.

## Event Shape

Each returned event is a plain JavaScript object:

```js
{
  uid: 'event-id@example.com',
  summary: 'Team Holiday',
  description: 'Optional description',
  location: 'Optional location',
  start: Date,
  end: Date,
  allDay: false,
  timezone: 'Europe/London',
  raw: {}
}
```

`start` and `end` are JavaScript `Date` objects representing UTC instants internally. For all-day events, iCal `DTEND` is treated as exclusive, matching the iCal specification.

## Timezones

The library uses UTC internally and converts local iCal values through an IANA timezone.

```js
const client = new IcalClient({
  timezone: 'Europe/London',
});
```

If no timezone is supplied, the system timezone is inferred:

```js
const { getSystemTimeZone } = require('ical-event-utils');

console.log(getSystemTimeZone());
```

UTC timestamps such as `DTSTART:20260627T190000Z` are kept as UTC. Timezone-specific timestamps such as `DTSTART;TZID=Europe/London:20260627T090000` use their own `TZID`. Floating timestamps without `Z` or `TZID` use the client timezone.

## Parse Existing iCal Text

```js
const { parseIcal } = require('ical-event-utils');

const events = parseIcal(icsText, {
  timezone: 'Europe/London',
});
```

## Custom Sorting

By default, events are ordered by `event.start`. You can provide a custom sort function anywhere events are returned.

```js
const events = await client.fetchEvents(url, {
  sort: (a, b) => a.summary.localeCompare(b.summary),
});
```

## Events Between Timestamps

Use local timestamps with the configured timezone:

```js
const events = await client.getEventsBetween(url, {
  start: '2026-06-27T08:30:00',
  end: '2026-06-27T17:30:00',
  inputTimezone: 'local',
});
```

Or pass UTC timestamps:

```js
const events = await client.getEventsBetween(url, {
  start: '2026-06-27T07:30:00Z',
  end: '2026-06-27T16:30:00Z',
  inputTimezone: 'utc',
});
```

An event is returned when it overlaps the requested range.

## Today's Events

```js
const todaysEvents = await client.getTodaysEvents(url);
```

`getTodaysEvents` uses the configured or inferred timezone to find the current local calendar day.

For tests or scheduled jobs, pass a fixed `now`:

```js
const todaysEvents = await client.getTodaysEvents(url, {
  now: '2026-06-27T05:00:00Z',
});
```

## Custom Retrieval

`IcalClient` retrieves feeds over HTTP or HTTPS by default. For tests, cached calendars, or authenticated clients, inject a custom fetcher:

```js
const client = new IcalClient({
  timezone: 'Europe/London',
  fetcher: async (url, options) => {
    return loadCalendarFromSomewhere(url, options.headers);
  },
});
```

Request headers can be supplied globally or per request:

```js
const client = new IcalClient({
  headers: { Authorization: 'Bearer token' },
});

const events = await client.fetchEvents(url, {
  headers: { 'X-Request-ID': 'abc123' },
});
```

## API

### `new IcalClient(options)`

Options:

- `timezone`: IANA timezone name. Defaults to the system timezone.
- `headers`: default request headers.
- `timeoutMs`: request timeout. Defaults to `5000`.
- `fetcher`: optional async function used instead of the built-in HTTP/HTTPS retrieval.

### `client.fetchCalendar(url, options)`

Retrieves raw iCal text.

### `client.fetchEvents(url, options)`

Retrieves and parses the feed into sorted event objects.

### `client.getEventsBetween(url, options)`

Retrieves events that overlap a timestamp range.

Required options:

- `start`: range start as `Date`, epoch milliseconds, or timestamp string.
- `end`: range end as `Date`, epoch milliseconds, or timestamp string.

Optional options:

- `inputTimezone`: `'local'` or `'utc'`. Defaults to `'local'`.
- `timezone`: override the client timezone.
- `sort`: custom sort function.
- `headers`: request headers.
- `timeoutMs`: request timeout.

### `client.getTodaysEvents(url, options)`

Retrieves events for the current local day in the configured timezone.

Optional options:

- `now`: fixed current time for tests or scheduled runs.
- `timezone`: override the client timezone.
- `sort`: custom sort function.
- `headers`: request headers.
- `timeoutMs`: request timeout.

### `parseIcal(icsText, options)`

Parses raw iCal text without retrieving it from a URL.

### `getSystemTimeZone()`

Returns the system IANA timezone, falling back to `UTC`.

## Publish

From this directory:

```sh
npm test
npm pack --dry-run
npm publish --access public
```

For a new Git repository:

```sh
git init
git add .
git commit -m "Initial release"
```

## Current Scope

The parser covers the event fields used by this project: `UID`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `DTSTART`, `DTEND`, and `DURATION`. It supports folded lines, all-day dates, UTC datetimes, timezone-tagged datetimes, and floating local datetimes.
