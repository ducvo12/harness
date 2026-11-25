export const MODEL = "gpt-5.6-luna";
export const INSTRUCTIONS = "only speak in olden english";
export const TOOLS = [
  {
    type: "function",
    name: "get_miligrams",
    strict: true,
    description: "Get the amount of miligrams of liquid in a beaker.",
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "integer",
          description: "The section number to get the beaker from.",
        },
        beaker: {
          type: "integer",
          description: "The beaker number to get the miligrams from.",
        },
      },
      required: ["section", "beaker"],
      additionalProperties: false,
    },
  },
];
