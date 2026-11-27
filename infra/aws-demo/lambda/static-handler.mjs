const MAX_BYTES = 4 * 1024 * 1024;
const MIME = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

function objectKey(rawPath) {
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }
  if (path === "/" || path === "/index.html") return "index.html";
  if (!/^\/(assets|images|fonts)\/[A-Za-z0-9_./-]+$/.test(path))
    return undefined;
  const parts = path.slice(1).split("/");
  if (parts.some((part) => !part || part.startsWith("."))) return undefined;
  return parts.join("/");
}

function failure(statusCode, message) {
  return {
    statusCode,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    body: message,
    isBase64Encoded: false,
  };
}

export function createStaticHandler(getObject) {
  return async (event) => {
    if (event?.requestContext?.http?.method !== "GET")
      return failure(405, "Método no permitido.");
    const key = objectKey(event.rawPath ?? "");
    const extension = key?.split(".").at(-1).toLowerCase();
    const mime =
      extension && Object.hasOwn(MIME, extension) ? MIME[extension] : undefined;
    if (!key || !mime) return failure(404, "Recurso no disponible.");
    try {
      const object = await getObject(key);
      if (object.ContentLength > MAX_BYTES) {
        object.Body?.destroy?.();
        return failure(413, "Recurso demasiado grande.");
      }
      if (!object.Body)
        return failure(503, "Recurso temporalmente no disponible.");
      const bytes = await object.Body.transformToByteArray();
      if (bytes.byteLength > MAX_BYTES)
        return failure(413, "Recurso demasiado grande.");
      return {
        statusCode: 200,
        headers: {
          "content-type": mime,
          "cache-control":
            key === "index.html"
              ? "no-store"
              : key.startsWith("assets/")
                ? "public, max-age=31536000, immutable"
                : "public, max-age=300",
          "x-content-type-options": "nosniff",
        },
        body: Buffer.from(bytes).toString("base64"),
        isBase64Encoded: true,
      };
    } catch (error) {
      // Do not log request events, SDK errors, object metadata or external bodies.
      if (
        ["NoSuchKey", "NotFound", "AccessDenied"].includes(error?.name) ||
        [403, 404].includes(error?.$metadata?.httpStatusCode)
      )
        return failure(404, "Recurso no disponible.");
      return failure(503, "Recurso temporalmente no disponible.");
    }
  };
}
