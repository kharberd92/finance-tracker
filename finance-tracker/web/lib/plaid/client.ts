import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

/** Server-side Plaid client. Reads PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV from the env. */
export function createPlaidClient(): PlaidApi {
  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  })
  return new PlaidApi(config)
}
