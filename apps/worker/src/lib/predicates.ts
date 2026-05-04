// Property-predicate evaluator. Mirrors the operator set used by the
// audience compiler (Trait / Performed property filters) so an operator
// authoring a WaitFor predicate sees the same semantics as in audiences.

export type Operator =
  | 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'exists' | 'notExists' | 'contains' | 'notContains';

export interface Predicate {
  key: string;
  operator: Operator;
  value?: string | number | boolean;
}

export function evaluatePredicates(
  predicates: Predicate[] | undefined | null,
  properties: Record<string, unknown> | null | undefined,
): boolean {
  if (!predicates || predicates.length === 0) return true;
  const props = properties ?? {};
  return predicates.every((p) => evaluateOne(p, props));
}

function evaluateOne(p: Predicate, props: Record<string, unknown>): boolean {
  const lhs = props[p.key];
  switch (p.operator) {
    case 'exists':
      return lhs !== undefined && lhs !== null;
    case 'notExists':
      return lhs === undefined || lhs === null;
    case 'equals':
      return p.value !== undefined && coerceString(lhs) === coerceString(p.value);
    case 'notEquals':
      return p.value !== undefined && coerceString(lhs) !== coerceString(p.value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (p.value === undefined) return false;
      const a = Number(lhs);
      const b = Number(p.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return p.operator === 'gt' ? a > b
        : p.operator === 'gte' ? a >= b
        : p.operator === 'lt' ? a < b
        : a <= b;
    }
    case 'contains': {
      if (p.value === undefined) return false;
      return coerceString(lhs).toLowerCase().includes(coerceString(p.value).toLowerCase());
    }
    case 'notContains': {
      if (p.value === undefined) return false;
      return !coerceString(lhs).toLowerCase().includes(coerceString(p.value).toLowerCase());
    }
  }
}

function coerceString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Objects/arrays — stringify so equals/contains can still meaningfully work.
  try { return JSON.stringify(v); } catch { return ''; }
}
