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

async function sha256(value) {
  return base64Url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
function normalizeMerchant(value) {
  return String(value || "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/\s*(주식회사|㈜)$/g, "")
    .trim()
    .slice(0, 60);
}
function categorizeMerchant(merchant) {
  const rules = [
    [/(스타벅스|투썸|메가커피|컴포즈|빽다방|커피|카페|cafe|coffee)/i, "카페"],
    [/(이마트|홈플러스|롯데마트|코스트코|하나로마트|마트|마켓컬리|오아시스|식자재)/i, "장보기"],
    [/(배달의민족|배민|요기요|쿠팡이츠|식당|치킨|피자|김밥|분식|국밥|버거|맥도날드|롯데리아|음식)/i, "식비"],
    [/(택시|카카오T|우버|주유|SK에너지|GS칼텍스|S-OIL|현대오일|버스|지하철|철도|코레일|주차|하이패스)/i, "교통"],
    [/(병원|의원|치과|한의원|약국|메디컬|건강)/i, "건강"],
    [/(CGV|메가박스|롯데시네마|넷플릭스|유튜브|디즈니|왓챠|공연|영화|노래방|호텔|여행)/i, "여가"],
    [/(백화점|무신사|지그재그|에이블리|올리브영|의류|패션|쇼핑)/i, "쇼핑"],
    [/(관리비|전기|가스|수도|월세|통신|KT|SKT|LG유플러스)/i, "주거"],
    [/(다이소|세탁|편의점|CU|GS25|세븐일레븐|생활)/i, "생활"]
  ];
  return rules.find(([pattern]) => pattern.test(merchant))?.[1] || "미분류";
}
function cardCompany(text) {
  if (/신한|shinhan/i.test(text)) return "신한카드";
  if (/현대|hyundai/i.test(text)) return "현대카드";
  return "카드";
}
function parseOccurredAt(text, receivedAt) {
  const received = new Date(receivedAt || Date.now());
  const full = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  const short = text.match(/(?:^|\s)(\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s|$)/m);
  let year = received.getFullYear();
  let month;
  let day;
  let hour;
  let minute;
  if (full) [, year, month, day, hour, minute] = full;
  else if (short) [, month, day, hour, minute] = short;
  else return received.toISOString();
  const result = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (!full && result.getTime() > received.getTime() + 7 * 86400000) result.setFullYear(result.getFullYear() - 1);
  return result.toISOString();
}
function parseCardAlert(message, receivedAt) {
  const text = String(message || "").replace(/\r/g, "").trim();
  if (text.length < 8 || text.length > 3000) throw new Error("카드 알림 문자 전체를 입력해주세요.");
  const company = cardCompany(text);
  if (company === "카드") throw new Error("신한카드 또는 현대카드 문자로 확인되지 않습니다.");
  const eventType = /(승인취소|결제취소|취소완료|매입취소|취소)/i.test(text) ? "cancellation" : "approval";
  const amounts = [...text.matchAll(/(?:KRW\s*)?(\d{1,3}(?:,\d{3})+|\d{3,9})\s*원/gi)]
    .map(match => Number(match[1].replace(/,/g, "")))
    .filter(value => value > 0 && value <= 1000000000);
  if (!amounts.length) throw new Error("결제 금액을 찾지 못했습니다.");
  const amount = amounts[0];
  const lines = text.split("\n").map(normalizeMerchant).filter(Boolean);
  const ignored = /(web발신|신한카드|현대카드|승인|취소|일시불|할부|누적|잔액|카드|본인|가족|해외|원화|\d{1,3}(?:,\d{3})*\s*원|\d{1,4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}|\*{2,}|\d{4})/i;
  const merchant = lines
    .filter(line => !ignored.test(line) && /[가-힣A-Za-z]/.test(line))
    .sort((a, b) => b.length - a.length)[0] || "카드 결제";
  const occurredAt = parseOccurredAt(text, receivedAt);
  return { company, eventType, amount, currency: "KRW", merchant, category: categorizeMerchant(merchant), occurredAt };
}
async function profileForImportKey(request, env) {
  const key = request.headers.get("x-card-import-key") || "";
  if (!/^[A-Za-z0-9_-]{32,120}$/.test(key)) return null;
  const row = await env.DB.prepare("SELECT profile FROM card_import_tokens WHERE token_hash = ?")
    .bind(await sha256(key)).first();
  return row?.profile || null;
}
async function importCardAlert(request, env) {
  const profile = await profileForImportKey(request, env);
  if (!profile) return json({ message: "카드 자동등록 키가 올바르지 않습니다." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ message: "요청 형식이 올바르지 않습니다." }, 400); }
  let parsed;
  try { parsed = parseCardAlert(body.message, body.receivedAt); } catch (error) { return json({ message: error.message }, 422); }
  const normalizedMessage = String(body.message || "").replace(/\s+/g, " ").trim();
  const fingerprint = await sha256(`${profile}|${normalizedMessage}`);
  const duplicate = await env.DB.prepare("SELECT entry_id FROM card_alert_events WHERE fingerprint = ?").bind(fingerprint).first();
  if (duplicate) return json({ ok: true, duplicate: true, action: "ignored", parsed });
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  let entryId = null;
  let action = "saved";
  if (parsed.eventType === "approval") {
    entryId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO entries (id, owner, type, amount, currency, spent_on, category, payment, memo, receipt_path, updated_at)
        VALUES (?, ?, 'expense', ?, ?, ?, ?, ?, ?, NULL, ?)`)
        .bind(entryId, profile, parsed.amount, parsed.currency, parsed.occurredAt.slice(0, 10), parsed.category, parsed.company, `${parsed.merchant} · 카드 문자 자동등록`, now),
      env.DB.prepare(`INSERT INTO card_alert_events (id, profile, fingerprint, card_company, event_type, amount, currency, merchant, category, occurred_at, entry_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(eventId, profile, fingerprint, parsed.company, parsed.eventType, parsed.amount, parsed.currency, parsed.merchant, parsed.category, parsed.occurredAt, entryId, now)
    ]);
  } else {
    const original = await env.DB.prepare(`SELECT e.id FROM card_alert_events a JOIN entries e ON e.id = a.entry_id
      WHERE a.profile = ? AND a.event_type = 'approval' AND a.card_company = ? AND a.amount = ?
      AND a.merchant = ? AND a.occurred_at >= datetime(?, '-45 days') ORDER BY a.occurred_at DESC LIMIT 1`)
      .bind(profile, parsed.company, parsed.amount, parsed.merchant, parsed.occurredAt).first();
    entryId = original?.id || null;
    const statements = [env.DB.prepare(`INSERT INTO card_alert_events (id, profile, fingerprint, card_company, event_type, amount, currency, merchant, category, occurred_at, entry_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(eventId, profile, fingerprint, parsed.company, parsed.eventType, parsed.amount, parsed.currency, parsed.merchant, parsed.category, parsed.occurredAt, entryId, now)];
    if (entryId) statements.push(env.DB.prepare("DELETE FROM entries WHERE id = ? AND owner = ?").bind(entryId, profile));
    else action = "cancellation_unmatched";
    await env.DB.batch(statements);
  }
  return json({ ok: true, duplicate: false, action, parsed });
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
  if (path[0] === "card-alert" && request.method === "POST") return importCardAlert(request, env);

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
  if (path[0] === "card-import" && path[1] === "status" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT updated_at FROM card_import_tokens WHERE profile = ?").bind(profile).first();
    return json({ configured: Boolean(row), updatedAt: row?.updated_at || null, endpoint: `${new URL(request.url).origin}/api/card-alert` });
  }
  if (path[0] === "card-import" && path[1] === "token" && request.method === "POST") {
    const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO card_import_tokens (profile, token_hash, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(profile) DO UPDATE SET token_hash=excluded.token_hash, updated_at=excluded.updated_at`)
      .bind(profile, await sha256(token), now).run();
    return json({ token, endpoint: `${new URL(request.url).origin}/api/card-alert`, updatedAt: now });
  }
  if (path[0] === "card-import" && path[1] === "test" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ message: "요청 형식이 올바르지 않습니다." }, 400); }
    try { return json({ parsed: parseCardAlert(body.message, body.receivedAt) }); }
    catch (error) { return json({ message: error.message }, 422); }
  }
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
