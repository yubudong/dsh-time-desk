import test from "node:test";
import assert from "node:assert/strict";
import { createRequest, ROUTE } from "../src/transport.js";
const t = (key) => key;

test("plain text 404 produces a backend diagnostic, not a JSON parser error", async () => {
  const request = createRequest(
    async () => new Response("not found", { status: 404 }),
    t,
  );
  await assert.rejects(request({ action: "read" }), /backendMissing.*HTTP 404/);
});
test("malformed successful response is identified explicitly", async () => {
  const request = createRequest(
    async () => new Response("<html>Oops</html>"),
    t,
  );
  await assert.rejects(request({ action: "read" }), /backendFormat/);
});
test("JSON operation failures keep the actual business error", async () => {
  const request = createRequest(
    async () =>
      Response.json({ ok: false, error: "Data conflict" }, { status: 400 }),
    t,
  );
  await assert.rejects(request({ action: "read" }), /Data conflict/);
});
test("desktop carrier receives a relative route and the same JSON payload", async () => {
  let calls = 0;
  const request = createRequest(async (path, init) => {
    calls++;
    assert.equal(path, ROUTE);
    assert.equal(
      new URL(path, "http://localhost/mounted/").pathname,
      "/mounted/api/life-desk",
    );
    assert.deepEqual(JSON.parse(init.body), { action: "read" });
    return Response.json({ ok: true, value: { revision: 0 } });
  }, t);
  assert.deepEqual(await request({ action: "read" }), { revision: 0 });
  assert.equal(calls, 1);
});
test("authorization and connectivity errors are distinguishable", async () => {
  await assert.rejects(
    createRequest(
      async () => new Response("unauthorized", { status: 401 }),
      t,
    )({ action: "read" }),
    /backendAccess/,
  );
  await assert.rejects(
    createRequest(async () => {
      throw new TypeError("Failed to fetch");
    }, t)({ action: "read" }),
    /backendNetwork/,
  );
});
