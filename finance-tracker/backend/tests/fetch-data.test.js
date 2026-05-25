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
