import { getConfig, toEngineConfig } from "../config/config.js";
import { registerApplySuite } from "./engine-suite.js";

// Full application/victory coverage against the real config values (02).
registerApplySuite("applyMoves — real config", toEngineConfig(getConfig()));
