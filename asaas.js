const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, access_token',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const path = event.path.replace('/.netlify/functions/asaas', '').replace('/api/asaas', '');
  const apiKey = event.headers['access_token'];
  const env = event.headers['asaas_env'] || 'sandbox';

  if (!apiKey) return { statusCode: 401, headers, body: JSON.stringify({ error: 'access_token ausente' }) };

  const hostname = env === 'production' ? 'api.asaas.com' : 'sandbox.asaas.com';
  const qs = event.queryStringParameters
    ? '?' + new URLSearchParams(event.queryStringParameters).toString()
    : '';

  return new Promise((resolve) => {
    const opts = {
      hostname, port: 443,
      path: `/api/v3${path}${qs}`,
      method: event.httpMethod,
      headers: { 'access_token': apiKey, 'Content-Type': 'application/json' }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers,
        body: data
      }));
    });
    req.on('error', e => resolve({
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message })
    }));
    if (event.body) req.write(event.body);
    req.end();
  });
};