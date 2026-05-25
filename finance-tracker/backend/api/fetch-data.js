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
