// P18 D9's operator table, moved here in the addendum (D21) to gain a second consumer — the
// console's own Mongo completion source — rather than a second copy that could drift from this
// one. find()'s filter document is the only thing either surface reaches — aggregation-stage
// operators ($group, $lookup, …) have no business in either.
export const MONGO_QUERY_OPERATORS: readonly string[] = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$exists',
  '$type',
  '$regex',
  '$options',
  '$and',
  '$or',
  '$nor',
  '$not',
  '$all',
  '$elemMatch',
  '$size',
];
