# MCP trace and heap APIs

MCP provides performance traces/insights and heap analysis through `chrome-devtools-cli call TOOL '<JSON>'`. The following schemas are verified against `chrome-devtools-mcp` 1.9.0. Discover schemas with `chrome-devtools-cli list TOOL` before use because an installed host can retain an older pinned package.

| Tool | Parameters and use |
| --- | --- |
| `performance_start_trace` | Required numeric `pageId`; optional `reload`, `autoStop`, `filePath`. Both booleans default to `true`; set them explicitly. For an interaction window, use `reload: false, autoStop: false`, wait for successful trace-start confirmation, perform input through the selected browser controller, and stop within the declared time budget. |
| `performance_stop_trace` | Required `pageId`; optional private `filePath`. Stop the same page's trace, including after an interaction failure. |
| `performance_analyze_insight` | Required `pageId`, `insightSetId`, `insightName`. Use IDs and names returned by the trace; do not invent them. |
| `take_heapsnapshot` | Required `pageId` and private absolute `filePath`. Prefer CLI capture when a manifest and explicit GC choice are needed. |
| `get_heapsnapshot_summary` | Required `filePath` to the actual `.heapsnapshot` file, not its run directory. Start here. |
| `query_heapsnapshot_objects` | Required `filePath`; narrow with `className`, `nodeType`, and `pageIdx: 0, pageSize: 10`. Other supported filters include `propertyName`, `retainedSize`, `selfSize`, and `isDetached`. |
| `get_heapsnapshot_retainers` | Required `filePath` and numeric `nodeId`; bound with `pageIdx: 0, pageSize: 10`. Obtain the node ID from that snapshot, not from another run or a class index. |
| `get_heapsnapshot_retaining_paths` | Required `filePath`, `nodeId`; bound with `maxDepth: 5, maxNodes: 20, maxSiblings: 3`. |
| `compare_heapsnapshots` | Required `baseFilePath`, `currentFilePath`; optional `classIndex` narrows to a class. Broad comparison can return a large result and has no pagination parameters: prefer bounded queries on each snapshot when output cannot be kept private and bounded. |
| `close_heapsnapshot` | Required `filePath`. Release backend analysis memory when finished; this does not delete the evidence file. |
