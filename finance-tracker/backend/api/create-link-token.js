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
