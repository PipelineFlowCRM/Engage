// Express's res.json() can't serialise BigInt by default. We hit BigInt
// everywhere (Subscriber.id, Event.id, Delivery.id, BroadcastDelivery.id,
// etc.) so register a global toJSON shim once and treat BigInt-as-string
// as the wire convention. Clients that need numeric maths on these (rare)
// can parse back; we never need them as JS Number anyway.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/** Convert a row-shape with BigInts to a plain JSON-serialisable form. */
export function bigintsToString<T>(row: T): T {
  // The toJSON shim handles serialisation, but route handlers sometimes
  // need to compose objects mixing DB rows + extra fields, where TS infers
  // BigInt. Coerce explicitly via a JSON round-trip when type isn't fixed.
  return JSON.parse(JSON.stringify(row));
}
