# Plaid Serverless Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal serverless backend the iOS app needs to talk to Plaid — create Link tokens, exchange public tokens for access tokens, and proxy transaction/balance fetches — keeping the Plaid secret server-side.

**Architecture:** Three stateless Vercel serverless functions (Node.js) plus a shared Plaid client factory. The Plaid secret lives only in serverless environment variables. The client passes an access token on each data-fetch request; the backend stores nothing. Logic is unit-tested with Jest by mocking the Plaid SDK.

**Tech Stack:** Node.js (CommonJS), Vercel serverless functions, `plaid` npm SDK, Jest.

This is Plan 1 of 5 for the Personal Finance Tracker. It produces a deployable, fully tested backend that the iOS app (Plan 3) consumes.

---

## File Structure

All paths are relative to the repository root (`C:\Users\kharb`).

- `finance-tracker/backend/package.json` — deps and test script
- `finance-tracker/backend/vercel.json` — function config
- `finance-tracker/backend/.env.example` — required env vars (no secrets)
- `finance-tracker/backend/lib/plaidClient.js` — Plaid client factory
- `finance-tracker/backend/api/create-link-token.js` — POST: create Link token
- `finance-tracker/backend/api/exchange-token.js` — POST: exchange public token
- `finance-tracker/backend/api/fetch-data.js` — POST: proxy transactions + balances
- `finance-tracker/backend/tests/helpers.js` — mock req/res builders
- `finance-tracker/backend/tests/create-link-token.test.js`
- `finance-tracker/backend/tests/exchange-token.test.js`
- `finance-tracker/backend/tests/fetch-data.test.js`

Each function file has exactly one responsibility (one Plaid operation). The shared client factory is the only cross-file dependency.

---

### Task 0: Project scaffold and gitignore

**Files:**
- Create: `finance-tracker/backend/package.json`
- Create: `finance-tracker/backend/.env.example`
- Create: `finance-tracker/backend/vercel.json`
- Modify: `.gitignore` (repo root)

- [ ] **Step 1: Whitelist the project folder in the home-dir .gitignore**

The repo root is the Windows home directory, which ignores everything except `/docs`. Add the project folder. Edit `.gitignore` so it reads:

```gitignore
# Home directory is the repo root — ignore everything by default,
# then whitelist only what we intend to track.
/*
!/.gitignore
!/docs/
!/finance-tracker/
finance-tracker/backend/node_modules/
finance-tracker/backend/.env
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "finance-tracker-backend",
  "version": "1.0.0",
  "private": true,
  "description": "Serverless Plaid backend for Personal Finance Tracker",
  "scripts": {
    "test": "jest"
  },
  "dependencies": {
    "plaid": "^29.0.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 3: Create `.env.example`**

```bash
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SECRET=your_plaid_secret
PLAID_ENV=sandbox
```

- [ ] **Step 4: Create `vercel.json`**

```json
{
  "functions": {
    "api/*.js": {
      "maxDuration": 10
    }
  }
}
```

- [ ] **Step 5: Install dependencies**

Run: `cd finance-tracker/backend && npm install`
Expected: `node_modules` created, no errors; `plaid` and `jest` present.

- [ ] **Step 6: Commit**

```bash
git add .gitignore finance-tracker/backend/package.json finance-tracker/backend/.env.example finance-tracker/backend/vercel.json finance-tracker/backend/package-lock.json
git commit -m "chore: scaffold Plaid serverless backend"
```

---

### Task 1: Shared test helpers

**Files:**
- Create: `finance-tracker/backend/tests/helpers.js`

These mock the Vercel `(req, res)` interface so handler tests stay terse.

- [ ] **Step 1: Create the helpers**

```javascript
// tests/helpers.js
function makeReq({ method = 'POST', body = {} } = {}) {
  return { method, body };
}

function makeRes() {
  const res = {
    statusCode: null,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      return this;
    },
  };
  return res;
}

module.exports = { makeReq, makeRes };
```

- [ ] **Step 2: Commit**

```bash
git add finance-tracker/backend/tests/helpers.js
git commit -m "test: add mock req/res helpers"
```

---

### Task 2: Plaid client factory

**Files:**
- Create: `finance-tracker/backend/lib/plaidClient.js`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/backend/tests/plaidClient.test.js`:

