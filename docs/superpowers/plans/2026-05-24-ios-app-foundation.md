# iOS App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **PLATFORM REQUIREMENT:** This plan builds a native iOS app. It **requires macOS with Xcode 15+** (SwiftData/SwiftUI/CloudKit are Apple-only). It also requires the **XcodeGen** tool (`brew install xcodegen`) to generate the Xcode project from `project.yml`. **This cannot be built or tested on Windows.** The build/test commands below must run on a Mac.

**Goal:** Stand up the iOS app foundation — an XcodeGen-defined SwiftUI project with the five SwiftData models, CloudKit-backed persistence, a 5-tab navigation shell, a working net-worth dashboard, and manual transaction entry.

**Architecture:** SwiftUI app, SwiftData for persistence with automatic CloudKit mirroring (via iCloud entitlements). Models are plain `@Model` classes designed to satisfy CloudKit's constraints (all stored properties have defaults; relationships are optional; no unique constraints). Cross-model logic (net worth) lives in a pure, independently testable enum. The project is generated from a declarative `project.yml` so it stays text-diffable.

**Tech Stack:** Swift 5.9, SwiftUI, SwiftData, CloudKit, XcodeGen, XCTest.

This is Plan 2 of 5 for the Personal Finance Tracker. It produces a runnable app (manual data entry + net worth) that Plan 3 extends with Plaid bank sync (consuming the backend from Plan 1).

---

## CloudKit Schema Rules (apply to every `@Model` in this plan)

SwiftData's CloudKit mirroring imposes constraints. Every model in this plan MUST follow them, or the `ModelContainer` will throw at launch:

1. **Every stored property has a default value or is optional.** (CloudKit has no non-null guarantee.)
2. **Relationships are optional** (`var x: [T]? = []` or `var y: T?`).
3. **No `@Attribute(.unique)`** — unique constraints are unsupported with CloudKit.
4. **No `.deny`/`.noAction` delete rules across the boundary** — use `.cascade` or `.nullify`.

---

## File Structure

All paths are relative to the repository root (`C:\Users\kharb`), under `finance-tracker/ios/`.

- `finance-tracker/ios/project.yml` — XcodeGen project definition (targets, entitlements, Info.plist)
- `finance-tracker/ios/Sources/App/FinanceTrackerApp.swift` — `@main` app entry, builds the CloudKit `ModelContainer`
- `finance-tracker/ios/Sources/App/RootTabView.swift` — 5-tab `TabView`
- `finance-tracker/ios/Sources/Models/AccountType.swift` — account-type enum
- `finance-tracker/ios/Sources/Models/BillFrequency.swift` — bill-frequency enum
- `finance-tracker/ios/Sources/Models/Account.swift` — `@Model`
- `finance-tracker/ios/Sources/Models/Transaction.swift` — `@Model`
- `finance-tracker/ios/Sources/Models/Budget.swift` — `@Model`
- `finance-tracker/ios/Sources/Models/Bill.swift` — `@Model`
- `finance-tracker/ios/Sources/Models/Goal.swift` — `@Model`
- `finance-tracker/ios/Sources/Logic/NetWorthCalculator.swift` — pure net-worth logic
- `finance-tracker/ios/Sources/Views/DashboardView.swift` — net-worth hero dashboard
- `finance-tracker/ios/Sources/Views/TransactionsView.swift` — transaction list
- `finance-tracker/ios/Sources/Views/AddTransactionView.swift` — manual entry form
- `finance-tracker/ios/Sources/Views/BudgetsView.swift` — placeholder (filled in Plan 4)
- `finance-tracker/ios/Sources/Views/GoalsView.swift` — placeholder (filled in Plan 4)
- `finance-tracker/ios/Sources/Views/MoreView.swift` — placeholder (filled in Plans 3/4)
- `finance-tracker/ios/Tests/ModelSchemaTests.swift` — in-memory schema round-trip
- `finance-tracker/ios/Tests/NetWorthCalculatorTests.swift` — net-worth unit tests

Each Models file holds one entity. Logic is isolated from SwiftData so it tests without a container. Views are one screen per file.

---

### Task 0: XcodeGen scaffold

