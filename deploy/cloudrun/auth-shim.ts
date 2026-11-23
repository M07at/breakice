/**
 * 极简认证服务（Deno），替代 GoTrue。
 *
 * 只用两个接口：
 *   POST /signup                     → 建匿名用户，返回 access/refresh token
 *   POST /token?grant_type=refresh_token → 用 refresh token 换新的 access token
 *   GET  /user                       → 返回当前用户
 *
 * 为什么不用 GoTrue：镜像自带的 auth schema 版本落后，GoTrue 认为"已迁移"而跳过建表，
 * 结果每次登录都缺列/缺表。这里直接写 auth.users 并自签 JWT，绕开整套迁移。
 *
 * 数据库访问通过 psql 子进程完成（镜像里自带 psql）。
 */

const PORT = Number(Deno.env.get("PORT") ?? "9998");
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const DB_USER = Deno.env.get("POSTGRES_SUPERUSER") ?? "supabase_admin";
const DB_NAME = Deno.env.get("POSTGRES_DB") ?? "breakice";
const DB_PASS = Deno.env.get("POSTGRES_PASSWORD") ?? "postgres";
const ACCESS_TTL = 3600;
const REFRESH_TTL = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value: unknown): string {
  return b64url(enc.encode(JSON.stringify(value)));
}

async function hmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const head = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson(payload);
  const data = `${head}.${body}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const sigBytes = Uint8Array.from(
    atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), sigBytes, enc.encode(data));
  if (!ok) return null;
  try {
    const json = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof json.exp === "number" && json.exp * 1000 < Date.now()) return null;
    return json;
  } catch {
    return null;
  }
}

async function psql(sql: string): Promise<string> {
  const cmd = new Deno.Command("psql", {
    args: ["-h", "127.0.0.1", "-U", DB_USER, "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
    env: { PGPASSWORD: DB_PASS },
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  const text = new TextDecoder().decode(out.stdout).trim();
  if (!out.success) {
    const err = new TextDecoder().decode(out.stderr).trim();
    throw new Error(err || "psql failed");
  }
  return text;
}

function escape(value: string): string {
  return value.replace(/'/g, "''");
}

async function createAnonymousUser(): Promise<string> {
  const id = crypto.randomUUID();
  await psql(
    `insert into auth.users (id, aud, role, is_anonymous, is_sso_user, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('${id}', 'authenticated', 'authenticated', true, false, '{"provider":"anonymous","providers":["anonymous"]}'::jsonb, '{}'::jsonb, now(), now())`,
  );
  return id;
}

async function tokensFor(userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const access = await signJwt({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + ACCESS_TTL,
    iss: "break-ice-auth-shim",
  });
  const refresh = await signJwt({
    sub: userId,
    type: "refresh",
    iat: now,
    exp: now + REFRESH_TTL,
    iss: "break-ice-auth-shim",
  });
  return { access, refresh };
}

function sessionBody(userId: string, access: string, refresh: string) {
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: ACCESS_TTL,
    expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL,
    refresh_token: refresh,
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      is_anonymous: true,
      email: null,
    },
  };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,apikey,content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

Deno.serve({ port: PORT, hostname: "127.0.0.1" }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    if (req.method === "POST" && path.endsWith("/signup")) {
      const userId = await createAnonymousUser();
      const { access, refresh } = await tokensFor(userId);
      return json(sessionBody(userId, access, refresh));
    }

    if (req.method === "POST" && path.endsWith("/token")) {
      const grant = url.searchParams.get("grant_type") ?? "";
      const body = await req.json().catch(() => ({}) as Record<string, unknown>);
      if (grant !== "refresh_token") return json({ error: "unsupported_grant_type" }, 400);
      const claims = await verifyJwt(String((body as { refresh_token?: string }).refresh_token ?? ""));
      if (!claims || claims.type !== "refresh") return json({ error: "invalid_grant" }, 400);
      const userId = String(claims.sub);
      const { access, refresh } = await tokensFor(userId);
      return json(sessionBody(userId, access, refresh));
    }

    if (req.method === "GET" && path.endsWith("/user")) {
      const auth = req.headers.get("authorization") ?? "";
      const claims = await verifyJwt(auth.replace(/^Bearer\s+/i, ""));
      if (!claims) return json({ error: "invalid_token" }, 401);
      return json({
        id: String(claims.sub),
        aud: "authenticated",
        role: "authenticated",
        is_anonymous: true,
      });
    }

    return json({ error: "not_found", path }, 404);
  } catch (error) {
    console.error("[auth-shim] 处理失败", error);
    return json({ error: "unexpected_failure", msg: String(error) }, 500);
  }
});

console.log(`[auth-shim] listening on ${PORT}, db=${DB_NAME}@${DB_USER}, jwt=${JWT_SECRET ? "set" : "empty"}`);
