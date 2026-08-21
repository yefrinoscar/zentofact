# Stock-job identity convergence

## Problem

The stock queue accepts canonical `order_id` and legacy `(company_id, external_order_id)` identities. Two partial unique indexes allowed both representations of the same real order to coexist.

## Chosen shape

Keep `enqueueStockJob(input, db?)` as the only public enqueue boundary.

- A unique external match is promoted to canonical identity.
- Zero or multiple matches remain a retryable legacy job.
- A Pool gets a private transaction around resolution and convergence.
- A supplied client is required to be transaction-scoped.
- Historical canonical/legacy pairs preserve completed evidence and make the losing legacy row non-processable.
- The worker refuses a legacy row only when a unique matching order already has a canonical job.
- Falabella's long-running sync passes its Pool for stock enqueue, not its autocommit sync client.

## Synthesis decision

Arena selected central convergence over a separate signals table and resolver. The selected design hides identity policy behind the existing interface and keeps the incident rollout small. It grafted the alternative's consumer-boundary defense and real PostgreSQL invariant tests without adding another lifecycle or public API.

## Rejected alternative

A separate non-executable signal inbox would create a cleaner eventual model, but it requires a table, resolver timer, split enqueue APIs, caller migration, and coordinated rollout. A canonical-only worker was also rejected because it would strand missing and ambiguous legacy inputs without that full subsystem.

## Proven invariants

The PostgreSQL regression covers concurrent unique enqueue, missing and ambiguous fallback, in-place promotion, ambiguous identity with an existing canonical job, replayed startup, pending and completed duplicate histories, consumer defense, commit races, and query-error rollback without lock leakage.
