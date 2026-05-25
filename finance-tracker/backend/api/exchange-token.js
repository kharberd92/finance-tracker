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
