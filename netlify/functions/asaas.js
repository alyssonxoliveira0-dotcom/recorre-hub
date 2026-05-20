const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-asaas-token, x-asaas-env, x-asaas-path',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // ── Extração de parâmetros internos ─────────────────────────────────────────
  // Prioridade 1: HTTP headers (mais confiável, sem problemas de encoding)
  const hdrs = event.headers || {};
  let apiKey   = hdrs['x-asaas-token'] || hdrs['X-Asaas-Token'] || '';
  let env      = hdrs['x-asaas-env']   || hdrs['X-Asaas-Env']   || '';
  let asaasPath = hdrs['x-asaas-path'] || hdrs['X-Asaas-Path']  || '';

  // Prioridade 2: rawQuery (string crua da URL)
  if (!apiKey) {
    const raw = event.rawQuery
      || (event.rawUrl ? (event.rawUrl.split('?')[1] || '') : '')
      || '';
    if (raw) {
      const p = new URLSearchParams(raw);
      apiKey    = p.get('_token') || '';
      env       = p.get('_env')   || '';
      asaasPath = p.get('_path')  || '';
    }
  }

  // Prioridade 3: queryStringParameters (fallback)
  if (!apiKey) {
    const qsp = event.queryStringParameters || {};
    apiKey    = qsp._token || '';
    env       = qsp._env   || '';
    asaasPath = qsp._path  || '';
  }

  env       = env       || 'sandbox';
  asaasPath = asaasPath || '/';

  // ── Query string a passar para o Asaas (sem os params internos) ─────────────
  let extraQs = '';
  const raw = event.rawQuery
    || (event.rawUrl ? (event.rawUrl.split('?')[1] || '') : '')
    || '';
  if (raw) {
    const p = new URLSearchParams(raw);
    p.delete('_token'); p.delete('_env'); p.delete('_path');
    extraQs = p.toString();
  } else {
    const qsp = event.queryStringParameters || {};
    const rest = Object.fromEntries(
      Object.entries(qsp).filter(([k]) => !['_token','_env','_path'].includes(k))
    );
    extraQs = new URLSearchParams(rest).toString();
  }

  const host = env === 'production' ? 'api.asaas.com' : 'sandbox.asaas.com';
  const targetPath = '/api/v3' + asaasPath + (extraQs ? '?' + extraQs : '');

  console.log('[asaas] path:', asaasPath, '| host:', host, '| apiKey.len:', apiKey.length);
  console.log('[asaas] target:', targetPath);

  let bodyStr = '';
  if (event.body) {
    bodyStr = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
  }

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
        statusCode: 500,
        headers,
        body: JSON.stringify({ errors: [{ code: 'proxy_error', description: e.message }] })
      });
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
};
