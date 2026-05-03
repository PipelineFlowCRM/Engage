import argon2 from 'argon2';

export const hashPassword = (plain: string) =>
  argon2.hash(plain, { type: argon2.argon2id });

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    if (hash.startsWith('$argon2')) return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
  return false;
}
