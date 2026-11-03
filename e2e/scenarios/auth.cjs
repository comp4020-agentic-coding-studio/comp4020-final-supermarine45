// Register/login/guest/logout over plain HTTP, exercising every validation
// branch in src/routes/auth.ts by the exact error strings it returns, plus
// the /api/me identity contract (registered vs guest vs signed-out shapes).
const { makeSuite, ok, equal } = require("../lib/assert.cjs");
const { registerAndGetCookie, registerUniqueUser, login, createGuestCookie, getMe, uniqueSuffix } = require("../lib/api.cjs");

async function postJson(baseUrl, path, body, cookie) {
  const res = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie") };
}

module.exports = async function run(server) {
  const { baseUrl } = server;
  const { scenario, results } = makeSuite("auth");

  await scenario("register succeeds with a valid ANU email and sets a session cookie", async () => {
    const username = `auth-${uniqueSuffix()}`;
    const { cookie, username: returned } = await registerAndGetCookie(baseUrl, username);
    equal(returned, username);
    const me = await getMe(baseUrl, cookie);
    equal(me.username, username);
    equal(me.isGuest, false);
    equal(me.vfhCount, 0, "a brand new user should start at 0 VFH, not null");
  });

  await scenario("register rejects a non-ANU email address", async () => {
    const username = `auth-${uniqueSuffix()}`;
    const res = await postJson(baseUrl, "/auth/register", { username, email: "nope@gmail.com", password: "password123" });
    equal(res.status, 400);
    equal(res.body.error, "a valid ANU email address (you@anu.edu.au) is required");
  });

  await scenario("register rejects a malformed username", async () => {
    const res = await postJson(baseUrl, "/auth/register", {
      username: "a b!",
      email: `auth-${uniqueSuffix()}@anu.edu.au`,
      password: "password123",
    });
    equal(res.status, 400);
    equal(res.body.error, "username must be 3-24 letters, digits, _ or -");
  });

  await scenario("register rejects a short password", async () => {
    const res = await postJson(baseUrl, "/auth/register", {
      username: `auth-${uniqueSuffix()}`,
      email: `auth-${uniqueSuffix()}@anu.edu.au`,
      password: "short",
    });
    equal(res.status, 400);
    equal(res.body.error, "password must be at least 8 characters");
  });

  await scenario("register rejects a duplicate username", async () => {
    const username = `auth-${uniqueSuffix()}`;
    await registerAndGetCookie(baseUrl, username);
    const res = await postJson(baseUrl, "/auth/register", {
      username,
      email: `auth-${uniqueSuffix()}@anu.edu.au`,
      password: "password123",
    });
    equal(res.status, 409);
    equal(res.body.error, "username is taken");
  });

  await scenario("register rejects a duplicate email", async () => {
    const email = `auth-${uniqueSuffix()}@anu.edu.au`;
    await postJson(baseUrl, "/auth/register", { username: `auth-${uniqueSuffix()}`, email, password: "password123" });
    const res = await postJson(baseUrl, "/auth/register", { username: `auth-${uniqueSuffix()}`, email, password: "password123" });
    equal(res.status, 409);
    equal(res.body.error, "email is already registered");
  });

  await scenario("login succeeds with the right password and fails with the wrong one", async () => {
    const username = `auth-${uniqueSuffix()}`;
    await registerAndGetCookie(baseUrl, username, "correct-horse-battery");
    const good = await login(baseUrl, username, "correct-horse-battery");
    equal(good.status, 200);
    equal(good.body.username, username);
    ok(!!good.cookie, "successful login should set a session cookie");

    const bad = await login(baseUrl, username, "wrong-password-entirely");
    equal(bad.status, 401);
    equal(bad.body.error, "wrong username or password");
  });

  await scenario("guest continue issues a Guest {Animal} identity with no VFH tracking", async () => {
    const { cookie, username } = await createGuestCookie(baseUrl);
    ok(/^Guest /.test(username), `expected a "Guest {Animal}" name, got: ${username}`);
    const me = await getMe(baseUrl, cookie);
    equal(me.isGuest, true);
    equal(me.vfhCount, null, "guests must not have a VFH count");
  });

  await scenario("logout clears the session so /api/me reports signed out", async () => {
    const { cookie } = await registerUniqueUser(baseUrl, "auth-logout");
    const before = await getMe(baseUrl, cookie);
    ok(before && before.username, "should be signed in before logout");

    const res = await fetch(new URL("/auth/logout", baseUrl), { method: "POST", headers: { cookie } });
    equal(res.status, 200);
    const clearedCookie = res.headers.get("set-cookie");
    ok(!!clearedCookie, "logout should send a Set-Cookie clearing the session");

    // Re-use the ORIGINAL cookie value (as a client that ignored the clear
    // instruction would) to confirm the server destroyed the session itself,
    // not just asked the client nicely to forget it.
    const after = await getMe(baseUrl, cookie);
    equal(after, null, "the old session token must no longer resolve to an identity after logout");
  });

  return results;
};
