const https = require('node:https');
const http = require('node:http');

const DEFAULT_TIMEOUT_MS = 5000;

function getSystemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function defaultSort(a, b) {
  return a.start.getTime() - b.start.getTime();
}

function cloneAndSort(events, sort = defaultSort) {
  return [...events].sort(sort);
}

function unfoldLines(input) {
  return String(input)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .reduce((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] += line.slice(1);
      } else {
        lines.push(line);
      }
      return lines;
    }, []);
}

function splitProperty(line) {
  const separator = line.indexOf(':');
  if (separator === -1) {
    return null;
  }

  const left = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const [name, ...paramParts] = left.split(';');
  const params = {};

  for (const part of paramParts) {
    const equals = part.indexOf('=');
    if (equals === -1) {
      params[part.toUpperCase()] = true;
    } else {
      const key = part.slice(0, equals).toUpperCase();
      const rawValue = part.slice(equals + 1);
      params[key] = rawValue.replace(/^"|"$/g, '');
    }
  }

  return {
    name: name.toUpperCase(),
    params,
    value: decodeText(value),
  };
}

function decodeText(value) {
  return String(value)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function collectEventBlocks(ics) {
  const lines = unfoldLines(ics);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = [];
      continue;
    }

    if (line === 'END:VEVENT') {
      if (current) {
        blocks.push(current);
      }
      current = null;
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  return blocks;
}

function parseEventBlock(lines, defaultTimezone) {
  const raw = {};

  for (const line of lines) {
    const property = splitProperty(line);
    if (!property) {
      continue;
    }

    if (!raw[property.name]) {
      raw[property.name] = property;
    } else if (Array.isArray(raw[property.name])) {
      raw[property.name].push(property);
    } else {
      raw[property.name] = [raw[property.name], property];
    }
  }

  const startProperty = firstProperty(raw.DTSTART);
  if (!startProperty) {
    return null;
  }

  const endProperty = firstProperty(raw.DTEND);
  const durationProperty = firstProperty(raw.DURATION);
  const parsedStart = parseIcalDate(startProperty, defaultTimezone);
  let parsedEnd = endProperty ? parseIcalDate(endProperty, defaultTimezone) : null;

  if (!parsedEnd && durationProperty) {
    parsedEnd = {
      date: addDuration(parsedStart.date, durationProperty.value),
      allDay: parsedStart.allDay,
      timezone: parsedStart.timezone,
    };
  }

  if (!parsedEnd) {
    parsedEnd = {
      date: parsedStart.allDay
        ? new Date(parsedStart.date.getTime() + 24 * 60 * 60 * 1000)
        : new Date(parsedStart.date.getTime()),
      allDay: parsedStart.allDay,
      timezone: parsedStart.timezone,
    };
  }

  return {
    uid: valueOf(raw.UID) || null,
    summary: valueOf(raw.SUMMARY) || '',
    description: valueOf(raw.DESCRIPTION) || '',
    location: valueOf(raw.LOCATION) || '',
    start: parsedStart.date,
    end: parsedEnd.date,
    allDay: parsedStart.allDay,
    timezone: parsedStart.timezone,
    raw,
  };
}

function firstProperty(property) {
  return Array.isArray(property) ? property[0] : property;
}

function valueOf(property) {
  const first = firstProperty(property);
  return first ? first.value : undefined;
}

function parseIcalDate(property, defaultTimezone) {
  const value = property.value;
  const valueType = property.params.VALUE;
  const timeZone = property.params.TZID || defaultTimezone;

  if (valueType === 'DATE' || /^\d{8}$/.test(value)) {
    const parts = matchDate(value);
    return {
      date: zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone),
      allDay: true,
      timezone: timeZone,
    };
  }

  const parts = matchDateTime(value);
  const isUtc = value.endsWith('Z');
  const date = isUtc
    ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second))
    : zonedTimeToUtc(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, timeZone);

  return {
    date,
    allDay: false,
    timezone: isUtc ? 'UTC' : timeZone,
  };
}

function matchDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid iCal DATE value: ${value}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function matchDateTime(value) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid iCal DATE-TIME value: ${value}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };
}

function addDuration(date, duration) {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration);
  if (!match) {
    throw new Error(`Unsupported iCal DURATION value: ${duration}`);
  }

  const weeks = Number(match[1] || 0);
  const days = Number(match[2] || 0);
  const hours = Number(match[3] || 0);
  const minutes = Number(match[4] || 0);
  const seconds = Number(match[5] || 0);
  const milliseconds = (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 * 1000 + seconds * 1000;

  return new Date(date.getTime() + milliseconds);
}

