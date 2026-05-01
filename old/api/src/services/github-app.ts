import { SignJWT, importPKCS8 } from 'jose';
import type { Env } from '../env.js';

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Manage GitHub App auth: short-lived JWTs minted from the App private key,
 * and per-installation access tokens cached in KV until ~5 min before expiry.
 */
export class GitHubAppService {
  constructor(private readonly env: Env) {}

  /** Mint an app-level JWT (10 minute lifetime). */
  async appJwt(): Promise<string> {
    const key = await importPKCS8(this.env.GITHUB_APP_PRIVATE_KEY, 'RS256');
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 9 * 60)
      .setIssuer(this.env.GITHUB_APP_ID)
      .sign(key);
  }

  async getInstallationToken(installationId: number): Promise<string> {
    const cacheKey = `gh:install:${installationId}`;
    const cachedRaw = await this.env.CACHE.get(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as CachedToken;
        if (cached.expiresAt - 5 * 60 > Math.floor(Date.now() / 1000)) {
          return cached.token;
        }
      } catch {
        // fall through and refresh
      }
    }
    const jwt = await this.appJwt();
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'gitgate-api/0.1.0',
        },
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch installation token: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { token: string; expires_at: string };
    const expiresAt = Math.floor(new Date(body.expires_at).getTime() / 1000);
    const cached: CachedToken = { token: body.token, expiresAt };
    await this.env.CACHE.put(cacheKey, JSON.stringify(cached), {
      expirationTtl: Math.max(60, expiresAt - Math.floor(Date.now() / 1000) - 60),
    });
    return body.token;
  }
}
