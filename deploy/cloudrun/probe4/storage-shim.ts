/**
 * 极简 Storage 替代实现（Deno），只覆盖客户端实际用到的两个接口：
 *
 *   POST /object/artworks/<path>          上传（带 Authorization / apikey）
 *   GET  /object/sign/artworks/<path>     取可读地址
 *   GET  /file/artworks/<path>?token=...  读文件
 *
 * 文件落在 CFS 目录（STORAGE_DIR），路径即对象名。
 * 鉴权只校验「有没有带 apikey 或 Bearer」，细粒度权限由数据库侧 RLS 决定
 * —— 文件本身不含敏感信息，且路径里带 game_id，可按需收紧。
 */

const STORAGE_DIR = Deno.env.get("STORAGE_DIR") ?? "/var/lib/storage";
const PORT = Number(Deno.env.get("PORT") ?? "9000");
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function authorized(req: Request): boolean {
  const key = req.headers.get("apikey");
  const auth = req.headers.get("authorization");
  return Boolean(key || auth);
}

async function ensureDir(filePath: string): Promise<void> {
  const dir = filePath.slice(0, filePath.lastIndexOf("/"));
  if (dir) await Deno.mkdir(dir, { recursive: true });
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,apikey,content-type,x-upsert",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
};

Deno.serve({ port: PORT, hostname: "127.0.0.1" }, async (req) => {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (!authorized(req)) return json({ error: "missing apikey" }, 401);

  // 上传：/object/<bucket>/<name...>
  if (req.method === "POST" && path.startsWith("object/") && !path.startsWith("object/sign/")) {
    const objectPath = path.slice("object/".length);
    const target = `${STORAGE_DIR}/${objectPath}`;
    try {
      await ensureDir(target);
      const bytes = new Uint8Array(await req.arrayBuffer());
      await Deno.writeFile(target, bytes);
      return json({ Key: objectPath }, 200);
    } catch (error) {
      return json({ error: String(error) }, 500);
    }
  }

  // 签名地址：/object/sign/<bucket>/<name...>
  if (req.method === "GET" && path.startsWith("object/sign/")) {
    const objectPath = path.slice("object/sign/".length);
    // 简单做法：用路径本身做 token（生产环境应换成短期签名）
    const token = encodeURIComponent(objectPath);
    return json({ signedURL: `/file/${objectPath}?token=${token}` });
  }

  // 读文件：/file/<bucket>/<name...>
  if (req.method === "GET" && path.startsWith("file/")) {
    const objectPath = path.slice("file/".length);
    try {
      const data = await Deno.readFile(`${STORAGE_DIR}/${objectPath}`);
      const type = objectPath.endsWith(".png") ? "image/png" : "application/octet-stream";
      return new Response(data, { headers: { "content-type": type, ...CORS } });
    } catch {
      return json({ error: "not found" }, 404);
    }
  }

  return json({ error: "not implemented", path, method: req.method }, 404);
});

console.log(`[storage-shim] listening on ${PORT}, dir=${STORAGE_DIR}, jwt=${JWT_SECRET ? "set" : "empty"}`);
