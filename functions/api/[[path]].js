const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function validProfile(value) { return value === "꿍" || value === "푸"; }
function profileColumns(profile) { return profile === "꿍" ? ["kung_salt", "kung_hash"] : ["pu_salt", "pu_hash"]; }

async function safeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
async function signingKey(secret, usage) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}
async function createToken(payload, secret) {
  const body = base64Url(encoder.encode(JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 })));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret, ["sign"]), encoder.encode(body));
  return `${body}.${base64Url(signature)}`;
}
async function readToken(request, secret, kind) {
  const value = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [body, signature] = value.split(".");
  if (!body || !signature || !secret) return null;
  const valid = await crypto.subtle.verify("HMAC", await signingKey(secret, ["verify"]), fromBase64Url(signature), encoder.encode(body));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    return payload.kind === kind && payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}
async function authRow(env) { return env.DB.prepare("SELECT * FROM household_auth WHERE id = 1").first(); }
function profileStatus(row) { return { "꿍": Boolean(row?.kung_hash), "푸": Boolean(row?.pu_hash) }; }
function profileSalts(row) { return { "꿍": row?.kung_salt || null, "푸": row?.pu_salt || null }; }
async function ensureAuthRow(env) {
  let row = await authRow(env);
  if (row) return row;
  const secret = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT OR IGNORE INTO household_auth (id, app_secret, updated_at) VALUES (1, ?, ?)")
    .bind(secret, new Date().toISOString()).run();
  return authRow(env);
}

async function handleAuth(request, env, path) {
  const row = await ensureAuthRow(env);
  if (path[1] === "status" && request.method === "GET") {
    return json({ initialized: true, profiles: profileStatus(row), salts: profileSalts(row) });
  }
  if (request.method !== "POST") return json({ message: "허용되지 않은 요청입니다." }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ message: "요청 형식이 올바르지 않습니다." }, 400); }
  const credential = String(body.credential || "");
  const salt = String(body.salt || "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) return json({ message: "비밀번호 검증값이 올바르지 않습니다." }, 400);
  if (!validProfile(body.profile)) return json({ message: "프로필이 올바르지 않습니다." }, 400);
  const [saltColumn, hashColumn] = profileColumns(body.profile);

  if (body.action === "setup_profile") {
    if (row[hashColumn]) return json({ message: "이미 개인 비밀번호가 설정되어 있습니다." }, 409);
    await env.DB.prepare(`UPDATE household_auth SET ${saltColumn} = ?, ${hashColumn} = ?, updated_at = ? WHERE id = 1`)
      .bind(salt, credential, new Date().toISOString()).run();
    return json({ ok: true, householdId: "default", token: await createToken({ kind: "profile", profile: body.profile }, row.app_secret) });
  }
  if (body.action === "login_profile") {
    if (salt !== row[saltColumn] || !(await safeEqual(credential, row[hashColumn]))) return json({ message: "개인 비밀번호가 올바르지 않습니다." }, 403);
    return json({ ok: true, householdId: "default", token: await createToken({ kind: "profile", profile: body.profile }, row.app_secret) });
  }
  return json({ message: "알 수 없는 인증 요청입니다." }, 404);
}

async function currentVersion(env, profile) {
  const result = await env.DB.prepare(`
    SELECT MAX(updated_at) AS version FROM (
      SELECT updated_at FROM entries WHERE owner = ?
      UNION ALL SELECT updated_at FROM profile_settings WHERE profile = ?
    )
  `).bind(profile, profile).first();
  return result?.version || "";
}
async function loadData(env, profile) {
  const [entries, settings] = await Promise.all([
    env.DB.prepare("SELECT * FROM entries WHERE owner = ? ORDER BY spent_on DESC, updated_at DESC").bind(profile).all(),
    env.DB.prepare("SELECT * FROM profile_settings WHERE profile = ?").bind(profile).first()
  ]);
  const parseArray = value => { try { return JSON.parse(value || "[]"); } catch { return []; } };
  return {
    data: {
      transactions: (entries.results || []).map(row => ({
        id: row.id, type: row.type, amount: Number(row.amount), currency: row.currency,
        date: row.spent_on, category: row.category, payment: row.payment || "",
        memo: row.memo || "", owner: row.owner, receiptPath: row.receipt_path
      })),
      budget: { KRW: Number(settings?.budget_krw || 0), USD: Number(settings?.budget_usd || 0) },
      accounts: parseArray(settings?.accounts),
      recurring: parseArray(settings?.recurring)
    },
    version: await currentVersion(env, profile)
  };
}
async function signedReceiptUrl(request, secret, key, profile) {
  const expires = Date.now() + 1000 * 60 * 10;
  return `${new URL(request.url).origin}/api/receipts/${encodeURIComponent(key)}?profile=${encodeURIComponent(profile)}&expires=${expires}&token=${encodeURIComponent(await createToken({ kind: "receipt", profile, key, expires }, secret))}`;
}

