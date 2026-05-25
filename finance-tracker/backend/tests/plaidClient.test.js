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
