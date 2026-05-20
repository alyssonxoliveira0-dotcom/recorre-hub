const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, access_token, asaas_env',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const apiKey = event.headers['access_token'] || '';
  const env    = event.headers['asaas_env']    || 'sandbox';

  const funcBase  = '/.netlify/functions/asaas';
  const asaasPath = event.path.startsWith(funcBase)
    ? event.path.slice(funcBase.length) || '/'
    : '/';

  const qsParams = event.queryStringParameters || {};
  const qsStr    = Object.keys(qsParams).length
    ? '?' + new URLSearchParams(qsParams).toString()
    : '';

  const host       = env === 'production' ? 'api.asaas.com' : 'sandbox.asaas.com';
  const targetPath = '/api/v3' + asaasPath + qsStr;

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
        res.on('data', c => data += c);
        res.on('end', () => {
          console.log('[asaas] status:', res.statusCode);
          resolve({ statusCode: res.statusCode, headers, body: data || '{}' });
        });
      }
    );
    req.on('error', (e) => {
      console.error('[asaas] erro:', e.message);
      resolve({ statusCode: 500, headers, body: JSON.stringify({ errors: [{ description: e.message }] }) });
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
};