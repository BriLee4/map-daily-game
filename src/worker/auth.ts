import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Teacher authentication via Cloudflare Access (Zero Trust).
 *
 * An Access self-hosted application protects `/host` and `/api/host` on this Worker's hostname.
 * Access signs every request it lets through with a JWT in `Cf-Access-Jwt-Assertion`; we verify it
 * here (Workers that serve Static Assets do not receive `ctx.access`, so the JWT check is manual).
 *
 * Local dev: set DEV_TEACHER_EMAIL in .dev.vars; it is honoured only for localhost requests.
 */

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksFor = "";

export type AuthResult = { ok: true; email: string } | { ok: false; status: number; message: string };

export async function authenticateTeacher(request: Request, env: Env): Promise<AuthResult> {
  const url = new URL(request.url);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const devEmail = (env as { DEV_TEACHER_EMAIL?: string }).DEV_TEACHER_EMAIL;
  if (isLocal && devEmail) return { ok: true, email: devEmail.toLowerCase() };

  const teamDomain = env.TEAM_DOMAIN?.replace(/\/$/, "");
  if (!teamDomain || !env.POLICY_AUD)
    return { ok: false, status: 500, message: "Cloudflare Access is not configured (TEAM_DOMAIN / POLICY_AUD)." };

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, status: 401, message: "Sign in through Cloudflare Access first." };

  if (!jwks || jwksFor !== teamDomain) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksFor = teamDomain;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: teamDomain, audience: env.POLICY_AUD });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (!email) return { ok: false, status: 403, message: "Access token has no email (service tokens can't host games)." };
    return { ok: true, email };
  } catch (err) {
    return { ok: false, status: 403, message: `Invalid Access token: ${err instanceof Error ? err.message : err}` };
  }
}
