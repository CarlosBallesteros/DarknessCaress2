import configJson from "./config.json" with { type: "json" };

export const config = configJson;
export type AppConfig = typeof config;
