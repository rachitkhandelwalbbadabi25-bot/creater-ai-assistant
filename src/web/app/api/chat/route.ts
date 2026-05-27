import { processMessageStreaming } from "@graph/supervisor.js";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          await processMessageStreaming(message, "web", (text: string) => {
            controller.enqueue(new TextEncoder().encode(text));
          });
          controller.close();
        } catch (error: any) {
          console.error("Streaming error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
