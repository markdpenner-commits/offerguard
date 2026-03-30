export const maxDuration = 120;

export async function POST(request) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.messages) {
    return Response.json({ error: "Missing messages" }, { status: 400 });
  }

  try {
    var resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: body.model || "claude-sonnet-4-20250514",
        max_tokens: body.max_tokens || 6000,
        messages: body.messages
      })
    });

    var data = await resp.json();

    if (!resp.ok) {
      return Response.json(data, { status: resp.status });
    }

    return Response.json(data);
  } catch (e) {
    return Response.json({ error: "Anthropic API error: " + e.message }, { status: 502 });
  }
}
