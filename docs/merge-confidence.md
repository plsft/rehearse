# Merge Confidence

Merge Confidence is a 0–100 score posted as a GitHub check run on every PR.
It's a weighted average of six components.

## Components

| Component | Default weight | What it measures |
| --- | ---: | --- |
| Test Health | 25% | CI status + coverage delta. |
| Scope Containment | 20% | Files changed vs the linked issue's expected scope. |
| Review Depth | 20% | Approvals + line-level comments + file coverage. |
| Agent Trust | 15% | The author agent's historical merge rate and CI first-pass rate. |
| Size Discipline | 10% | Total additions + deletions vs configurable thresholds. |
| Provenance Quality | 10% | For agent PRs: trigger event, context capture, iterations, chain validity. |

## Formulas

### Test Health (out of 100)

```
no CI               → 50
any failure         → 0
passed, no coverage → 70
passed + Δcov ≥ 0   → 70 + min(30, Δcov × 10)
passed + Δcov < 0   → max(0, 70 + Δcov × 5)
```

### Scope Containment

With a linked issue and `scope_mappings`:

```
in_scope_files / total_files × 100
```

Without mappings — based on number of distinct top-level dirs touched:

```
1 dir         → 100
2–3 dirs      → 80
4–6 dirs      → 60
7+ dirs       → max(20, 80 − dirs × 5)
```

A 10-point penalty applies when there's no linked issue.

### Review Depth

```
no reviews                → 0
approved, no comments     → 40
approved + comments       → 40 + min(60, comments × 5 + file_coverage × 30)
changes_requested         → max(current − 20, 0)
```

### Agent Trust

```
not agent-authored        → 100
agent < 5 PRs of history  → 50
agent with history        → mergeRate × 40 + avgReviewDepth × 0.3 + ciFirstPassRate × 30
```

### Size Discipline

```
total = additions + deletions
≤ excellent (200)         → 100
≤ good (500)              → 80
≤ acceptable (1000)       → 50
> acceptable              → max(0, 50 − (total − acceptable) / 100)
```

### Provenance Quality

```
not agent-authored        → 100
agent: 25 each for hasTrigger, hasContext, hasIterations, chainValid
```

## Weights

Configure in `.gitgate.yml`:

```yaml
version: 1
confidence:
  weights:
    test_health: 30
    scope_containment: 20
    review_depth: 25
    agent_trust: 10
    size_discipline: 5
    provenance_quality: 10
```

Weights need not sum to 100; GitGate normalises them.

## Branch protection

The check run is named `gitgate/merge-confidence`. Add it to your branch
protection rules to require a passing score.

When `confidence.minimum_score` is configured the check uses:

- `success` if `overall ≥ minimum`
- `failure` if `overall < minimum`
- `neutral` otherwise (informational only)

## Recompute triggers

GitGate recomputes the score on:

- `pull_request.opened` / `reopened` / `synchronize`
- `pull_request_review.submitted`
- `check_run.completed`

The latest score is what you see; historical scores are kept in D1 for the
leaderboard and analytics.
