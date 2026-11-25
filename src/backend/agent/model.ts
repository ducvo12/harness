// One request to the Responses API. ChatGPT plan tokens use the same official
// endpoint as API keys, so this works for either.
// ChatGPT plan requests reject a bare string `input` and require `stream: true`,
// so this waits for the whole stream, then parses it into an array of events.

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

  // pure text output from the api
  const text = await response.text();
  if (!response.ok)
    throw new Error(`Model request failed (HTTP ${response.status}): ${text}`);

  // split string object into array of events
  const blocks = text.split("\n\n").filter(Boolean);

  const events: ModelEvent[] = blocks.map((block) => {
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

    return {
      event: event,
      data: data,
    };
  });

  return events;
}
