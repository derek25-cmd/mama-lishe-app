import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET!;
const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL ?? 3600);
const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);

export interface TokenPayload {
  sub: string;        // user id
  role: string;       // RBAC role, e.g. "owner" | "manager" | "staff"
  typ: "access" | "refresh";
}

export function signAccessToken(sub: string, role: string): string {
  return jwt.sign({ sub, role, typ: "access" } satisfies TokenPayload, SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

export function signRefreshToken(sub: string, role: string): string {
  return jwt.sign({ sub, role, typ: "refresh" } satisfies TokenPayload, SECRET, {
    expiresIn: `${REFRESH_TTL_DAYS}d`,
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET) as TokenPayload;
}
