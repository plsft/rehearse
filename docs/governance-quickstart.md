# Governance Quickstart

Thirty seconds from install to your first Merge Confidence score.

## 1. Install the GitHub App

Visit <https://github.com/apps/gitgate> and grant access to the repos you want
to monitor. The app needs:

- Pull requests: read & write (labels, comments)
- Checks: write (Merge Confidence check run)
- Contents: read (`.gitgate.yml`)
- Metadata: read

## 2. Open a PR

Open any pull request. Within seconds you should see:

- A label like `agent:claude` if the PR is agent-authored.
- A comment explaining the detection signals (first detection only).
- A check run titled `gitgate/merge-confidence — Score: 74/100`.

## 3. (Optional) Configure

Drop a `.gitgate.yml` at the repo root:

```yaml
version: 1
detection:
  enabled: true
  exempt_bots:
    - dependabot[bot]
    - renovate[bot]
confidence:
  minimum_score: 60          # fails the check below this
  apply_to_human_prs: true   # score human PRs as well
  weights:
    test_health: 30
    review_depth: 25
provenance:
  enabled: true
agents:
  claude:
    confidence_minimum: 70   # higher bar for Claude-authored PRs
```

GitGate reads the file on push to your default branch and merges it with the
org-level dashboard config.

## 4. Inspect from the CLI

```bash
gg gate status
gg gate score 142
gg gate provenance 142
```

## 5. Wire into branch protection

GitHub → Settings → Branches → branch protection rule → require status check:

- `gitgate/merge-confidence`

Pair with a `confidence.minimum_score` in `.gitgate.yml` to enforce a floor.
