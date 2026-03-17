const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const MEASUREMENT_ID = 'G-49XNFC5HBF';
const API_SECRET = 'sjZsjwbTTaiVBSHxmLDnfA';
const CLIENT_ID_FILE = path.join(app.getPath('userData'), 'client-id');

let clientId = null;

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
 * Sends an event to GA4 via the Measurement Protocol.
 * @param {string} name Event name
 * @param {object} params Event parameters
 */
function trackEvent(name, params = {}) {
  const payload = {
    client_id: getClientId(),
    events: [
      {
        name: name,
        params: {
          ...params,
          engagement_time_msec: '100', // GA4 sometimes requires this for session attribution
          session_id: Date.now().toString(), // Simple session ID
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
        'Content-Length': data.length,
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
