import { randomBytes } from 'node:crypto';

const lifetimeMs = 8 * 60 * 60_000;
const secret = () => randomBytes(32).toString('base64url');
const cookieName = 'quota_session';

export class Sessions {
  readonly #sessions = new Map<string, { csrfToken: string; expiresAt: number }>();
  #failures = 0;
  #windowEnd = 0;

  constructor(private readonly verify: (username: string, password: string) => boolean) {}

  #token(cookie: string | undefined) { return cookie?.match(/(?:^|;\s*)quota_session=([\w-]{43})(?:;|$)/)?.[1]; }

  get(cookie: string | undefined, now = Date.now()) {
    const token = this.#token(cookie);
    const entry = token ? this.#sessions.get(token) : undefined;
    return entry && entry.expiresAt > now ? entry : undefined;
  }

  login(username: string, password: string, cookie: string | undefined, now = Date.now()) {
    if (now >= this.#windowEnd) { this.#failures = 0; this.#windowEnd = now + 60_000; }
    if (this.#failures >= 5) return { status: 429 } as const;
    if (!this.verify(username, password)) {
      this.#failures++;
      return { status: 401 } as const;
    }
    this.#failures = 0;
    return this.#create(cookie, now);
  }

  #create(cookie: string | undefined, now: number) {
    const previous = this.#token(cookie);
    if (previous) this.#sessions.delete(previous);
    for (const [token, session] of this.#sessions) if (session.expiresAt <= now) this.#sessions.delete(token);
    if (this.#sessions.size >= 32) this.#sessions.delete(this.#sessions.keys().next().value!);
    const token = secret();
    const csrfToken = secret();
    this.#sessions.set(token, { csrfToken, expiresAt: now + lifetimeMs });
    return { status: 200, csrfToken, cookie: `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetimeMs / 1000}` } as const;
  }

  logout(cookie: string | undefined) {
    const token = this.#token(cookie);
    if (token) this.#sessions.delete(token);
    return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
  }
}
