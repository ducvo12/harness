// One request to the Responses API. ChatGPT plan tokens use the same official
// endpoint as API keys, so this works for either.
// ChatGPT plan requests reject a bare string `input` and require `stream: true`,
// so this parses events as they arrive, prints text deltas live, and returns all events once the stream ends

type ModelEvent = {
  event: string;
  data: any;
};

export async function callModel(
  token: string,
  model: string,
  instructions: string,
  tools: unknown[],
  input: unknown[],
): Promise<ModelEvent[]> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      tools,
      input,
      store: false,
      stream: true,
    }),
  });

  if (!response.ok)
    throw new Error(
      `Model request failed (HTTP ${response.status}): ${await response.text()}`,
    );
  if (!response.body) throw new Error("Model response had no body");

  // streaming
  const decoder = new TextDecoder();
  const events: ModelEvent[] = [];
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop()!;

    for (const block of blocks) {
      const spl = block.split("\n");

      const event = spl[0].slice("event: ".length); // slices first 7 characters (which is "event: ") to get the event name
      const data = JSON.parse(spl[1].slice("data: ".length));

      if (event === "error") {
        throw new Error(
          `Model stream failed. Error: ${JSON.stringify(
            {
              code: data.code,
              message: data.message,
            },
            null,
            2,
          )}`,
        );
      } else if (event === "response.failed") {
        throw new Error(
          `Model response failed. Error: ${JSON.stringify(
            {
              code: data.response.error.code,
              message: data.response.error.message,
            },
            null,
            2,
          )}`,
        );
      } else if (event === "response.incomplete") {
        throw new Error(
          `Model stream stopped early. Error: ${JSON.stringify(
            {
              message: data.response.incomplete_details.reason,
            },
            null,
            2,
          )}`,
        );
      }

      if (data.type === "response.output_text.delta") {
        process.stdout.write(data.delta);
      }

      events.push({
        event: event,
        data: data,
      });
    }
  }

  return events;
}
