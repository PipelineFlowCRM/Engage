import type { Request } from 'express';
import { HttpError } from './error.js';

// `@types/express-serve-static-core@5.x` types req.params as
//   `{ [key: string]: string | string[] }`
// because Express 5 supports wildcard captures that can yield arrays.
// None of our routes use wildcards, so collapse the union here once and
// throw a 400 on the impossible-but-typed-as-possible array case.
export function param(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== 'string' || v.length === 0) {
    throw new HttpError(400, `Missing path param: ${name}`);
  }
  return v;
}

// Same idea for query params, which are `string | string[] | ParsedQs | ParsedQs[]`.
// Returns `undefined` if absent. Most query reads should go through Zod,
// but cursor/limit-style scalars stay clean with this.
export function queryString(req: Request, name: string): string | undefined {
  const v = req.query[name];
  if (v == null) return undefined;
  if (typeof v !== 'string') {
    throw new HttpError(400, `Query param ${name} must be a single string`);
  }
  return v;
}
