const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const apiKey = params._token || '';
  const env    = params._env  || 'sandbox';
  const asaasPath = params._path || '/';

  // Remove proxy params, forward the rest to Asaas
  const qs = new URLSearchParams(params);
  qs.delete('_token');
  qs.delete('_env');
  qs.delete('_path');
  const qsStr = qs.toString();

  const host       = env === 'production' ? 'api.asaas.com' : 'sandbox.asaas.com';
  const targetPath = '/api/v3' + asaasPath + (qsStr ? '?' + qsStr : '');

  let bodyStr = '';
  if (event.body) {
    bodyStr = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
  }

  console.log('[asaas] path:', asaasPath, '| target:', targetPath);
  console.log('[asaas] apiKey length:', apiKey.length);

  return new Promise((resolve) => {
    const reqHeaders = {
      'Content-Type': 'application/json',
      'access_token': apiKey,
      'User-Agent': 'RecorreHub/1.0'
    };
    if (bodyStr) reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(
      { hostname: host, port: 443, path: targetPath, method: event.httpMethod, headers: reqHeaders },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('[asaas] status:', res.statusCode);
          resolve({ statusCode: res.statusCode, headers, body: data || '{}' });
        });
      }
    );

    req.on('error', (e) => {
      console.error('[asaas] erro:', e.message);
      resolve({
        statusCode: 500, headers,
        body: JSON.stringify({ errors: [{ description: e.message }] })
      });
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
};