// The segmenter implementation moved to `shared/` so the worker (MCP) and
// the UI use the same code path. This module is kept as a thin re-export
// so existing imports from `frontend/segmenter` keep working.
export {
  isAutoLap,
  detectEffortSegments,
  getEffortSegments,
} from "../shared/segmenter";
export type { EffortSegment } from "../shared/segmenter";