function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  let timestamp = Date.UTC(year, month - 1, day, hour, minute, second);

  for (let i = 0; i < 3; i += 1) {
    const offset = getTimeZoneOffsetMs(new Date(timestamp), timeZone);
    const nextTimestamp = Date.UTC(year, month - 1, day, hour, minute, second) - offset;
    if (nextTimestamp === timestamp) {
      break;
    }
    timestamp = nextTimestamp;
  }

  return new Date(timestamp);
}

function getTimeZoneOffsetMs(date, timeZone) {
  if (timeZone === 'UTC') {
    return 0;
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return asUtc - date.getTime();
}

function parseTimestamp(input, mode, timeZone) {
  if (input instanceof Date) {
    return new Date(input.getTime());
  }

  if (typeof input === 'number') {
    return new Date(input);
  }

  if (typeof input !== 'string') {
    throw new TypeError('Timestamp must be a Date, number, or string');
  }

  if (mode === 'utc') {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid UTC timestamp: ${input}`);
    }
    return date;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(input);
  if (!match) {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid local timestamp: ${input}`);
    }
    return date;
  }

  return zonedTimeToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0),
    timeZone
  );
}

function getLocalDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
  };
}

function getLocalDayRange(date, timeZone) {
  const parts = getLocalDateParts(date, timeZone);
  const start = zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
  const nextDayUtcGuess = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0);
  const nextParts = getLocalDateParts(new Date(nextDayUtcGuess), 'UTC');
  const end = zonedTimeToUtc(nextParts.year, nextParts.month, nextParts.day, 0, 0, 0, timeZone);

  return { start, end };
}

function eventOverlapsRange(event, start, end) {
  return event.start.getTime() < end.getTime() && event.end.getTime() > start.getTime();
}

function parseIcal(ics, options = {}) {
  const timezone = options.timezone || getSystemTimeZone();
  const events = collectEventBlocks(ics)
    .map((block) => parseEventBlock(block, timezone))
    .filter(Boolean);

  return cloneAndSort(events, options.sort || defaultSort);
}

function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const headers = options.headers || {};
  const transport = String(url).startsWith('https:') ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.get(url, { headers }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Failed to fetch ${url}: HTTP ${response.statusCode}`));
        return;
      }

      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
    });

    request.on('error', (error) => {
      reject(new Error(`Failed to fetch ${url}: ${error.message}`));
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Timed out fetching ${url} after ${timeoutMs}ms`));
    });
  });
}

class IcalClient {
  constructor(options = {}) {
    this.timezone = options.timezone || getSystemTimeZone();
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.headers = options.headers || {};
    this.fetcher = options.fetcher || fetchText;
  }

  async fetchCalendar(url, options = {}) {
    return this.fetcher(url, {
      headers: { ...this.headers, ...(options.headers || {}) },
      timeoutMs: options.timeoutMs || this.timeoutMs,
    });
  }

  parse(ics, options = {}) {
    return parseIcal(ics, {
      timezone: options.timezone || this.timezone,
      sort: options.sort,
    });
  }

  async fetchEvents(url, options = {}) {
    const ics = await this.fetchCalendar(url, options);
    return this.parse(ics, options);
  }

  async getEventsBetween(url, options = {}) {
    const timezone = options.timezone || this.timezone;
    const inputTimezone = options.inputTimezone || 'local';
    const start = parseTimestamp(options.start, inputTimezone, timezone);
    const end = parseTimestamp(options.end, inputTimezone, timezone);

    if (end.getTime() <= start.getTime()) {
      throw new Error('Range end must be after range start');
    }

    const events = await this.fetchEvents(url, options);
    return cloneAndSort(
      events.filter((event) => eventOverlapsRange(event, start, end)),
      options.sort || defaultSort
    );
  }

  async getTodaysEvents(url, options = {}) {
    const timezone = options.timezone || this.timezone;
    const now = options.now ? parseTimestamp(options.now, 'utc', timezone) : new Date();
    const range = getLocalDayRange(now, timezone);

    return this.getEventsBetween(url, {
      ...options,
      timezone,
      inputTimezone: 'utc',
      start: range.start,
      end: range.end,
    });
  }
}

module.exports = {
  IcalClient,
  defaultSort,
  eventOverlapsRange,
  fetchText,
  getSystemTimeZone,
  parseIcal,
};