```javascript
// tests/plaidClient.test.js
describe('createPlaidClient', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('returns a PlaidApi instance configured for the env', () => {
    process.env.PLAID_CLIENT_ID = 'cid';
    process.env.PLAID_SECRET = 'secret';
    process.env.PLAID_ENV = 'sandbox';

    const { createPlaidClient } = require('../lib/plaidClient');
    const client = createPlaidClient();

    expect(client).toBeDefined();
    expect(typeof client.linkTokenCreate).toBe('function');
    expect(typeof client.itemPublicTokenExchange).toBe('function');
    expect(typeof client.transactionsSync).toBe('function');
    expect(typeof client.accountsBalanceGet).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd finance-tracker/backend && npx jest tests/plaidClient.test.js`
Expected: FAIL — `Cannot find module '../lib/plaidClient'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/plaidClient.js
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

function createPlaidClient() {
  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  });
  return new PlaidApi(config);
}

module.exports = { createPlaidClient };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd finance-tracker/backend && npx jest tests/plaidClient.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/backend/lib/plaidClient.js finance-tracker/backend/tests/plaidClient.test.js
git commit -m "feat: add Plaid client factory"
```

---

### Task 3: Create Link token endpoint

**Files:**
- Create: `finance-tracker/backend/api/create-link-token.js`
- Test: `finance-tracker/backend/tests/create-link-token.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/create-link-token.test.js
const { makeReq, makeRes } = require('./helpers');

const mockLinkTokenCreate = jest.fn();
jest.mock('../lib/plaidClient', () => ({
  createPlaidClient: () => ({ linkTokenCreate: mockLinkTokenCreate }),
}));

const handler = require('../api/create-link-token');

beforeEach(() => {
  mockLinkTokenCreate.mockReset();
});

test('rejects non-POST methods with 405', async () => {
  const req = makeReq({ method: 'GET' });
  const res = makeRes();
  await handler(req, res);
  expect(res.statusCode).toBe(405);
});

test('returns 400 when userId is missing', async () => {
  const req = makeReq({ body: {} });
  const res = makeRes();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
});

test('returns a link token on success', async () => {
  mockLinkTokenCreate.mockResolvedValue({ data: { link_token: 'link-sandbox-123' } });
  const req = makeReq({ body: { userId: 'user-1' } });
  const res = makeRes();
  await handler(req, res);
  expect(mockLinkTokenCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      user: { client_user_id: 'user-1' },
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    })
  );
  expect(res.statusCode).toBe(200);
  expect(res.jsonBody).toEqual({ linkToken: 'link-sandbox-123' });
});

test('returns 502 when Plaid throws', async () => {
  mockLinkTokenCreate.mockRejectedValue(new Error('plaid down'));
  const req = makeReq({ body: { userId: 'user-1' } });
  const res = makeRes();
  await handler(req, res);
  expect(res.statusCode).toBe(502);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd finance-tracker/backend && npx jest tests/create-link-token.test.js`
Expected: FAIL — `Cannot find module '../api/create-link-token'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// api/create-link-token.js
const { createPlaidClient } = require('../lib/plaidClient');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  try {
    const client = createPlaidClient();
    const response = await client.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: 'Personal Finance Tracker',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    return res.status(200).json({ linkToken: response.data.link_token });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to create link token' });
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd finance-tracker/backend && npx jest tests/create-link-token.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/backend/api/create-link-token.js finance-tracker/backend/tests/create-link-token.test.js
git commit -m "feat: add create-link-token endpoint"
```

---

### Task 4: Exchange public token endpoint

