import test from "node:test";
import assert from "node:assert/strict";
import { createStaticHandler } from "../lambda/static-handler.mjs";

const event = (rawPath, method = "GET") => ({
  rawPath,
  requestContext: { http: { method } },
});
const object = (bytes) => ({
  ContentLength: bytes.length,
  Body: { transformToByteArray: async () => bytes },
});

for (const path of ["/", "/index.html"]) {
  test(`${path} reads only index.html and returns HTML without caching`, async () => {
    const calls = [];
    const html = Buffer.from('<html lang="es">Nodo</html>');
    const response = await createStaticHandler(async (key) => {
      calls.push(key);
      return object(html);
    })(event(path));
    assert.deepEqual(calls, ["index.html"]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.isBase64Encoded, true);
    assert.deepEqual(Buffer.from(response.body, "base64"), html);
  });
}

for (const [path, mime] of [
  ["/assets/index-abcdef.js", "text/javascript; charset=utf-8"],
  ["/assets/index-abcdef.css", "text/css; charset=utf-8"],
  ["/images/products/aud-001.jpeg", "image/jpeg"],
  ["/images/store/banner.jpg", "image/jpeg"],
  ["/fonts/InterVariable.woff2", "font/woff2"],
]) {
  test(`${path} preserves binary bytes and correct MIME`, async () => {
    const bytes = Buffer.from([0, 255, 128, 65]);
    let calls = 0;
    const response = await createStaticHandler(async (key) => {
      calls++;
      assert.equal(key, path.slice(1));
      return object(bytes);
    })(event(path));
    assert.equal(calls, 1);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], mime);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.isBase64Encoded, true);
    assert.deepEqual(Buffer.from(response.body, "base64"), bytes);
  });
}

for (const path of [
  "/api/v1/products",
  "/docs",
  "/docs-json",
  "/.env",
  "/images/../index.html",
  "/images/%2e%2e/index.html",
  "/images/%252e%252e/index.html",
  "/images/.private.json",
  "/images//a.png",
  "/fonts/key.pem",
  "/images/a%00.png",
  "/images/a%5cb.png",
  "/images/%ZZ.png",
  "/other-bucket/index.html",
  "/images/file.constructor",
]) {
  test(`${path} is rejected without S3 calls`, async () => {
    const response = await createStaticHandler(() =>
      assert.fail("Unexpected S3 read"),
    )(event(path));
    assert.equal(response.statusCode, 404);
    assert.equal(response.headers["cache-control"], "no-store");
  });
}

test("non-GET requests never read objects", async () => {
  const response = await createStaticHandler(() =>
    assert.fail("Unexpected S3 read"),
  )(event("/", "POST"));
  assert.equal(response.statusCode, 405);
});

for (const name of [
  "NoSuchKey",
  "AccessDenied",
  "NotFound",
  "ServiceFailure",
]) {
  test(`${name} is sanitized without revealing SDK data`, async () => {
    const handler = createStaticHandler(async () => {
      throw Object.assign(new Error("private SDK body and bucket details"), {
        name,
      });
    });
    const response = await handler(event("/images/a.png"));
    assert.equal(response.statusCode, name === "ServiceFailure" ? 503 : 404);
    assert.equal(response.body.includes("private"), false);
    assert.equal(response.body.includes(name), false);
  });
}

test("oversized S3 objects are rejected before reading the body", async () => {
  const handler = createStaticHandler(async () => ({
    ContentLength: 5 * 1024 * 1024,
    Body: {
      transformToByteArray: () => assert.fail("Oversized body was read"),
    },
  }));
  assert.equal((await handler(event("/assets/a.js"))).statusCode, 413);
});

test("missing S3 body is a sanitized service error", async () => {
  const handler = createStaticHandler(async () => ({ ContentLength: 1 }));
  assert.equal((await handler(event("/assets/a.js"))).statusCode, 503);
});

test("response limit also applies when ContentLength is absent", async () => {
  const handler = createStaticHandler(async () => ({
    Body: {
      transformToByteArray: async () => new Uint8Array(4 * 1024 * 1024 + 1),
    },
  }));
  assert.equal((await handler(event("/assets/a.js"))).statusCode, 413);
});
