const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const MEASUREMENT_ID = 'G-49XNFC5HBF';
const API_SECRET = 'sjZsjwbTTaiVBSHxmLDnfA';
const CLIENT_ID_FILE = path.join(app.getPath('userData'), 'client-id');
const GEO_CACHE_FILE = path.join(app.getPath('userData'), 'geo-cache.json');

let clientId = null;
let geoCache = null; // { country, city, region, cachedAt }

/**
 * Gets or generates a unique client ID for this installation.
 */
function getClientId() {
  if (clientId) return clientId;

  try {
    if (fs.existsSync(CLIENT_ID_FILE)) {
      const data = fs.readFileSync(CLIENT_ID_FILE, 'utf8');
      clientId = data.trim();
    }
  } catch (err) {
    console.error('Failed to read client ID:', err);
  }

  if (!clientId) {
    clientId = crypto.randomUUID();
    try {
      fs.writeFileSync(CLIENT_ID_FILE, clientId, 'utf8');
    } catch (err) {
      console.error('Failed to save client ID:', err);
    }
  }

  return clientId;
}

/**
 * Maps process.platform to a human-readable OS name.
 */
function getOsName() {
  switch (process.platform) {
    case 'darwin':  return 'macOS';
    case 'win32':   return 'Windows';
    case 'linux':   return 'Linux';
    default:        return process.platform;
  }
}

/**
 * Fetches user geo data (country, city, region) via ipapi.co.
 * Results are cached for 24 hours in userData to avoid repeated lookups.
 * Returns a promise that resolves to { country, city, region } or {} on failure.
 */
function fetchGeoData() {
  return new Promise((resolve) => {
    // --- Return in-memory cache ---
    if (geoCache) {
      resolve(geoCache);
      return;
    }

    // --- Load from disk cache (valid for 24 h) ---
    try {
      if (fs.existsSync(GEO_CACHE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(GEO_CACHE_FILE, 'utf8'));
        const ageMs = Date.now() - (raw.cachedAt || 0);
        if (ageMs < 24 * 60 * 60 * 1000) {
          geoCache = raw;
          resolve(geoCache);
          return;
        }
      }
    } catch (_) {
      // ignore corrupt cache
    }

    // --- Fetch fresh geo data ---
    const req = https.get('https://ipapi.co/json/', { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const geo = {
            country: json.country_name || '',
            city:    json.city         || '',
            region:  json.region       || '',
            cachedAt: Date.now(),
          };
          geoCache = geo;
          fs.writeFileSync(GEO_CACHE_FILE, JSON.stringify(geo), 'utf8');
          resolve(geo);
        } catch (_) {
          resolve({});
        }
      });
    });

    req.on('error', () => resolve({}));
    req.on('timeout', () => { req.destroy(); resolve({}); });
  });
}

/**
 * Sends an event to GA4 via the Measurement Protocol.
 * Automatically enriches every event with geo, platform, OS and app version.
 * @param {string} name   Event name
 * @param {object} params Event parameters
 */
async function trackEvent(name, params = {}) {
  // Resolve geo (uses cache — fast after first call)
  const geo = await fetchGeoData();

  const payload = {
    client_id: getClientId(),
    events: [
      {
        name: name,
        params: {
          // ── caller-supplied params ────────────────────────────────────────
          ...params,

          // ── device / platform ────────────────────────────────────────────
          platform:    'desktop',
          os:          getOsName(),
          app_version: app.getVersion(),

          // ── geo (resolved from user IP via ipapi.co) ─────────────────────
          country: geo.country || '',
          city:    geo.city    || '',
          region:  geo.region  || '',

          // ── GA4 session helpers ───────────────────────────────────────────
          engagement_time_msec: '100',
          session_id:           Date.now().toString(),
        },
      },
    ],
  };

  const data = JSON.stringify(payload);
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;

  const req = https.request(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    },
    (res) => {
      if (res.statusCode >= 400) {
        console.error(`GA4 request failed with status: ${res.statusCode}`);
      }
    }
  );

  req.on('error', (err) => {
    console.error('GA4 request error:', err);
  });

  req.write(data);
  req.end();
}

module.exports = {
  trackEvent,
  getClientId,
};
