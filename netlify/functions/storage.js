const https = require('https');

const CF_ACCOUNT   = process.env.CF_ACCOUNT_ID;
const CF_NAMESPACE = process.env.CF_KV_NAMESPACE_ID;
const CF_TOKEN     = process.env.CF_KV_TOKEN;

function kvRequest(method, key, bodyStr) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('KV timeout')), 8000);
    const path = `/client/v4/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${CF_NAMESPACE}/values/${encodeURIComponent(key)}`;
    const opts = {
      hostname: 'api.cloudflare.com', port: 443, path, method,
      headers: { 'Authorization': `Bearer ${CF_TOKEN}` }
    };
    if (bodyStr !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

const TIPOS_VALIDOS = [
  'config', 'cache_dash', 'cache_cliente', 'tarefas',
  'hoteis', 'hist', 'usuarios', 'sync_meta'
];

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  if (!CF_ACCOUNT || !CF_NAMESPACE || !CF_TOKEN) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'storage_not_configured' }) };
  }

  const { _session: sessionToken, tipo } = event.queryStringParameters || {};

  if (!sessionToken || !TIPOS_VALIDOS.includes(tipo)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'params_invalidos' }) };
  }

  let empresaId;
  try {
    const sessionRes = await kvRequest('GET', 'crm_session:' + sessionToken);
    if (sessionRes.status !== 200) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'session_expired' }) };
    }
    const session = JSON.parse(sessionRes.body);
    if (!session || session.expiresAt < Date.now()) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'session_expired' }) };
    }
    empresaId = session.empresaId;
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'session_invalid' }) };
  }

  const kvKey = `crm_${empresaId}_${tipo}`;

  if (event.httpMethod === 'GET') {
    try {
      const res = await kvRequest('GET', kvKey);
      if (res.status === 404) return { statusCode: 200, headers, body: JSON.stringify(null) };
      if (res.status !== 200) return { statusCode: 500, headers, body: JSON.stringify({ error: 'get_failed' }) };
      return { statusCode: 200, headers, body: res.body };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'get_failed' }) };
    }
  }

  if (event.httpMethod === 'POST') {
    try {
      const res = await kvRequest('PUT', kvKey, event.body || 'null');
      if (res.status < 200 || res.status > 299) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'set_failed' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'set_failed' }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };
};