export async function onRequest({ request, env, params }) {
  if (!env.DB) return json({ message: "Cloudflare D1 연결이 필요합니다." }, 503);
  const path = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  if (path[0] === "health") return json({ ok: true, database: true });
  if (path[0] === "auth") return handleAuth(request, env, path);

  if (path[0] === "receipts" && request.method === "GET" && path.length === 2) {
    const auth = await authRow(env);
    if (!auth) return json({ message: "인증 설정을 불러오지 못했습니다." }, 500);
    const url = new URL(request.url);
    const receiptToken = await readToken(new Request(request.url, { headers: { authorization: `Bearer ${url.searchParams.get("token") || ""}` } }), auth.app_secret, "receipt");
    const key = decodeURIComponent(path[1]);
    if (!receiptToken || receiptToken.key !== key || receiptToken.profile !== url.searchParams.get("profile") || Number(url.searchParams.get("expires")) < Date.now()) return json({ message: "영수증 링크가 만료되었습니다." }, 403);
    const receipt = await env.DB.prepare("SELECT content_type, data FROM receipts WHERE key = ? AND owner = ?").bind(key, receiptToken.profile).first();
    if (!receipt) return json({ message: "영수증을 찾지 못했습니다." }, 404);
    const bytes = receipt.data instanceof ArrayBuffer ? receipt.data : new Uint8Array(receipt.data);
    return new Response(bytes, { headers: { "content-type": receipt.content_type, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff" } });
  }

  const auth = await authRow(env);
  const session = await readToken(request, auth?.app_secret, "profile");
  if (!session || !validProfile(session.profile)) return json({ message: "다시 로그인해주세요." }, 401);
  const profile = session.profile;

  if (path[0] === "data" && request.method === "GET") return json(await loadData(env, profile));
  if (path[0] === "version" && request.method === "GET") return json({ version: await currentVersion(env, profile) });
  if (path[0] === "settings" && request.method === "POST") {
    const body = await request.json();
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO profile_settings (profile, budget_krw, budget_usd, accounts, recurring, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(profile) DO UPDATE SET budget_krw=excluded.budget_krw, budget_usd=excluded.budget_usd, accounts=excluded.accounts, recurring=excluded.recurring, updated_at=excluded.updated_at`)
      .bind(profile, Number(body.budget?.KRW || 0), Number(body.budget?.USD || 0), JSON.stringify(body.accounts || []), JSON.stringify(body.recurring || []), now).run();
    return json({ ok: true });
  }
  if (path[0] === "entries" && request.method === "POST") {
    const item = await request.json();
    if (!item.id || !["expense", "income"].includes(item.type)) return json({ message: "기록 형식이 올바르지 않습니다." }, 400);
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO entries (id, owner, type, amount, currency, spent_on, category, payment, memo, receipt_path, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type=excluded.type, amount=excluded.amount, currency=excluded.currency, spent_on=excluded.spent_on, category=excluded.category, payment=excluded.payment, memo=excluded.memo, receipt_path=excluded.receipt_path, updated_at=excluded.updated_at WHERE entries.owner=excluded.owner`)
      .bind(item.id, profile, item.type, Number(item.amount), String(item.currency || "KRW"), String(item.date || ""), String(item.category || ""), String(item.payment || ""), String(item.memo || "").slice(0, 100), item.receiptPath || null, now).run();
    return json({ ok: true, id: item.id });
  }
  if (path[0] === "entries" && path[1] && request.method === "DELETE") {
    const id = decodeURIComponent(path[1]);
    const row = await env.DB.prepare("SELECT receipt_path FROM entries WHERE id = ? AND owner = ?").bind(id, profile).first();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM entries WHERE id = ? AND owner = ?").bind(id, profile),
      env.DB.prepare("DELETE FROM receipts WHERE key = ? AND owner = ?").bind(row?.receipt_path || "", profile)
    ]);
    return json({ ok: true });
  }
  if (path[0] === "receipts" && path[1] && request.method === "PUT") {
    const type = request.headers.get("content-type") || "";
    if (!/^image\/(jpeg|png|webp)$/i.test(type)) return json({ message: "지원하지 않는 이미지 형식입니다." }, 415);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 1_500_000) return json({ message: "영수증 이미지는 1.5MB 이하여야 합니다." }, 413);
    const key = decodeURIComponent(path[1]);
    if (!/^[A-Za-z0-9._-]{1,180}$/.test(key)) return json({ message: "영수증 이름이 올바르지 않습니다." }, 400);
    await env.DB.prepare(`INSERT INTO receipts (key, owner, content_type, data, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET content_type=excluded.content_type, data=excluded.data, updated_at=excluded.updated_at WHERE receipts.owner=excluded.owner`)
      .bind(key, profile, type, bytes, new Date().toISOString()).run();
    return json({ ok: true, key });
  }
  if (path[0] === "receipts" && path[1] && path[2] === "url" && request.method === "GET") {
    const key = decodeURIComponent(path[1]);
    const exists = await env.DB.prepare("SELECT 1 FROM receipts WHERE key = ? AND owner = ?").bind(key, profile).first();
    if (!exists) return json({ message: "영수증을 찾지 못했습니다." }, 404);
    return json({ url: await signedReceiptUrl(request, auth.app_secret, key, profile) });
  }
  return json({ message: "요청 경로를 찾지 못했습니다." }, 404);
}
