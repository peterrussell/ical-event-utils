const assert = require('node:assert/strict');
const test = require('node:test');

const { IcalClient, parseIcal } = require('..');

const MOCK_ICAL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ical-event-utils tests//EN
BEGIN:VEVENT
UID:utc-game@example.com
SUMMARY:Evening Game
DESCRIPTION:Shown in UTC
LOCATION:Stadium
DTSTART:20260627T190000Z
DTEND:20260627T210000Z
END:VEVENT
BEGIN:VEVENT
UID:all-day@example.com
SUMMARY:Company Holiday
DTSTART;VALUE=DATE:20260627
DTEND;VALUE=DATE:20260628
END:VEVENT
BEGIN:VEVENT
UID:london-morning@example.com
SUMMARY:London Morning
DTSTART;TZID=Europe/London:20260627T090000
DTEND;TZID=Europe/London:20260627T100000
END:VEVENT
BEGIN:VEVENT
UID:floating-noon@example.com
SUMMARY:Floating Noon
DTSTART:20260627T120000
DTEND:20260627T130000
END:VEVENT
END:VCALENDAR`;

test('parseIcal translates iCal events into native JavaScript objects sorted by start time', () => {
  const events = parseIcal(MOCK_ICAL, { timezone: 'Europe/London' });

  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map((event) => event.uid),
    [
      'all-day@example.com',
      'london-morning@example.com',
      'floating-noon@example.com',
      'utc-game@example.com',
    ]
  );

  assert.equal(events[0].summary, 'Company Holiday');
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].start.toISOString(), '2026-06-26T23:00:00.000Z');
  assert.equal(events[0].end.toISOString(), '2026-06-27T23:00:00.000Z');

  assert.equal(events[1].summary, 'London Morning');
  assert.equal(events[1].start.toISOString(), '2026-06-27T08:00:00.000Z');
  assert.equal(events[1].end.toISOString(), '2026-06-27T09:00:00.000Z');

  assert.equal(events[2].summary, 'Floating Noon');
  assert.equal(events[2].start.toISOString(), '2026-06-27T11:00:00.000Z');

  assert.equal(events[3].location, 'Stadium');
  assert.equal(events[3].description, 'Shown in UTC');
  assert.equal(events[3].start.toISOString(), '2026-06-27T19:00:00.000Z');
});

test('parseIcal accepts custom sort functions', () => {
  const events = parseIcal(MOCK_ICAL, {
    timezone: 'Europe/London',
    sort: (a, b) => a.summary.localeCompare(b.summary),
  });

  assert.deepEqual(
    events.map((event) => event.summary),
    ['Company Holiday', 'Evening Game', 'Floating Noon', 'London Morning']
  );
});

test('IcalClient fetchEvents retrieves calendars through an injectable fetcher', async () => {
  const seen = [];
  const client = new IcalClient({
    timezone: 'Europe/London',
    fetcher: async (url, options) => {
      seen.push({ url, options });
      return MOCK_ICAL;
    },
  });

  const events = await client.fetchEvents('https://example.com/calendar.ics', {
    headers: { Authorization: 'Bearer test' },
  });

  assert.equal(events.length, 4);
  assert.equal(seen[0].url, 'https://example.com/calendar.ics');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer test');
});

test('getEventsBetween filters using local timestamps in the configured timezone', async () => {
  const client = new IcalClient({
    timezone: 'Europe/London',
    fetcher: async () => MOCK_ICAL,
  });

  const events = await client.getEventsBetween('https://example.com/calendar.ics', {
    start: '2026-06-27T08:30:00',
    end: '2026-06-27T10:30:00',
    inputTimezone: 'local',
  });

  assert.deepEqual(
    events.map((event) => event.uid),
    ['all-day@example.com', 'london-morning@example.com']
  );
});

test('getEventsBetween filters using UTC timestamps', async () => {
  const client = new IcalClient({
    timezone: 'Europe/London',
    fetcher: async () => MOCK_ICAL,
  });

  const events = await client.getEventsBetween('https://example.com/calendar.ics', {
    start: '2026-06-27T18:30:00Z',
    end: '2026-06-27T20:00:00Z',
    inputTimezone: 'utc',
  });

  assert.deepEqual(
    events.map((event) => event.uid),
    ['all-day@example.com', 'utc-game@example.com']
  );
});

test('getTodaysEvents returns events for the local calendar day', async () => {
  const client = new IcalClient({
    timezone: 'Europe/London',
    fetcher: async () => MOCK_ICAL,
  });

  const events = await client.getTodaysEvents('https://example.com/calendar.ics', {
    now: '2026-06-27T05:00:00.000Z',
  });

  assert.deepEqual(
    events.map((event) => event.uid),
    [
      'all-day@example.com',
      'london-morning@example.com',
      'floating-noon@example.com',
      'utc-game@example.com',
    ]
  );
});

test('all-day DTEND is treated as exclusive', async () => {
  const client = new IcalClient({
    timezone: 'Europe/London',
    fetcher: async () => MOCK_ICAL,
  });

  const events = await client.getEventsBetween('https://example.com/calendar.ics', {
    start: '2026-06-28T00:00:00',
    end: '2026-06-29T00:00:00',
    inputTimezone: 'local',
  });

  assert.deepEqual(events, []);
});
