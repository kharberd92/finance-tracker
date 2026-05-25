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
