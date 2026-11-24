// Route updated for CUA native execution & autonomous social DOM operator
import { processMessageStreaming } from "@graph/supervisor.js";
import { initDatabase } from "@memory/db.js";
import { startScheduler } from "@proactive/scheduler.js";

// Ensure database and scheduler background loop are initialized in web runtime
try {
  initDatabase();
  startScheduler();
} catch {}

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
        } catch (error: unknown) {
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
