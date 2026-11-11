// Password hashing mechanics (docs/01): bcrypt, cost 10 (fits the ARM VM).
import bcrypt from "bcrypt";

export const BCRYPT_COST = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
