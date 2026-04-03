# Debug Investigation Template

Use this file as the canonical record for one issue. Keep all updates in chronological order.

## 1) Metadata

- Title:
- Owner:
- Date opened:
- Environment: (prod/staging/local)
- Service/component:
- Version/commit:
- Severity:
- Status: (`investigating` | `mitigated` | `fixed` | `closed`)

## 2) Problem Definition

- Symptom:
- Expected behavior:
- Actual behavior:
- Scope/impact:
- First observed timestamp:
- Related ticket/incident:

## 3) Reproduction

- Preconditions:
- Steps:
1.
2.
3.
- Repro rate: (`always` | `intermittent` | `%`)
- Automation status: (`failing test` | `manual only` | `scripted`)

## 4) Evidence

- Error messages / stack traces:
- Logs/metrics/traces:
- Correlation/request IDs:
- Timeline (timestamped):
1.
2.
3.

## 5) Hypotheses

| ID | Hypothesis | Evidence for | Evidence against | Status |
|----|------------|--------------|------------------|--------|
| H1 |            |              |                  | open   |

## 6) Experiment Log

Record one variable change per experiment.

| Time | Hypothesis ID | Change made | Predicted outcome | Actual outcome | Conclusion | Next action |
|------|---------------|-------------|-------------------|----------------|------------|-------------|
|      |               |             |                   |                |            |             |

## 7) Root Cause

- Root cause statement:
- Causal chain:
1.
2.
3.
- Why safeguards failed:

## 8) Mitigation and Fix Plan

- Mitigation (if incident):
- Rollback criteria:
- Permanent fix:
- Risks/tradeoffs:

## 9) Verification

- Reproduction no longer fails:
- Failing test now passes:
- Regression tests run:
- Production validation checks:
- Done criteria:

## 10) Prevention

- Tests added:
- Monitoring/alerting improvements:
- Documentation/runbook updates:
