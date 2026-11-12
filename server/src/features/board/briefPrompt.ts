export function buildBriefPrompt(boardSize: number): string {
  const topSpawn = "0-1";
  const bottomSpawn = `${boardSize - 2}-${boardSize - 1}`;
  const min = 2;
  const max = boardSize - 3;
  const centerMaxYForest = Math.max(min, max - 1);
  const lakeMinY = Math.min(max, min + 1);
  const lakeMaxY = Math.max(lakeMinY, max - 1);

  return [
    `You are a battlefield designer for a small fantasy war game on a ${boardSize}x${boardSize} grid.`,
    `Two armies spawn on the BOTTOM rows (${bottomSpawn}) and TOP rows (${topSpawn}).`,
    `Rows ${topSpawn} and ${bottomSpawn} of every column are RESERVED: no water, no obstacles there.`,
    "",
    "USUALLY a river runs from the LEFT edge to the RIGHT edge — it must curve if present:",
    "never straight. 1 or 2 bridges cross it when it exists. Hills, forests and a small",
    "lake decorate the terrain. Respond ONLY with JSON matching exactly this shape",
    '("river" may be null for a more rare open-field battlefield):',
    "",
    "{",
    `  "river":       <null or {"startRow": int ${min}-${max}, "endRow": int ${min}-${max}, "bends": int 1-3}>,`,
    '  "bridgeTiles": <integer 1 or 2 — ignored when river is null>,',
    `  "forestZones": <array, 1-3 items: {"centerX": int ${min}-${max}, "centerY": int ${min}-${centerMaxYForest}, "radius": int 1-3}>,`,
    `  "hillZones":   <array, 0-2 items: {"centerX": int ${min}-${max}, "centerY": int ${min}-${max}, "radius": int 1-2}>,`,
    `  "lake":        <null or {"centerX": int ${min}-${max}, "centerY": int ${lakeMinY}-${lakeMaxY}, "radius": int 1-2}>`,
    "}",
    "",
    "Aim for a varied battlefield; a river crossing is the classic choice.",
  ].join("\n");
}

export function briefJsonSchema(boardSize: number): object {
  const min = 2;
  const max = boardSize - 3;
  const centerMaxYForest = Math.max(min, max - 1);
  const lakeMinY = Math.min(max, min + 1);
  const lakeMaxY = Math.max(lakeMinY, max - 1);

  const riverSchema = {
    type: "object",
    additionalProperties: false,
    required: ["startRow", "endRow", "bends"],
    properties: {
      startRow: { type: "integer", minimum: min, maximum: max },
      endRow: { type: "integer", minimum: min, maximum: max },
      bends: { type: "integer", minimum: 1, maximum: 3 },
    },
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["river", "bridgeTiles", "forestZones", "hillZones", "lake"],
    properties: {
      river: { anyOf: [riverSchema, { type: "null" }] },
      bridgeTiles: { type: "integer", enum: [1, 2] },
      forestZones: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["centerX", "centerY", "radius"],
          properties: {
            centerX: { type: "integer", minimum: min, maximum: max },
            centerY: { type: "integer", minimum: min, maximum: centerMaxYForest },
            radius: { type: "integer", minimum: 1, maximum: 3 },
          },
        },
      },
      hillZones: {
        type: "array",
        minItems: 0,
        maxItems: 2,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["centerX", "centerY", "radius"],
          properties: {
            centerX: { type: "integer", minimum: min, maximum: max },
            centerY: { type: "integer", minimum: min, maximum: max },
            radius: { type: "integer", minimum: 1, maximum: 2 },
          },
        },
      },
      lake: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["centerX", "centerY", "radius"],
            properties: {
              centerX: { type: "integer", minimum: min, maximum: max },
              centerY: { type: "integer", minimum: lakeMinY, maximum: lakeMaxY },
              radius: { type: "integer", minimum: 1, maximum: 2 },
            },
          },
          { type: "null" },
        ],
      },
    },
  };
}