**Files:**
- Create: `finance-tracker/ios/project.yml`
- Create: `finance-tracker/ios/Sources/App/FinanceTrackerApp.swift`
- Modify: `.gitignore` (repo root)

- [ ] **Step 1: Add iOS ignores to the root `.gitignore`**

Append these lines to `.gitignore` (keep the existing content; XcodeGen regenerates the `.xcodeproj`, so it is not tracked):

```gitignore
finance-tracker/ios/FinanceTracker.xcodeproj/
finance-tracker/ios/DerivedData/
finance-tracker/ios/.build/
**/*.xcuserstate
.DS_Store
```

- [ ] **Step 2: Create `finance-tracker/ios/project.yml`**

```yaml
name: FinanceTracker
options:
  bundleIdPrefix: com.kharberd.financetracker
  deploymentTarget:
    iOS: "17.0"
settings:
  base:
    SWIFT_VERSION: "5.9"
    GENERATE_INFOPLIST_FILE: YES
    MARKETING_VERSION: "1.0"
    CURRENT_PROJECT_VERSION: "1"
    DEVELOPMENT_TEAM: ""
    CODE_SIGN_STYLE: Automatic
targets:
  FinanceTracker:
    type: application
    platform: iOS
    sources:
      - path: Sources
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.kharberd.financetracker
        INFOPLIST_KEY_UILaunchScreen_Generation: YES
    entitlements:
      path: Sources/App/FinanceTracker.entitlements
      properties:
        com.apple.developer.icloud-container-identifiers:
          - iCloud.com.kharberd.financetracker
        com.apple.developer.icloud-services:
          - CloudKit
    info:
      path: Sources/App/Info.plist
      properties:
        UIBackgroundModes:
          - remote-notification
  FinanceTrackerTests:
    type: bundle.unit-test
    platform: iOS
    sources:
      - path: Tests
    dependencies:
      - target: FinanceTracker
```

> Note: `DEVELOPMENT_TEAM` is blank. The **unit-test target builds and runs on the simulator without a team**. Running the **app** with live CloudKit requires setting your Apple Developer Team in Xcode (Signing & Capabilities) — do that manually when you first run on device/simulator. The tests in this plan use an in-memory store and need no signing.

- [ ] **Step 3: Create the minimal app entry `finance-tracker/ios/Sources/App/FinanceTrackerApp.swift`**

```swift
import SwiftUI

@main
struct FinanceTrackerApp: App {
    var body: some Scene {
        WindowGroup {
            Text("FinanceTracker")
        }
    }
}
```

- [ ] **Step 4: Generate the project and build**

