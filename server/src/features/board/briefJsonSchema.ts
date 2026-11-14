export const boardBriefJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["river", "bridgeTiles", "forestZones", "hillZones", "lake"],
  properties: {
    river: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["startRow", "endRow", "bends"],
          properties: {
            startRow: { type: "integer", minimum: 2, maximum: 5 },
            endRow: { type: "integer", minimum: 2, maximum: 5 },
            bends: { type: "integer", minimum: 1, maximum: 3 },
          },
        },
      ],
    },
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
          centerX: { type: "integer", minimum: 2, maximum: 5 },
          centerY: { type: "integer", minimum: 2, maximum: 4 },
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
          centerX: { type: "integer", minimum: 2, maximum: 5 },
          centerY: { type: "integer", minimum: 2, maximum: 5 },
          radius: { type: "integer", minimum: 1, maximum: 2 },
        },
      },
    },
    lake: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["centerX", "centerY", "radius"],
          properties: {
            centerX: { type: "integer", minimum: 2, maximum: 5 },
            centerY: { type: "integer", minimum: 3, maximum: 4 },
            radius: { type: "integer", minimum: 1, maximum: 2 },
          },
        },
      ],
    },
  },
} as const;
