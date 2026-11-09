import { getConfig, toEngineConfig } from "../config/config.js";
import { registerReachSuite } from "./engine-suite.js";

// Full movement/path/preview coverage against the real config values (02:
// "Parametrized with the real config values where relevant").
registerReachSuite("reach — real config", toEngineConfig(getConfig()));
