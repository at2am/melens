# Synthetic v1 map examples

Every record here is an illustrative development fixture, never an upstream fact. Successful response envelopes use dataMode=sample. `item-variants.sample.json` is a development-only list of nine Sample-titled items, not an endpoint envelope.

- Seven state envelopes: viewport (available; measured 12 and measured zero), no-matching, not-covered, unavailable, unknown, historical and partial.
- viewport-query: exact request shape; catalog: all nine registered descriptors.
- item, unlocated, members and error: endpoint response shapes.
- item-variants: one of every MapItem kind, including suppressed/unmatched area values and an area-associated unlocated news item.

Sample sensor C has unknown count and no geometry. It is excluded from viewport totalMatching=2; the sample layer separately records an association-evidenced unresolvedCount=1. Its full record is in unlocated.sample.json. The source-incomplete partial sample keeps totalMatching null even though a page has two rows. Paginated pages may preserve an exact full-snapshot total independently proved by the service; partial completeness alone never proves a total.

Use each schema `$defs` for its endpoint; do not infer unknown totals, precision or source admission from the example title. Sample tokens are opaque stand-ins, not production cursors or signatures.