**Files:**
- Create: `finance-tracker/backend/api/exchange-token.js`
- Test: `finance-tracker/backend/tests/exchange-token.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/exchange-token.test.js
const { makeReq, makeRes } = require('./helpers');

const mockExchange = jest.fn();
jest.mock('../lib/plaidClient', () => ({
  createPlaidClient: () => ({ itemPublicTokenExchange: mockExchange }),
}));

const handler = require('../api/exchange-token');

beforeEach(() => {
  mockExchange.mockReset();
});

test('rejects non-POST methods with 405', async () => {
  const req = makeReq({ method: 'GET' });
  const res = makeRes();
  await handler(req, res);
  expect(res.statusCode).toBe(405);
});

test('returns 400 when publicToken is missing', async () => {
  const req = makeReq({ body: {} });
  const res = makeRes();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
});

test('returns access token and item id on success', async () => {
  mockExchange.mockResolvedValue({
    data: { access_token: 'access-sandbox-xyz', item_id: 'item-9' },
  });
  const req = makeReq({ body: { publicToken: 'public-sandbox-abc' } });
  const res = makeRes();
  await handler(req, res);
  expect(mockExchange).toHaveBeenCalledWith({ public_token: 'public-sandbox-abc' });
  expect(res.statusCode).toBe(200);
  expect(res.jsonBody).toEqual({ accessToken: 'access-sandbox-xyz', itemId: 'item-9' });
});

test('returns 502 when Plaid throws', async () => {
  mockExchange.mockRejectedValue(new Error('boom'));
  const req = makeReq({ body: { publicToken: 'public-sandbox-abc' } });
  const res = makeRes();
  await handler(req, res);
  expect(res.statusCode).toBe(502);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd finance-tracker/backend && npx jest tests/exchange-token.test.js`
Expected: FAIL — `Cannot find module '../api/exchange-token'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// api/exchange-token.js
const { createPlaidClient } = require('../lib/plaidClient');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { publicToken } = req.body || {};
  if (!publicToken) {
    return res.status(400).json({ error: 'publicToken is required' });
  }
  try {
    const client = createPlaidClient();
    const response = await client.itemPublicTokenExchange({ public_token: publicToken });
    return res.status(200).json({
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to exchange public token' });
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd finance-tracker/backend && npx jest tests/exchange-token.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/backend/api/exchange-token.js finance-tracker/backend/tests/exchange-token.test.js
git commit -m "feat: add exchange-token endpoint"
```

---

### Task 5: Fetch data (transactions + balances) endpoint

**Files:**
- Create: `finance-tracker/backend/api/fetch-data.js`
- Test: `finance-tracker/backend/tests/fetch-data.test.js`

This endpoint receives the client's stored access token, calls `transactionsSync`
(cursor-based incremental sync) and `accountsBalanceGet`, and returns a combined
payload. The `cursor` is optional; the client passes back the one it last received.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/fetch-data.test.js
const { makeReq, makeRes } = require('./helpers');

const mockTransactionsSync = jest.fn();
const mockAccountsBalanceGet = jest.fn();
jest.mock('../lib/plaidClient', () => ({
  createPlaidClient: () => ({
    transactionsSync: mockTransactionsSync,
    accountsBalanceGet: mockAccountsBalanceGet,
  }),
}));

const handler = require('../api/fetch-data');

beforeEach(() => {
  mockTransactionsSync.mockReset();
  mockAccountsBalanceGet.mockReset();
});

test('rejects non-POST methods with 405', async () => {
  const req = makeReq({ method: 'GET' });
  const res = makeRes();
  await handler(req, res);
  expect(res.statusCode).toBe(405);
});

test('returns 400 when accessToken is missing', async () => {
  const req = makeReq({ body: {} });
  const res = makeRes();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
});

test('returns added transactions, balances, and next cursor', async () => {
  mockTransactionsSync.mockResolvedValue({
    data: {
      added: [{ transaction_id: 't1', amount: 12.5 }],
      next_cursor: 'cursor-2',
      has_more: false,
    },
  });
  mockAccountsBalanceGet.mockResolvedValue({
    data: { accounts: [{ account_id: 'a1', balances: { current: 1000 } }] },
  });

  const req = makeReq({ body: { accessToken: 'access-1', cursor: 'cursor-1' } });
  const res = makeRes();
  await handler(req, res);

  expect(mockTransactionsSync).toHaveBeenCalledWith({
    access_token: 'access-1',
    cursor: 'cursor-1',
  });
  expect(mockAccountsBalanceGet).toHaveBeenCalledWith({ access_token: 'access-1' });
  expect(res.statusCode).toBe(200);
  expect(res.jsonBody).toEqual({
    transactions: [{ transaction_id: 't1', amount: 12.5 }],
    accounts: [{ account_id: 'a1', balances: { current: 1000 } }],
    nextCursor: 'cursor-2',
    hasMore: false,
  });
});

