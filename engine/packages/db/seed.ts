/**
 * Seed script for local development.
 * Run with: bun run db:seed
 *
 * This creates realistic dev data: 2 users, 1 org, 3 repos,
 * sample commits, 2 PRs, 5 issues, labels, milestones.
 */

import { createDb } from './src/index';
import * as schema from './src/schema';

// In a real seed, we'd get D1 from miniflare or wrangler unstable_dev.
// For now, this exports the seed function for use in tests or scripts.

export async function seed(db: ReturnType<typeof createDb>) {
  // --- Users ---
  const [alice, bob] = await db
    .insert(schema.users)
    .values([
      {
        id: '00000000000000000000000000000001',
        username: 'alice',
        displayName: 'Alice Chen',
        email: 'alice@example.com',
        bio: 'Full-stack engineer. Loves TypeScript and Cloudflare.',
      },
      {
        id: '00000000000000000000000000000002',
        username: 'bob',
        displayName: 'Bob Park',
        email: 'bob@example.com',
        bio: 'DevOps and CI/CD enthusiast.',
      },
    ])
    .returning();

  // --- Org ---
  const [acmeOrg] = await db
    .insert(schema.orgs)
    .values({
      id: '00000000000000000000000000000010',
      slug: 'acme',
      displayName: 'Acme Corp',
    })
    .returning();

  await db.insert(schema.orgMembers).values([
    { orgId: acmeOrg!.id, userId: alice!.id, role: 'owner' },
    { orgId: acmeOrg!.id, userId: bob!.id, role: 'member' },
  ]);

  // --- Repos ---
  const [apiRepo, webRepo, libRepo] = await db
    .insert(schema.repos)
    .values([
      {
        id: '00000000000000000000000000000100',
        ownerType: 'user',
        ownerId: alice!.id,
        name: 'hello-world',
        description: 'A simple hello world repository for testing git operations.',
        defaultBranch: 'main',
      },
      {
        id: '00000000000000000000000000000101',
        ownerType: 'org',
        ownerId: acmeOrg!.id,
        name: 'web-app',
        description: 'Acme Corp web application.',
        defaultBranch: 'main',
      },
      {
        id: '00000000000000000000000000000102',
        ownerType: 'user',
        ownerId: bob!.id,
        name: 'utils',
        description: 'Shared utility library.',
        defaultBranch: 'main',
        isPrivate: 1,
      },
    ])
    .returning();

  // Initialize counters
  await db.insert(schema.repoCounters).values([
    { repoId: apiRepo!.id, nextNumber: 8 },
    { repoId: webRepo!.id, nextNumber: 4 },
    { repoId: libRepo!.id, nextNumber: 2 },
  ]);

  // --- Collaborators ---
  await db.insert(schema.repoCollaborators).values({
    repoId: libRepo!.id,
    userId: alice!.id,
    permission: 'write',
  });

  // --- Refs ---
  const mainSha = 'a'.repeat(40);
  const featureSha = 'b'.repeat(40);

  await db.insert(schema.refs).values([
    { repoId: apiRepo!.id, name: 'refs/heads/main', sha: mainSha, refType: 'branch' },
    { repoId: apiRepo!.id, name: 'refs/heads/feature/add-readme', sha: featureSha, refType: 'branch' },
    { repoId: webRepo!.id, name: 'refs/heads/main', sha: mainSha, refType: 'branch' },
    { repoId: libRepo!.id, name: 'refs/heads/main', sha: mainSha, refType: 'branch' },
  ]);

  // --- Labels ---
  const defaultLabels = [
    { name: 'bug', color: 'd73a4a', description: 'Something isn\'t working' },
    { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
    { name: 'documentation', color: '0075ca', description: 'Improvements or additions to documentation' },
    { name: 'good first issue', color: '7057ff', description: 'Good for newcomers' },
    { name: 'help wanted', color: '008672', description: 'Extra attention is needed' },
  ];

  for (const repo of [apiRepo!, webRepo!, libRepo!]) {
    await db.insert(schema.labels).values(
      defaultLabels.map((l) => ({ ...l, repoId: repo.id })),
    );
  }

  // --- Issues ---
  await db.insert(schema.issues).values([
    {
      repoId: apiRepo!.id,
      number: 1,
      title: 'Add README.md',
      body: 'We need a README file with setup instructions.',
      authorId: alice!.id,
    },
    {
      repoId: apiRepo!.id,
      number: 2,
      title: 'Fix typo in greeting',
      body: 'The greeting says "Helo" instead of "Hello".',
      authorId: bob!.id,
    },
    {
      repoId: apiRepo!.id,
      number: 3,
      title: 'Add CI pipeline',
      body: 'Set up automated testing.',
      authorId: alice!.id,
      state: 'closed',
      closedAt: '2026-04-01T12:00:00Z',
      closedById: alice!.id,
    },
    {
      repoId: webRepo!.id,
      number: 1,
      title: 'Dark mode toggle broken',
      body: 'Clicking the toggle doesn\'t switch themes.',
      authorId: bob!.id,
    },
    {
      repoId: webRepo!.id,
      number: 2,
      title: 'Add search feature',
      body: 'Users need to search across the site.',
      authorId: alice!.id,
    },
  ]);

  // --- Pull Requests ---
  await db.insert(schema.pullRequests).values([
    {
      repoId: apiRepo!.id,
      number: 4,
      title: 'Add README with setup instructions',
      body: 'Closes #1\n\nAdds a comprehensive README.',
      authorId: alice!.id,
      headRef: 'feature/add-readme',
      headSha: featureSha,
      baseRef: 'main',
      baseSha: mainSha,
      additions: 42,
      deletions: 0,
      changedFiles: 1,
    },
    {
      repoId: webRepo!.id,
      number: 3,
      title: 'Fix dark mode toggle',
      body: 'Fixes #1\n\nThe theme context was not being passed correctly.',
      authorId: bob!.id,
      headRef: 'fix/dark-mode',
      headSha: featureSha,
      baseRef: 'main',
      baseSha: mainSha,
      additions: 12,
      deletions: 3,
      changedFiles: 2,
    },
  ]);

  // --- Milestones ---
  await db.insert(schema.milestones).values([
    {
      repoId: apiRepo!.id,
      title: 'v1.0',
      description: 'First stable release.',
      dueDate: '2026-05-01',
    },
    {
      repoId: webRepo!.id,
      title: 'Beta Launch',
      description: 'Feature complete for beta testers.',
      dueDate: '2026-04-15',
    },
  ]);

  // --- Stars ---
  await db.insert(schema.stars).values([
    { userId: alice!.id, repoId: webRepo!.id },
    { userId: bob!.id, repoId: apiRepo!.id },
    { userId: bob!.id, repoId: webRepo!.id },
  ]);

  console.log('Seed complete: 2 users, 1 org, 3 repos, 5 issues, 2 PRs, labels, milestones.');
}
