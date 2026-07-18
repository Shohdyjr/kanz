# Kanz — Core Architecture Principles

Kanz is a Wealth Tracker, not an accounting system. These principles exist to
keep it that way as the app grows. Any future feature should be checked
against them before it's built.

## 1. Portfolio is the Source of Truth

`qty` (in `kanz_users.data`) is the current state of the user's wealth. It is
never derived by replaying a history of events — it simply *is* what it is,
read and written directly. Everything else (Snapshots, Activities, Item
History, Analytics) exists to explain or derive from that state, never to
produce it.

## 2. Facts over Interpretations

Kanz stores facts: Portfolio state, Snapshots (`history[]`), Activities
(`contributions[]`, generalized), Item History (`item_history[]`), and market
prices/FX rates. Everything else — attribution, performance, trends, reports
— is an *interpretation*, computed at read time from those facts.

An interpretation is only valid if it can be computed from recorded facts
using arithmetic (or an explicit fact the user recorded at the moment of
acting). If answering a question would require inventing an allocation
convention (FIFO, pro-rata, similarity-based matching, or any other rule not
represented by a recorded fact), Kanz does not attempt it — it reports
**"Unattributed"** instead of manufacturing certainty. See
`backend/lib/attribution.js` for the concrete implementation of this rule.

## 3. Activities Describe User Intent

An Activity is a fact about one atomic action the user took: Salary, Deposit,
Withdrawal, Buy, Sell, Transfer, or Correction (see `docs/js/activities.js`).
Activities explain *why* Portfolio state changed — they never determine it.
If every Activity were deleted, Portfolio state would be exactly as correct
as before, just less explainable. That's the test for whether something has
quietly become a ledger: **can the system lose this data and still be
correct, just less narratable?** For Activities, yes.

## 4. No Money Identity or Lineage

This is a **structural constraint, not a policy**. Money has no persistent
identity — currency is fungible, so "which salary funded this investment" has
no objective answer, only an invented one.

- Activities must never reference another Activity as their origin, cause,
  or source of funds.
- There is no `sourceActivityId`. There is no `threadId`. There is no
  lineage or provenance field anywhere in the schema, and none should ever
  be added.
- The only relationships an Activity may express are those **intrinsic to
  the single action it represents**: a Transfer's `fromItemId`/`toItemId`, a
  Buy/Sell's `assetItemId`/`fundingItemId`. These are attributes of one fact,
  not references to a different, separately-recorded fact.

## 5. Friction Only When Ambiguity Is Genuine

Never ask the user to classify something after the fact. Instead, let intent
come from the action itself: Deposit, Withdraw, Buy, Sell, Transfer, and
Correction are distinct entry points (`openActivityModal(kind)`), not a
single generic "edit balance" form with a follow-up question. "Edit Balance"
(a plain `setQty` call) remains available as an honest, no-shame fallback for
quick corrections — it is deliberately the narrowest, least prominent option,
not the default path.

## 6. Single Responsibility for Every Domain Object

| Model | Responsibility |
|---|---|
| Portfolio (`data.qty`) | Current state |
| Snapshots (`history[]`) | Historical state |
| Activities (`contributions[]`) | User intent |
| Item History (`item_history[]`) | System-generated (interest) growth |
| Analytics (`lib/attribution.js`) | Derived interpretation |

If any model starts serving multiple unrelated responsibilities, that's an
architectural smell — stop and reconsider before extending it.

---

## Wealth Attribution — how the six categories map to facts

See `backend/lib/attribution.js` (`computeAttribution`) for the full
implementation. Summary:

| Category | Derived from |
|---|---|
| External Cash Flow | Activities of type `salary`/`deposit`/`withdrawal` (and legacy `income`/`expense`), summed |
| Investment Income | `item_history[]` (cron-posted interest), converted to USD |
| Market Revaluation | Snapshot-to-snapshot native-quantity × price decomposition (gold's own USD price move) |
| FX Gain/Loss | Same decomposition, isolating the EGP/EUR/SAR-vs-USD component |
| Other Balance Changes | Activities of type `buy`/`sell`/`transfer`/`correction`, summed — deliberately **not** traced further (principle 4) |
| Unattributed | Whatever remains — untagged manual edits, or snapshots that predate `nativeTotals`/`ratesUsed` and can't be decomposed. Always reported explicitly, never folded into another category. |

The five categories plus Unattributed always sum to exactly
`totalUsd(to) − totalUsd(from)`.