test('omits cursor from the Plaid call when not provided', async () => {
  mockTransactionsSync.mockResolvedValue({
    data: { added: [], next_cursor: 'cursor-1', has_more: false },
  });
  mockAccountsBalanceGet.mockResolvedValue({ data: { accounts: [] } });

  const req = makeReq({ body: { accessToken: 'access-1' } });
  const res = makeRes();
  await handler(req, res);

  expect(mockTransactionsSync).toHaveBeenCalledWith({ access_token: 'access-1' });
  expect(res.statusCode).toBe(200);
});

test('returns 502 when Plaid throws', async () => {
  mockTransactionsSync.mockRejectedValue(new Error('down'));
  const req = makeReq({ body: { accessToken: 'access-1' } });
  const res = makeRes();
  await handler(req, res);
  expect(res.statusCode).toBe(502);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd finance-tracker/backend && npx jest tests/fetch-data.test.js`
Expected: FAIL — `Cannot find module '../api/fetch-data'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// api/fetch-data.js
const { createPlaidClient } = require('../lib/plaidClient');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { accessToken, cursor } = req.body || {};
  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken is required' });
  }
  try {
    const client = createPlaidClient();

    const syncRequest = { access_token: accessToken };
    if (cursor) {
      syncRequest.cursor = cursor;
    }

    const txnResponse = await client.transactionsSync(syncRequest);
    const balanceResponse = await client.accountsBalanceGet({ access_token: accessToken });

    return res.status(200).json({
      transactions: txnResponse.data.added,
      accounts: balanceResponse.data.accounts,
      nextCursor: txnResponse.data.next_cursor,
      hasMore: txnResponse.data.has_more,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch data' });
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd finance-tracker/backend && npx jest tests/fetch-data.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/backend/api/fetch-data.js finance-tracker/backend/tests/fetch-data.test.js
git commit -m "feat: add fetch-data endpoint"
```

---

### Task 6: Full suite green + sandbox smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd finance-tracker/backend && npm test`
Expected: All suites pass (plaidClient, create-link-token, exchange-token, fetch-data).

- [ ] **Step 2: Manual sandbox smoke test (optional, requires real Plaid sandbox keys)**

Create a local `.env` (copied from `.env.example`) with sandbox credentials from
the Plaid dashboard. Run the dev server: `npx vercel dev`. From another terminal:

```bash
curl -X POST http://localhost:3000/api/create-link-token \
  -H "Content-Type: application/json" \
  -d '{"userId":"smoke-test-user"}'
```

Expected: JSON `{ "linkToken": "link-sandbox-..." }`. This confirms env wiring;
skip if sandbox keys aren't available yet (unit tests already prove the logic).

- [ ] **Step 3: Commit (only if any fixes were needed)**

```bash
git add -A finance-tracker/backend
git commit -m "test: verify full backend suite passes"
```

---

## Self-Review

**Spec coverage:** The spec's serverless function requires three jobs — create
Link token (Task 3), exchange public token (Task 4), proxy data fetch (Task 5).
All covered. Secret-stays-server-side is satisfied (secret only in
`plaidClient.js` via env vars; never returned to client). Access-token-passed-
per-request is satisfied in Task 5.

**Placeholder scan:** No TBD/TODO. Every code step has complete code; every test
step has full assertions; every run step has the command and expected result.

**Type consistency:** Response shapes are consistent — `linkToken`,
`accessToken`/`itemId`, and `transactions`/`accounts`/`nextCursor`/`hasMore`
match between each handler and its test. `createPlaidClient` is named identically
in the factory, all handlers, and all mocks.

**Out of scope (handled in later plans):** Persisting the access token (iOS app,
Plan 2/3), encryption at rest (CloudKit, Plan 3), and the LinkKit UI flow (Plan 3).