Run (on macOS):
```bash
cd finance-tracker/ios
xcodegen generate
xcodebuild -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 15' build
```
Expected: `xcodegen` reports "Created project at .../FinanceTracker.xcodeproj"; `xcodebuild` ends with `** BUILD SUCCEEDED **`. (If "iPhone 15" isn't an available simulator, substitute any installed iPhone simulator name from `xcrun simctl list devices`.)

- [ ] **Step 5: Commit**

```bash
git add .gitignore finance-tracker/ios/project.yml finance-tracker/ios/Sources/App/FinanceTrackerApp.swift
git commit -m "chore: scaffold iOS app with XcodeGen"
```

---

### Task 1: Enums and SwiftData models

**Files:**
- Create: `finance-tracker/ios/Sources/Models/AccountType.swift`
- Create: `finance-tracker/ios/Sources/Models/BillFrequency.swift`
- Create: `finance-tracker/ios/Sources/Models/Account.swift`
- Create: `finance-tracker/ios/Sources/Models/Transaction.swift`
- Create: `finance-tracker/ios/Sources/Models/Budget.swift`
- Create: `finance-tracker/ios/Sources/Models/Bill.swift`
- Create: `finance-tracker/ios/Sources/Models/Goal.swift`
- Test: `finance-tracker/ios/Tests/ModelSchemaTests.swift`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/ios/Tests/ModelSchemaTests.swift`:

```swift
import XCTest
import SwiftData
@testable import FinanceTracker

final class ModelSchemaTests: XCTestCase {
    @MainActor
    func testContainerBuildsAndRoundTripsEveryModel() throws {
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        let container = try ModelContainer(
            for: Account.self, Transaction.self, Budget.self, Bill.self, Goal.self,
            configurations: config
        )
        let context = container.mainContext

        let account = Account(name: "Checking", type: .checking, currentBalance: 1000, institutionName: "Test Bank")
        let txn = Transaction(amount: 12.50, merchantName: "Coffee", category: "Dining", isManual: true, account: account)
        context.insert(account)
        context.insert(txn)
        context.insert(Budget(category: "Dining", monthlyLimit: 300))
        context.insert(Bill(name: "Rent", amount: 1500, dueDay: 1, frequency: .monthly))
        context.insert(Goal(name: "Emergency Fund", targetAmount: 10000, currentAmount: 2500))
        try context.save()

        XCTAssertEqual(try context.fetch(FetchDescriptor<Account>()).count, 1)
        XCTAssertEqual(try context.fetch(FetchDescriptor<Transaction>()).first?.account?.name, "Checking")
        XCTAssertEqual(try context.fetch(FetchDescriptor<Budget>()).first?.monthlyLimit, 300)
        XCTAssertEqual(try context.fetch(FetchDescriptor<Bill>()).first?.frequency, .monthly)
        XCTAssertEqual(try context.fetch(FetchDescriptor<Goal>()).first?.currentAmount, 2500)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd finance-tracker/ios && xcodegen generate && xcodebuild test -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:FinanceTrackerTests/ModelSchemaTests`
Expected: FAIL — compilation error, `cannot find 'Account' in scope` (models don't exist yet).

- [ ] **Step 3: Create `AccountType.swift`**

```swift
import Foundation

enum AccountType: String, Codable, CaseIterable {
    case checking
    case savings
    case credit
    case investment

    /// Credit accounts are liabilities; all others are assets.
    var isLiability: Bool { self == .credit }

    var displayName: String {
        switch self {
        case .checking: return "Checking"
        case .savings: return "Savings"
        case .credit: return "Credit"
        case .investment: return "Investment"
        }
    }
}
```

- [ ] **Step 4: Create `BillFrequency.swift`**

```swift
import Foundation

enum BillFrequency: String, Codable, CaseIterable {
    case weekly
    case monthly
    case quarterly
    case yearly

    var displayName: String {
        switch self {
        case .weekly: return "Weekly"
        case .monthly: return "Monthly"
        case .quarterly: return "Quarterly"
        case .yearly: return "Yearly"
        }
    }
}
```

- [ ] **Step 5: Create `Account.swift`**

```swift
import Foundation
import SwiftData

@Model
final class Account {
    var name: String = ""
    var type: AccountType = AccountType.checking
    var currentBalance: Decimal = 0
    var institutionName: String = ""
    var plaidAccountId: String?
    var encryptedPlaidAccessToken: Data?

    @Relationship(deleteRule: .cascade, inverse: \Transaction.account)
    var transactions: [Transaction]? = []

    init(
        name: String = "",
        type: AccountType = .checking,
        currentBalance: Decimal = 0,
        institutionName: String = "",
        plaidAccountId: String? = nil,
        encryptedPlaidAccessToken: Data? = nil
    ) {
        self.name = name
        self.type = type
        self.currentBalance = currentBalance
        self.institutionName = institutionName
        self.plaidAccountId = plaidAccountId
        self.encryptedPlaidAccessToken = encryptedPlaidAccessToken
    }
}
```

- [ ] **Step 6: Create `Transaction.swift`**

```swift
import Foundation
import SwiftData

@Model
final class Transaction {
    var amount: Decimal = 0
    var date: Date = Date.now
    var merchantName: String = ""
    var category: String = ""
    var notes: String = ""
    var isManual: Bool = false
    var account: Account?

    init(
        amount: Decimal = 0,
        date: Date = .now,
        merchantName: String = "",
        category: String = "",
        notes: String = "",
        isManual: Bool = false,
        account: Account? = nil
    ) {
        self.amount = amount
        self.date = date
        self.merchantName = merchantName
        self.category = category
        self.notes = notes
        self.isManual = isManual
        self.account = account
    }
}
```

- [ ] **Step 7: Create `Budget.swift`**

```swift
import Foundation
import SwiftData

@Model
final class Budget {
    var category: String = ""
    var monthlyLimit: Decimal = 0

    init(category: String = "", monthlyLimit: Decimal = 0) {
        self.category = category
        self.monthlyLimit = monthlyLimit
    }
}
```

- [ ] **Step 8: Create `Bill.swift`**

```swift
import Foundation
import SwiftData

@Model
final class Bill {
    var name: String = ""
    var amount: Decimal = 0
    var dueDay: Int = 1
    var frequency: BillFrequency = BillFrequency.monthly
    var category: String = ""
    var isPaid: Bool = false

    init(
        name: String = "",
        amount: Decimal = 0,
        dueDay: Int = 1,
        frequency: BillFrequency = .monthly,
        category: String = "",
        isPaid: Bool = false
    ) {
        self.name = name
        self.amount = amount
        self.dueDay = dueDay
        self.frequency = frequency
        self.category = category
        self.isPaid = isPaid
    }
}
```

- [ ] **Step 9: Create `Goal.swift`**

```swift
import Foundation
import SwiftData

@Model
final class Goal {
    var name: String = ""
    var targetAmount: Decimal = 0
    var currentAmount: Decimal = 0
    var targetDate: Date?
    var icon: String = "star.fill"
    var colorHex: String = "#4EA1FF"

    init(
        name: String = "",
        targetAmount: Decimal = 0,
        currentAmount: Decimal = 0,
        targetDate: Date? = nil,
        icon: String = "star.fill",
        colorHex: String = "#4EA1FF"
    ) {
        self.name = name
        self.targetAmount = targetAmount
        self.currentAmount = currentAmount
        self.targetDate = targetDate
        self.icon = icon
        self.colorHex = colorHex
    }
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `cd finance-tracker/ios && xcodegen generate && xcodebuild test -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:FinanceTrackerTests/ModelSchemaTests`
Expected: PASS — `Test Suite 'ModelSchemaTests' passed`.

- [ ] **Step 11: Commit**

```bash
git add finance-tracker/ios/Sources/Models/ finance-tracker/ios/Tests/ModelSchemaTests.swift
git commit -m "feat: add SwiftData models and enums"
```

---

### Task 2: Net worth calculator

**Files:**
- Create: `finance-tracker/ios/Sources/Logic/NetWorthCalculator.swift`
- Test: `finance-tracker/ios/Tests/NetWorthCalculatorTests.swift`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/ios/Tests/NetWorthCalculatorTests.swift`:

```swift
import XCTest
@testable import FinanceTracker

final class NetWorthCalculatorTests: XCTestCase {
    func testNetWorthIsZeroForNoAccounts() {
        XCTAssertEqual(NetWorthCalculator.netWorth(accounts: []), 0)
    }

    func testNetWorthSumsAssetBalances() {
        let accounts = [
            Account(name: "Checking", type: .checking, currentBalance: 1000),
            Account(name: "Savings", type: .savings, currentBalance: 5000),
            Account(name: "Brokerage", type: .investment, currentBalance: 4000),
        ]
        XCTAssertEqual(NetWorthCalculator.netWorth(accounts: accounts), 10000)
    }

    func testNetWorthSubtractsCreditLiabilities() {
        let accounts = [
            Account(name: "Checking", type: .checking, currentBalance: 2000),
            Account(name: "Card", type: .credit, currentBalance: 500),
        ]
        XCTAssertEqual(NetWorthCalculator.netWorth(accounts: accounts), 1500)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd finance-tracker/ios && xcodegen generate && xcodebuild test -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:FinanceTrackerTests/NetWorthCalculatorTests`
Expected: FAIL — `cannot find 'NetWorthCalculator' in scope`.

- [ ] **Step 3: Write minimal implementation**

Create `finance-tracker/ios/Sources/Logic/NetWorthCalculator.swift`:

```swift
import Foundation

enum NetWorthCalculator {
    /// Net worth = sum of asset balances minus sum of liability balances.
    static func netWorth(accounts: [Account]) -> Decimal {
        accounts.reduce(Decimal.zero) { total, account in
            account.type.isLiability
                ? total - account.currentBalance
                : total + account.currentBalance
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd finance-tracker/ios && xcodegen generate && xcodebuild test -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:FinanceTrackerTests/NetWorthCalculatorTests`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/ios/Sources/Logic/NetWorthCalculator.swift finance-tracker/ios/Tests/NetWorthCalculatorTests.swift
git commit -m "feat: add net worth calculator"
```

---

### Task 3: App container and tab shell

**Files:**
- Modify: `finance-tracker/ios/Sources/App/FinanceTrackerApp.swift`
- Create: `finance-tracker/ios/Sources/App/RootTabView.swift`
- Create: `finance-tracker/ios/Sources/Views/DashboardView.swift` (stub)
- Create: `finance-tracker/ios/Sources/Views/TransactionsView.swift` (stub)
- Create: `finance-tracker/ios/Sources/Views/BudgetsView.swift` (stub)
- Create: `finance-tracker/ios/Sources/Views/GoalsView.swift` (stub)
- Create: `finance-tracker/ios/Sources/Views/MoreView.swift` (stub)

This task has no unit test — it is verified by a successful build (the model layer is already covered by tests). Stubs let the project compile; Tasks 4–5 replace Dashboard and Transactions with real implementations.

- [ ] **Step 1: Replace `FinanceTrackerApp.swift` with the CloudKit container**

```swift
import SwiftUI
import SwiftData

@main
struct FinanceTrackerApp: App {
    let container: ModelContainer

    init() {
        do {
            // With the iCloud entitlement present, SwiftData mirrors this
            // store to the user's private CloudKit database automatically.
            container = try ModelContainer(
                for: Account.self, Transaction.self, Budget.self, Bill.self, Goal.self
            )
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
        }
        .modelContainer(container)
    }
}
```

- [ ] **Step 2: Create `RootTabView.swift`**

```swift
import SwiftUI

struct RootTabView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Home", systemImage: "square.grid.2x2.fill") }
            TransactionsView()
                .tabItem { Label("Transactions", systemImage: "list.bullet") }
            BudgetsView()
                .tabItem { Label("Budgets", systemImage: "chart.pie.fill") }
            GoalsView()
                .tabItem { Label("Goals", systemImage: "target") }
            MoreView()
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
    }
}
```

- [ ] **Step 3: Create the five stub views**

`finance-tracker/ios/Sources/Views/DashboardView.swift`:
```swift
import SwiftUI

struct DashboardView: View {
    var body: some View {
        NavigationStack {
            Text("Dashboard")
                .navigationTitle("Home")
        }
    }
}
```

`finance-tracker/ios/Sources/Views/TransactionsView.swift`:
```swift
import SwiftUI

struct TransactionsView: View {
    var body: some View {
        NavigationStack {
            Text("Transactions")
                .navigationTitle("Transactions")
        }
    }
}
```

`finance-tracker/ios/Sources/Views/BudgetsView.swift`:
```swift
import SwiftUI

struct BudgetsView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("No Budgets Yet", systemImage: "chart.pie", description: Text("Budget tracking arrives in a later update."))
                .navigationTitle("Budgets")
        }
    }
}
```

`finance-tracker/ios/Sources/Views/GoalsView.swift`:
```swift
import SwiftUI

struct GoalsView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("No Goals Yet", systemImage: "target", description: Text("Goal tracking arrives in a later update."))
                .navigationTitle("Goals")
        }
    }
}
```

`finance-tracker/ios/Sources/Views/MoreView.swift`:
```swift
import SwiftUI

struct MoreView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Accounts") {
                    Text("Linked accounts arrive with bank sync.")
                        .foregroundStyle(.secondary)
                }
                Section("About") {
                    LabeledContent("Version", value: "1.0")
                }
            }
            .navigationTitle("More")
        }
    }
}
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd finance-tracker/ios && xcodegen generate && xcodebuild -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 15' build`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/ios/Sources/App/ finance-tracker/ios/Sources/Views/
git commit -m "feat: add CloudKit container and 5-tab shell"
```

---

### Task 4: Dashboard — net worth hero

**Files:**
- Modify: `finance-tracker/ios/Sources/Views/DashboardView.swift`

Wires the dashboard to live SwiftData via `@Query` and the `NetWorthCalculator`. Matches the approved "net worth hero" layout: large net-worth figure, spent/income this month, recent transactions. Verified by build (the calculation itself is unit-tested in Task 2).

- [ ] **Step 1: Replace `DashboardView.swift`**

```swift
import SwiftUI
import SwiftData

struct DashboardView: View {
    @Query private var accounts: [Account]
    @Query(sort: \Transaction.date, order: .reverse) private var transactions: [Transaction]

    private var netWorth: Decimal {
        NetWorthCalculator.netWorth(accounts: accounts)
    }

    private var startOfMonth: Date {
        let comps = Calendar.current.dateComponents([.year, .month], from: .now)
        return Calendar.current.date(from: comps) ?? .now
    }

    private var spentThisMonth: Decimal {
        transactions
            .filter { $0.date >= startOfMonth && $0.amount < 0 }
            .reduce(Decimal.zero) { $0 + (-$1.amount) }
    }

    private var incomeThisMonth: Decimal {
        transactions
            .filter { $0.date >= startOfMonth && $0.amount > 0 }
            .reduce(Decimal.zero) { $0 + $1.amount }
    }

    private var recentTransactions: [Transaction] {
        Array(transactions.prefix(5))
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Net Worth")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                        Text(netWorth, format: .currency(code: "USD"))
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                    }
                    .padding(.vertical, 8)
                }

                Section {
                    HStack {
                        statTile(title: "Spent", value: spentThisMonth, tint: .red)
                        Divider()
                        statTile(title: "Income", value: incomeThisMonth, tint: .green)
                    }
                }

                Section("Recent") {
                    if recentTransactions.isEmpty {
                        Text("No transactions yet")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(recentTransactions) { txn in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(txn.merchantName.isEmpty ? "Transaction" : txn.merchantName)
                                    Text(txn.date, format: .dateTime.month().day())
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(txn.amount, format: .currency(code: "USD"))
                                    .foregroundStyle(txn.amount < 0 ? .red : .green)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Home")
        }
    }

    private func statTile(title: String, value: Decimal, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            Text(value, format: .currency(code: "USD"))
                .font(.headline)
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd finance-tracker/ios && xcodegen generate && xcodebuild -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 15' build`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Commit**

```bash
git add finance-tracker/ios/Sources/Views/DashboardView.swift
git commit -m "feat: add net worth hero dashboard"
```

---

### Task 5: Transactions list and manual entry

**Files:**
- Modify: `finance-tracker/ios/Sources/Views/TransactionsView.swift`
- Create: `finance-tracker/ios/Sources/Views/AddTransactionView.swift`

Replaces the transactions stub with a live list plus a sheet for manual entry. Manual entry writes a new `Transaction` to the SwiftData context (which syncs via CloudKit). Verified by build.

- [ ] **Step 1: Create `AddTransactionView.swift`**

```swift
import SwiftUI
import SwiftData

struct AddTransactionView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var accounts: [Account]

    @State private var merchantName: String = ""
    @State private var amountText: String = ""
    @State private var isExpense: Bool = true
    @State private var category: String = ""
    @State private var date: Date = .now
    @State private var selectedAccount: Account?

    private var parsedAmount: Decimal? {
        Decimal(string: amountText)
    }

    private var canSave: Bool {
        if let amount = parsedAmount, amount > 0 { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Merchant", text: $merchantName)
                    TextField("Amount", text: $amountText)
                        .keyboardType(.decimalPad)
                    Picker("Type", selection: $isExpense) {
                        Text("Expense").tag(true)
                        Text("Income").tag(false)
                    }
                    .pickerStyle(.segmented)
                    TextField("Category", text: $category)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                }

                if !accounts.isEmpty {
                    Section("Account") {
                        Picker("Account", selection: $selectedAccount) {
                            Text("None").tag(Account?.none)
                            ForEach(accounts) { account in
                                Text(account.name).tag(Account?.some(account))
                            }
                        }
                    }
                }
            }
            .navigationTitle("New Transaction")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!canSave)
                }
            }
        }
    }

    private func save() {
        guard let magnitude = parsedAmount else { return }
        let signed = isExpense ? -magnitude : magnitude
        let txn = Transaction(
            amount: signed,
            date: date,
            merchantName: merchantName,
            category: category,
            isManual: true,
            account: selectedAccount
        )
        context.insert(txn)
        dismiss()
    }
}
```

- [ ] **Step 2: Replace `TransactionsView.swift`**

```swift
import SwiftUI
import SwiftData

struct TransactionsView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Transaction.date, order: .reverse) private var transactions: [Transaction]
    @State private var showingAdd = false

    var body: some View {
        NavigationStack {
            Group {
                if transactions.isEmpty {
                    ContentUnavailableView(
                        "No Transactions",
                        systemImage: "list.bullet",
                        description: Text("Tap + to add one manually.")
                    )
                } else {
                    List {
                        ForEach(transactions) { txn in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(txn.merchantName.isEmpty ? "Transaction" : txn.merchantName)
                                    Text(txn.category.isEmpty ? txn.date.formatted(.dateTime.month().day()) : txn.category)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(txn.amount, format: .currency(code: "USD"))
                                    .foregroundStyle(txn.amount < 0 ? .red : .green)
                            }
                        }
                        .onDelete(perform: delete)
                    }
                }
            }
            .navigationTitle("Transactions")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingAdd = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAdd) {
                AddTransactionView()
            }
        }
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets {
            context.delete(transactions[index])
        }
    }
}
```

- [ ] **Step 3: Build to verify it compiles**

Run: `cd finance-tracker/ios && xcodegen generate && xcodebuild -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 15' build`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Commit**

```bash
git add finance-tracker/ios/Sources/Views/TransactionsView.swift finance-tracker/ios/Sources/Views/AddTransactionView.swift
git commit -m "feat: add transactions list and manual entry"
```

---

### Task 6: Full build and test verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd finance-tracker/ios && xcodegen generate && xcodebuild test -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 15'`
Expected: `** TEST SUCCEEDED **` — ModelSchemaTests (1) and NetWorthCalculatorTests (3) all pass.

- [ ] **Step 2: Manual smoke test in the simulator**

Run: `cd finance-tracker/ios && xcodebuild -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 15' build` then launch in Xcode (open `FinanceTracker.xcodeproj`, press Run). Verify:
- App launches showing 5 tabs.
- Transactions tab → "+" → enter a merchant, an amount, choose Expense, Save → the transaction appears in the list.
- Home tab → "Spent this month" reflects the entered expense; recent transaction shows.

> Note: live CloudKit sync requires setting your Apple Developer Team in Signing & Capabilities and being signed into iCloud on the simulator/device. Local persistence and all UI work without it.

- [ ] **Step 3: Commit (only if any fixes were needed)**

```bash
git add finance-tracker/ios
git commit -m "test: verify iOS foundation builds and tests pass"
```

---

## Self-Review

**Spec coverage (against the design spec):**
- SwiftData models for Account, Transaction, Budget, Bill, Goal → Task 1. All five present with the fields named in the spec.
- CloudKit sync → Task 3 (`ModelContainer` + iCloud entitlement in `project.yml`).
- Net worth computed (assets − liabilities) → Task 2.
- 5-tab navigation (Home/Transactions/Budgets/Goals/More) → Task 3.
- "Net worth hero" dashboard → Task 4.
- Manual transaction entry → Task 5.
- Budgets/Goals/Bills feature logic and the bills tracker UI are intentionally **deferred to Plan 4**; the Budget/Bill/Goal models exist now so the schema (and CloudKit container) is stable from the start. Plaid linking UI is **Plan 3**.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. The "stub" views in Task 3 are complete, compiling views (intentional foundation placeholders with real content), not plan placeholders.

**Type consistency:** `Account.type` (`AccountType`), `AccountType.isLiability`, `NetWorthCalculator.netWorth(accounts:)`, `Transaction.amount`/`.date`/`.merchantName`/`.category`/`.account`, `Bill.frequency` (`BillFrequency`) are used identically across models, logic, tests, and views. The five view type names (`DashboardView`, `TransactionsView`, `BudgetsView`, `GoalsView`, `MoreView`, `AddTransactionView`) match between their definitions and `RootTabView`/sheet references.

**Known execution constraints (not gaps):** Requires macOS + Xcode 15 + XcodeGen; the app target needs a Developer Team set for live CloudKit; simulator device name may need substitution. All flagged at the top and in the relevant steps.
