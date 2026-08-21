# Neom Modular — Purchase Order System

Internal purchase-order tracking for Neom Modular Pvt Ltd. Static front end on
Firebase Hosting, Cloud Firestore for data, Firebase Auth for sign-in, and
Firestore Security Rules as the authorization boundary.

There is no application server. **Every authorization decision lives in
[`firestore.rules`](firestore.rules)** — read that file before changing anything
that touches permissions.

---

## Order lifecycle

| Status | Meaning | Who moves it here |
|---|---|---|
| `requirement` | Operator has requested materials; no vendor or pricing yet | Operator, Admin |
| `draft` | Admin started a full PO but has not placed it | Admin |
| `pending` | Order placed with a vendor, awaiting delivery | Purchase Manager, Admin |
| `partial` | Some but not all items received | Inward Manager, Admin |
| `received` | All items received, awaiting sign-off | Inward Manager, Admin |
| `complete` | Order closed out | Purchase Manager, Admin |

| Role | Can do |
|---|---|
| **Admin** | Everything: create full POs, manage users and the item catalog, delete (soft) any order, read the audit log |
| **Operator** | Submit a material requirement (items + note). No vendor, no pricing |
| **Purchase Manager** | Price a requirement, choose a vendor and place it; mark received orders complete; manage the item catalog |
| **Inward Manager** | View placed orders and record what arrived, in full or in part |

---

## Prerequisites

- Node.js 20 or newer
- A Firebase project on the **Spark (free)** plan — no billing card needed
- `npm install` (installs `firebase-tools` locally; no global install required)

---

## One-time Firebase setup

1. **Create the project** in the [Firebase console](https://console.firebase.google.com).
2. **Enable Authentication → Sign-in method → Email/Password.**
3. **Create a Firestore database** (production mode; the rules in this repo
   replace the defaults on first deploy).
4. **Register a Web app** and copy its config into `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

   Fill in every `VITE_FIREBASE_*` value from
   *Project settings → Your apps → SDK setup and configuration*.

   These values are not secrets — they ship inside the client bundle. Security
   comes from the rules, not from hiding the config.

5. **Set the project id** in [`.firebaserc`](.firebaserc) to match.
6. **Deploy rules and indexes** before anyone signs in:

   ```bash
   npx firebase deploy --only firestore:rules,firestore:indexes
   ```

---

## Creating the first admin

There is a deliberate chicken-and-egg here: the rules forbid a user from giving
themselves a role, so the very first admin cannot be created from inside the app.
Do it once, by hand:

1. **Firebase console → Authentication → Users → Add user.** Enter an email and
   password. If the person has no real email, use the synthetic form
   `admin@neommodular.local` — matching `VITE_LOGIN_DOMAIN` in `.env.local`.
2. Copy the **User UID** from that row.
3. **Firebase console → Firestore → Start collection `users`**, document ID = the
   UID you copied, with these fields:

   | Field | Type | Value |
   |---|---|---|
   | `name` | string | e.g. `System Admin` |
   | `loginId` | string | e.g. `admin` |
   | `email` | string | the email from step 1, lowercase |
   | `role` | string | `admin` |
   | `active` | boolean | `true` |

That account can now sign in and manage everyone else from the app.

## Creating everyone else

1. **Firebase console → Authentication → Add user** — email (real or synthetic)
   and a starting password. Hand the credentials to the person.
2. They **sign in once**. The app creates their profile automatically with
   `role: pending`, `active: false`, and shows them a "waiting for an
   administrator" screen. This grants no access to anything.
3. An **admin opens *User accounts*** in the app, sets their name, assigns a
   role, and activates them.

**Passwords** are reset from the Firebase console
(*Authentication → ⋮ → Reset password*), as is removing a credential outright.
The app itself can only deactivate an account — which is a harder lock, since
every rule requires `active == true`.

### Signing in

The login field accepts either form:

- `ananya.r` → the app appends `VITE_LOGIN_DOMAIN` → `ananya.r@neommodular.local`
- `ananya@neommodular.com` → contains `@`, used as-is

---

## Local development

Against the live project:

```bash
npm install
npm run dev
```

Against the local emulators, with throwaway accounts for all four roles — no
Firebase project touched, nothing to set up by hand:

```bash
npm run emulators
```

then, in a second terminal:

```bash
npm run seed
npm run dev:emulator
```

`npm run seed` creates one account per role plus a few catalog items. It refuses
to run unless the emulator environment variables point at localhost, so these
passwords can never reach production.

| Login ID | Password | Role |
|---|---|---|
| `admin` | `admin123` | Admin |
| `operator` | `oper123` | Operator |
| `purchase` | `pur123` | Purchase Manager |
| `inward` | `inw123` | Inward Manager |

Emulator UI is at http://127.0.0.1:4000.

---

## Tests

```bash
npm test          # unit: status machine, permissions, formatters
npm run test:rules  # security rules against the Firestore emulator
npm run build       # type-check + production build
```

The rules suite is the important one. It asserts, for every role and every
status transition, both what is allowed and what is denied.

---

## Deploy

```bash
npm run deploy
```

Runs the type-check and build, then ships the bundle, the rules, and the
indexes together. To ship only part of it:

```bash
npx firebase deploy --only hosting
npx firebase deploy --only firestore:rules
```

---

## Design notes

**Concurrency.** PO numbers come from a `counters/orderSeq` document that the
rules only allow to move by exactly `+1`. Two people creating orders at the same
moment cannot both commit, so the loser's transaction retries and takes the next
number. Receipts re-read the order inside a transaction rather than trusting the
copy on screen, so two people receiving the same delivery both have their
quantities counted.

**Live updates** come from `onSnapshot` listeners, not polling.

**Nothing is hard-deleted.** Orders carry a `deleted` flag; catalog items are
disabled rather than removed so historical orders still resolve their items;
users are deactivated. The rules reject `delete` on every collection.

**The audit log is append-only.** Entries are written in the same transaction or
batch as the change they describe, so the log cannot drift from the data. Rules
require the entry to name the calling user at the current server time, so it
cannot be forged or back-dated, and reject all updates and deletes.

---

## Known limitations

- **No full-text search.** Firestore does not have it. PO number and vendor
  search are prefix matches; item search is an exact match. Because a prefix
  search must sort by the field being searched, a search cannot also apply a
  date range — the UI disables the date filter while searching. Fuzzy search
  would need Algolia or Typesense, which requires the Blaze plan.
- **Account creation and password resets happen in the Firebase console**, not
  in the app. Doing them in-app needs the Admin SDK, which needs Cloud
  Functions, which needs Blaze.
- **`total` is not verified against `items` by the rules.** Security rules
  cannot iterate an array, so an admin could write a total that disagrees with
  its line items. Every such write is recorded in the audit log.
- **No PO print or PDF export** for sending to vendors, and no GST/tax fields.
  Both are out of scope for v1.
