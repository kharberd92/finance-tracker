# Personal Finance Tracker — Design Spec

**Date:** 2026-05-24
**Platform:** iOS (iPhone), SwiftUI
**Status:** Approved design — ready for implementation planning

## Overview

A native iOS personal finance app covering the full money-management suite:
spending/expense tracking, budgets, net worth, bills & subscriptions, and
financial goals. Bank data is imported automatically via Plaid. All user data
is stored locally and synced across the user's devices through iCloud
(CloudKit). The only backend is a minimal serverless function required by
Plaid; no custom application server or database is operated.

## Goals

- Track spending and net worth automatically from linked bank accounts.
- Set and monitor monthly category budgets.
- Track recurring bills & subscriptions (what's due and when).
- Save toward financial goals with progress tracking.
- Keep all data in the Apple ecosystem (iCloud), private to the user.

## Non-Goals

- Android or web clients (iOS only).
- Multi-user / shared accounts (single-user, last-writer-wins sync is fine).
- Manual-first workflow (bank sync is the primary data source; manual entry
  exists as a supplement for cash or corrections).
- A full custom backend or hosted database.

## Architecture

Two components:

### 1. iOS App
- **UI:** SwiftUI.
- **Persistence:** SwiftData (local store).
- **Sync:** CloudKit via SwiftData's built-in CloudKit integration. Data syncs
  across the user's devices and survives reinstalls.
- **Bank linking UI:** Plaid iOS SDK (LinkKit) for the account-connection flow.

### 2. Serverless Function (Vercel, Node.js)
Plaid's API requires a secret key that must never be embedded in the client.
A single small serverless function exposes three endpoints:

1. **Create Link token** — returns a Link token for the Plaid LinkKit flow.
2. **Exchange public token** — exchanges the `public_token` returned by LinkKit
   for a Plaid `access_token`.
3. **Fetch data (proxy)** — given an encrypted access token from the client,
   calls Plaid (transactions, balances) using the server-held Plaid secret and
   returns the results.

The Plaid **secret key lives only in the serverless environment**. The Plaid
**access token** is stored encrypted in CloudKit (the user's private database,
encrypted at rest) and passed to the serverless function over HTTPS on each
sync request.

### Data Flow
1. User links a bank via Plaid LinkKit (app requests a Link token from the
   function).
2. LinkKit returns a `public_token`; the function exchanges it for an
   `access_token`.
3. The `access_token` is stored encrypted in CloudKit.
4. On sync (manual pull-to-refresh or app open), the app sends the encrypted
   access token to the function, which fetches transactions/balances from Plaid
   and returns them.
5. Results are written to SwiftData and synced across devices via CloudKit.

## Data Model

All entities are SwiftData models, CloudKit-synced.

- **Account** — `name`, `type` (checking / savings / credit / investment),
  `currentBalance`, `institutionName`, `plaidAccountId`,
  `encryptedPlaidAccessToken`.
- **Transaction** — `amount`, `date`, `merchantName`, `category`, `notes`,
  `isManual`, relationship → `Account`.
- **Budget** — `category`, `monthlyLimit`. "Spent this month" is computed from
  `Transaction`s, not stored.
- **Bill** — `name`, `amount`, `dueDay`, `frequency` (monthly / yearly / etc.),
  `category`, `isPaid`.
- **Goal** — `name`, `targetAmount`, `currentAmount`, `targetDate`, `icon`,
  `color`.

**Net worth** is computed (sum of asset-account balances minus
liability-account balances); no dedicated entity.

## Screens & Navigation

Five-tab bottom navigation: **Home · Transactions · Budgets · Goals · More**.

### Home (Dashboard) — "net worth hero" layout
- Large net-worth figure at the top with month-over-month delta.
- Quick stats: spent this month, income this month.
- Recent transactions list.
- Pull-to-refresh triggers a bank sync.

### Transactions
- Full list with search and filtering by account/category.
- Tap a transaction to edit its category or add notes.
- "+" button for manual transaction entry.

### Budgets
- List of category budgets with progress bars.
- Create/edit budgets.
- Visual alert when a category is near or over its limit.

### Goals
- Goal cards with progress rings.
- Create a goal, contribute toward it, view projected completion date.

### More
- Linked accounts: add (Plaid Link) / remove.
- Bills & subscriptions tracker (list, due dates, mark paid).
- Settings.

## Error Handling

- **Plaid connection failures:** show a clear retry banner; never crash.
  Trigger a re-auth flow when Plaid returns `ITEM_LOGIN_REQUIRED` (expired
  token).
- **Network / sync offline:** the app works fully offline against the cached
  SwiftData store; sync resumes automatically when connectivity returns.
  CloudKit handles merge conflicts with last-writer-wins (acceptable for a
  single user).
- **Serverless function unavailable:** bank sync degrades gracefully; manual
  entry and viewing existing data continue to work.

## Testing Strategy

- **Unit tests** for pure logic: net-worth calculation, budget "spent"
  rollups, goal projections, bill due-date logic.
- **Plaid integration** verified against Plaid's sandbox environment with test
  credentials.
- **UI:** SwiftUI previews for each screen; XCUITests for the two critical
  flows — add transaction and link account.

## Tech Stack Summary

| Concern            | Choice                                  |
|--------------------|-----------------------------------------|
| UI                 | SwiftUI                                 |
| Local persistence  | SwiftData                               |
| Cross-device sync  | CloudKit (via SwiftData integration)    |
| Bank linking UI    | Plaid iOS SDK (LinkKit)                 |
| Plaid API proxy    | Vercel serverless function (Node.js)    |
| Secret storage     | Plaid secret in serverless env; access  |
|                    | token encrypted in CloudKit             |

## Open Questions / Future Considerations

- Push notifications for upcoming bills and budget overages (future).
- Automatic transaction categorization improvements (Plaid provides categories;
  may want user-defined rules later).
- Investment holdings detail beyond balance (future).
