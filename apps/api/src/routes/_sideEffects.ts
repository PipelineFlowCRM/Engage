// Side-effect import: registers the BigInt JSON shim so route handlers can
// `res.json({ id: 123n })` without crashing. Every route file imports this
// once via `import './_sideEffects.js';` to make the side effect explicit
// and avoid mystery behavior depending on import order.
import '../lib/json.js';
