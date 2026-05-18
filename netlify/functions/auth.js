const https = require('https');
const crypto = require('crypto');

const CF_ACCOUNT   = process.env.CF_ACCOUNT_ID;
const CF_NAMESPACE = process.env.CF_KV_NAMESPACE_ID;
const CF_TOKEN     = process.env.CF_KV_TOKEN;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const APP_URL      = process.env.APP_URL || 'https://recorre-hub.netlify.app';
const INVITE_CODE  = process.env.INVITE_CODE;
const ADMIN_KEY    = process.env.ADMIN_KEY;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const PERFIS = ['admin', 'operacional', 'visualizacao'];

function ok(data)        { return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) }; }
function fail(code, msg) { return { statusCode: code, headers: HEADERS, body: JSON.stringify({ error: msg }) }; }

function kvReq(method, key, bodyStr) {
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

async function kvGet(key) {
  const r = await kvReq('GET', key);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error('KV GET ' + r.status);
  try { return JSON.parse(r.body); } catch { return null; }
}

async function kvSet(key, val) {
  const r = await kvReq('PUT', key, JSON.stringify(val));
  if (r.status < 200 || r.status > 299) throw new Error('KV SET ' + r.status);
}

function kvDel(key) {
  return new Promise(resolve => {
    const path = `/client/v4/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${CF_NAMESPACE}/values/${encodeURIComponent(key)}`;
    const req = https.request(
      { hostname: 'api.cloudflare.com', port: 443, path, method: 'DELETE',
        headers: { 'Authorization': `Bearer ${CF_TOKEN}` } },
      res => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', resolve);
    req.end();
  });
}

function hashPwd(password, salt) {
  if (!salt) salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPwd(password, hash, salt) {
  try {
    const { hash: computed } = hashPwd(password, salt);
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

function makeToken() { return crypto.randomBytes(32).toString('hex'); }

function empresaIdFromEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 16);
}

function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return Promise.resolve();
  return new Promise(resolve => {
    const body = JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html });
    const req = https.request(
      { hostname: 'api.resend.com', port: 443, path: '/emails', method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body) } },
      res => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

function emailBrand(content) {
  return `<div style="font-family:'DM Sans',sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#F8FAFC;border-radius:16px">
    <div style="text-align:center;margin-bottom:24px">
      <h2 style="color:#1E40AF;margin:0;font-size:22px">📊 Recorre Hub</h2>
      <p style="color:#64748B;font-size:13px;margin:4px 0 0">Conselheiro de Assinaturas</p>
    </div>
    ${content}
    <p style="font-size:11px;color:#94A3B8;text-align:center;margin-top:24px">Recorre Hub · Inteligência para sua recorrência</p>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (!CF_ACCOUNT || !CF_NAMESPACE || !CF_TOKEN) return fail(503, 'Armazenamento não configurado.');

  const action = (event.queryStringParameters || {}).action;
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  if (action === 'register') {
    const { email, password, inviteCode } = body;
    if (!email || !password) return fail(400, 'E-mail e senha são obrigatórios.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'E-mail inválido.');
    if (password.length < 8) return fail(400, 'A senha deve ter pelo menos 8 caracteres.');
    if (INVITE_CODE && inviteCode !== INVITE_CODE) return fail(403, 'Código de acesso inválido.');

    const userKey = 'crm_user:' + email.toLowerCase().trim();
    const existing = await kvGet(userKey).catch(() => null);
    if (existing) return fail(409, 'Este e-mail já está cadastrado.');

    const empresaId = empresaIdFromEmail(email);
    const { hash, salt } = hashPwd(password);
    try {
      await kvSet(userKey, {
        email: email.toLowerCase().trim(),
        hash, salt,
        perfil: 'admin',
        empresaId,
        ativo: true,
        criadoEm: new Date().toISOString()
      });
    } catch (e) {
      return fail(500, 'Erro ao salvar conta. Verifique as variáveis CF_KV_*.');
    }

    sendEmail(email, 'Bem-vindo ao Recorre Hub!', emailBrand(`
      <h3 style="color:#1E293B">Sua conta foi criada!</h3>
      <p style="color:#475569">Acesse o CRM e conecte sua chave de API Asaas para começar.</p>
      <div style="text-align:center;margin:20px 0">
        <a href="${APP_URL}" style="background:#1E40AF;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Acessar Recorre Hub</a>
      </div>
    `)).catch(() => {});

    return ok({ ok: true });
  }

  if (action === 'login') {
    const { email, password } = body;
    if (!email || !password) return fail(400, 'E-mail e senha são obrigatórios.');

    const user = await kvGet('crm_user:' + email.toLowerCase().trim()).catch(() => null);
    if (!user || !verifyPwd(password, user.hash, user.salt)) return fail(401, 'E-mail ou senha incorretos.');
    if (user.ativo === false) return fail(403, 'Conta suspensa. Entre em contato com o administrador.');

    const tok = makeToken();
    try {
      await kvSet('crm_session:' + tok, {
        email: user.email,
        empresaId: user.empresaId,
        perfil: user.perfil,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      });
    } catch (e) {
      return fail(500, 'Erro ao criar sessão. Tente novamente.');
    }

    return ok({ token: tok, email: user.email, perfil: user.perfil, empresaId: user.empresaId });
  }

  if (action === 'session') {
    const { token: tok } = body;
    if (!tok) return fail(401, 'Token ausente.');
    const session = await kvGet('crm_session:' + tok).catch(() => null);
    if (!session || session.expiresAt < Date.now()) return fail(401, 'Sessão expirada.');
    return ok({ email: session.email, perfil: session.perfil, empresaId: session.empresaId });
  }

  if (action === 'logout') {
    const { token: tok } = body;
    if (tok) kvDel('crm_session:' + tok);
    return ok({ ok: true });
  }

  if (action === 'invite') {
    const { token: tok, emailConvidado, perfil } = body;
    if (!tok) return fail(401, 'Token ausente.');
    if (!PERFIS.includes(perfil)) return fail(400, 'Perfil inválido.');

    const session = await kvGet('crm_session:' + tok).catch(() => null);
    if (!session || session.expiresAt < Date.now()) return fail(401, 'Sessão expirada.');
    if (session.perfil !== 'admin') return fail(403, 'Apenas administradores podem convidar usuários.');

    const inviteToken = makeToken();
    try {
      await kvSet('crm_invite:' + inviteToken, {
        email: emailConvidado.toLowerCase().trim(),
        perfil,
        empresaId: session.empresaId,
        convidadoPor: session.email,
        expiresAt: Date.now() + 48 * 60 * 60 * 1000
      });
    } catch (e) {
      return fail(500, 'Erro ao gerar convite.');
    }

    const inviteUrl = `${APP_URL}?invite=${inviteToken}`;
    sendEmail(emailConvidado, 'Você foi convidado para o Recorre Hub', emailBrand(`
      <h3 style="color:#1E293B">Você recebeu um convite!</h3>
      <p style="color:#475569"><strong>${session.email}</strong> convidou você para acessar o Recorre Hub com perfil <strong>${perfil}</strong>.</p>
      <p style="color:#475569">O link expira em <strong>48 horas</strong>.</p>
      <div style="text-align:center;margin:20px 0">
        <a href="${inviteUrl}" style="background:#1E40AF;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Criar minha senha</a>
      </div>
    `)).catch(() => {});

    return ok({ ok: true });
  }

  if (action === 'accept-invite') {
    const { inviteToken, password } = body;
    if (!inviteToken || !password) return fail(400, 'Dados incompletos.');
    if (password.length < 8) return fail(400, 'A senha deve ter pelo menos 8 caracteres.');

    const invite = await kvGet('crm_invite:' + inviteToken).catch(() => null);
    if (!invite || invite.expiresAt < Date.now()) return fail(400, 'Convite inválido ou expirado.');

    const userKey = 'crm_user:' + invite.email;
    const existing = await kvGet(userKey).catch(() => null);
    if (existing) return fail(409, 'Este e-mail já possui uma conta.');

    const { hash, salt } = hashPwd(password);
    try {
      await kvSet(userKey, {
        email: invite.email,
        hash, salt,
        perfil: invite.perfil,
        empresaId: invite.empresaId,
        ativo: true,
        criadoEm: new Date().toISOString()
      });
      kvDel('crm_invite:' + inviteToken);
    } catch (e) {
      return fail(500, 'Erro ao criar conta. Tente novamente.');
    }

    return ok({ ok: true, email: invite.email });
  }

  if (action === 'forgot') {
    const { email } = body;
    if (!email) return fail(400, 'Informe o e-mail.');

    const user = await kvGet('crm_user:' + email.toLowerCase().trim()).catch(() => null);
    if (!user) return ok({ ok: true });

    const tok = makeToken();
    try {
      await kvSet('crm_reset:' + tok, { email: user.email, expiresAt: Date.now() + 60 * 60 * 1000 });
    } catch (e) {
      return fail(500, 'Erro ao gerar link.');
    }

    const resetUrl = `${APP_URL}?reset=${tok}`;
    sendEmail(email, 'Redefinir senha — Recorre Hub', emailBrand(`
      <h3 style="color:#1E293B">Redefinir sua senha</h3>
      <p style="color:#475569">Clique no botão abaixo para criar uma nova senha. O link expira em <strong>1 hora</strong>.</p>
      <div style="text-align:center;margin:20px 0">
        <a href="${resetUrl}" style="background:#1E40AF;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Redefinir senha</a>
      </div>
    `)).catch(() => {});

    return ok({ ok: true });
  }

  if (action === 'reset') {
    const { token: tok, password } = body;
    if (!tok || !password) return fail(400, 'Dados incompletos.');
    if (password.length < 8) return fail(400, 'A senha deve ter pelo menos 8 caracteres.');

    const resetData = await kvGet('crm_reset:' + tok).catch(() => null);
    if (!resetData || resetData.expiresAt < Date.now()) return fail(400, 'Link inválido ou expirado.');

    const user = await kvGet('crm_user:' + resetData.email).catch(() => null);
    if (!user) return fail(400, 'Usuário não encontrado.');

    const { hash, salt } = hashPwd(password);
    user.hash = hash; user.salt = salt;
    try {
      await kvSet('crm_user:' + resetData.email, user);
      kvDel('crm_reset:' + tok);
    } catch (e) {
      return fail(500, 'Erro ao salvar nova senha.');
    }

    return ok({ ok: true });
  }

  if (action === 'change-password') {
    const { token: tok, senhaAtual, novaSenha } = body;
    if (!tok || !senhaAtual || !novaSenha) return fail(400, 'Dados incompletos.');
    if (novaSenha.length < 8) return fail(400, 'A senha deve ter pelo menos 8 caracteres.');

    const session = await kvGet('crm_session:' + tok).catch(() => null);
    if (!session || session.expiresAt < Date.now()) return fail(401, 'Sessão inválida.');

    const user = await kvGet('crm_user:' + session.email).catch(() => null);
    if (!user) return fail(400, 'Usuário não encontrado.');
    if (!verifyPwd(senhaAtual, user.hash, user.salt)) return fail(401, 'Senha atual incorreta.');

    const { hash, salt } = hashPwd(novaSenha);
    user.hash = hash; user.salt = salt;
    try {
      await kvSet('crm_user:' + session.email, user);
    } catch (e) {
      return fail(500, 'Erro ao salvar nova senha.');
    }

    return ok({ ok: true });
  }

  if (action === 'admin-disable' || action === 'admin-enable') {
    const { adminKey, email: targetEmail } = body;
    if (!ADMIN_KEY || adminKey !== ADMIN_KEY) return fail(403, 'Não autorizado.');
    if (!targetEmail) return fail(400, 'E-mail obrigatório.');

    const key = 'crm_user:' + targetEmail.toLowerCase().trim();
    const user = await kvGet(key).catch(() => null);
    if (!user) return fail(404, 'Usuário não encontrado.');

    user.ativo = action === 'admin-enable';
    try { await kvSet(key, user); } catch (e) { return fail(500, 'Erro ao atualizar conta.'); }
    return ok({ ok: true, email: targetEmail, ativo: user.ativo });
  }

  return fail(400, 'Ação desconhecida.');
};