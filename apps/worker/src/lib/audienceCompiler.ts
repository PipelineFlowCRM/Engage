// Compiles an audience definition (JSON tree) into a parameterised Postgres
// query that returns the set of subscriber ids matching the audience.
//
// Approach: each node returns a SELECT id FROM "Subscriber" WHERE … fragment.
// And combines via INTERSECT, Or via UNION. Performed nodes use EXISTS over
// "Event" with a HAVING count().
//
// Output is meant to be plugged into the compute job:
//   INSERT INTO "AudienceMember" (audienceId, subscriberId, computeVersion)
//   SELECT :audienceId, sub.id, :version
//   FROM ( <compiled-query> ) AS sub
//   ON CONFLICT … DO UPDATE …;
//
// Phase 1 supports: And, Or, Trait, Performed.

import type { AudienceDefinition, AudienceNode, TraitOperator } from '@pipelineflow-engagement/shared';

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

export function compileAudience(definition: AudienceDefinition): CompiledQuery {
  const params: unknown[] = [];
  const sql = compileNode(definition.root, params);
  return { sql, params };
}

function nextParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function compileNode(node: AudienceNode, params: unknown[]): string {
  switch (node.type) {
    case 'And':
      return compileCombinator(node.children, params, 'INTERSECT');
    case 'Or':
      return compileCombinator(node.children, params, 'UNION');
    case 'Trait':
      return compileTrait(node, params);
    case 'Performed':
      return compilePerformed(node, params);
  }
}

function compileCombinator(
  children: AudienceNode[],
  params: unknown[],
  op: 'INTERSECT' | 'UNION',
): string {
  if (children.length === 0) {
    // Empty And/Or — match nothing.
    return `SELECT id FROM "Subscriber" WHERE FALSE`;
  }
  if (children.length === 1) {
    return compileNode(children[0]!, params);
  }
  const parts = children.map((c) => `(${compileNode(c, params)})`);
  return parts.join(`\n${op}\n`);
}

function traitComparison(
  column: string,         // e.g.  s.traits->>'$1'  — caller controls the LHS shape
  operator: TraitOperator,
  value: unknown,
  params: unknown[],
): string {
  switch (operator) {
    case 'exists':
      return `${column} IS NOT NULL`;
    case 'notExists':
      return `${column} IS NULL`;
    case 'equals':
      // Cast both sides to text so number-stored-as-string still works.
      return `${column} = ${nextParam(params, String(value))}`;
    case 'notEquals':
      return `${column} <> ${nextParam(params, String(value))}`;
    case 'contains':
      return `${column} ILIKE ${nextParam(params, `%${escapeLike(String(value))}%`)}`;
    case 'notContains':
      return `${column} NOT ILIKE ${nextParam(params, `%${escapeLike(String(value))}%`)}`;
    case 'gt':
      return `(${column})::numeric > ${nextParam(params, Number(value))}`;
    case 'gte':
      return `(${column})::numeric >= ${nextParam(params, Number(value))}`;
    case 'lt':
      return `(${column})::numeric < ${nextParam(params, Number(value))}`;
    case 'lte':
      return `(${column})::numeric <= ${nextParam(params, Number(value))}`;
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function compileTrait(
  node: Extract<AudienceNode, { type: 'Trait' }>,
  params: unknown[],
): string {
  // s.traits->>'key' — keys are user-supplied strings. Bind via parameter to
  // avoid quoting hassles. Postgres jsonb operator ->> takes a text key on
  // the right and returns text.
  const keyParam = nextParam(params, node.key);
  const lhs = `s.traits->>${keyParam}`;
  const cmp = traitComparison(lhs, node.operator, node.value, params);
  return `SELECT id FROM "Subscriber" s WHERE ${cmp}`;
}

function compilePerformed(
  node: Extract<AudienceNode, { type: 'Performed' }>,
  params: unknown[],
): string {
  const eventParam = nextParam(params, node.event);
  const conds: string[] = [
    `e.type = 'track'`,
    `e.name = ${eventParam}`,
    `e."subscriberId" = s.id`,
  ];

  // Window
  if (node.window.kind === 'lastDays') {
    const daysParam = nextParam(params, node.window.days);
    conds.push(`e."receivedAt" >= NOW() - (${daysParam}::int * INTERVAL '1 day')`);
  } else if (node.window.kind === 'between') {
    conds.push(`e."receivedAt" >= ${nextParam(params, new Date(node.window.from))}`);
    conds.push(`e."receivedAt" <= ${nextParam(params, new Date(node.window.to))}`);
  }
  // 'ever' — no time filter

  // Property filters
  if (node.properties && node.properties.length) {
    for (const p of node.properties) {
      const keyParam = nextParam(params, p.key);
      const lhs = `e.properties->>${keyParam}`;
      conds.push(traitComparison(lhs, p.operator, p.value, params));
    }
  }

  const countOp =
    node.times.op === 'gte' ? '>=' :
    node.times.op === 'lte' ? '<=' : '=';
  const countParam = nextParam(params, node.times.count);

  return `SELECT id FROM "Subscriber" s WHERE EXISTS (
    SELECT 1 FROM "Event" e WHERE ${conds.join(' AND ')}
    GROUP BY e."subscriberId"
    HAVING COUNT(*) ${countOp} ${countParam}
  )`;
}
