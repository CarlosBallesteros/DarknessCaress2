// Persona BEHAVIOR TEXTS (docs/04) — prompt-internal code constants. The
// config carries only `label` + `temperature` per personality (the config
// stays pure data; prose never enters it). The texts are written in
// class-agnostic terms ("SUPPORTER units", "most favorable range") so
// rebalancing the config can never make a prompt lie.
export const PERSONA_BEHAVIOR_TEXTS: Record<string, string> = {
  aggressive:
    "Hunt them without mercy. Close distance every turn. Concentrate all attacks on one wounded unit until it dies. Attack SUPPORTER units first — the backline the STATS section marks — they're fragile, they matter most, and they die easiest. When no supporter is reachable, hunt the most fragile reachable unit. Do not sit behind the river — you are the attacker.",
  defensive:
    "Fight slowly and survive. Keep your healer 2+ tiles from the front, hold good bridge/forest lines, let them come to you and kill crossing units first. Retreat a wounded front unit backward, it's fine to give ground. Attack from your most favorable range whenever possible — ranged units fire from maximum range.",
  erratic:
    "You are Brilliant but chaotic. Sometimes do something unexpected — split forces, leave a bait, change target for no tactical reason. Commit fully to whatever plan you pick; a chaotic attack is still an attack.",
};
