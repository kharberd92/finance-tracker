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
