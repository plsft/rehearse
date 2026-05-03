# setup-deps — composite action

A reusable composite action that bundles `actions/setup-node`,
`actions/cache`, and `npm ci` behind one call.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `node-version` | `20.x` | Node.js version |
| `cache-key-prefix` | `npm` | Prefix for the cache key — change to invalidate |

## Usage

```yaml
- uses: ./.github/actions/setup-deps
  with:
    node-version: '22.x'
    cache-key-prefix: 'npm-mainline'
```

When `@rehearse/runner` encounters this, it inlines the three inner steps
into the calling job, substitutes `${{ inputs.* }}` from the parent's
`with:`, and runs them as if the user had written them directly. No
separate execution context, no shelling out — composite expansion is a
plain step rewrite.

To author this with TypeScript instead of YAML, you can use
`@rehearse/ci`'s `step.action(...)` helper at the call site (see the
`ci.ts` in this example) — composite-action *definitions* still live as
YAML, since GitHub Actions itself reads them that way.
