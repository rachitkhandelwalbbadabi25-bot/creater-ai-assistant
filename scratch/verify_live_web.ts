async function testLiveWeb() {
  console.log("=== 1. Testing ordinary chat request to http://localhost:3000/api/chat ===");
  try {
    const res1 = await fetch("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello, who are you?" }),
    });

    console.log("Chat HTTP status:", res1.status);
    const text1 = await res1.text();
    console.log("Chat response snippet:", text1.slice(0, 200));
  } catch (err: any) {
    console.error("Chat error:", err.message);
  }

  console.log("\n=== 2. Creating short-delay reminder (5 seconds) ===");
  try {
    const res2 = await fetch("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Remind me in 5 seconds to check system status" }),
    });

    console.log("Reminder request status:", res2.status);
    const text2 = await res2.text();
    console.log("Reminder response snippet:", text2.slice(0, 200));
  } catch (err: any) {
    console.error("Reminder request error:", err.message);
  }

  console.log("\n=== 3. Waiting 8 seconds for background scheduler tick to claim and execute the reminder ===");
  await new Promise((r) => setTimeout(r, 8000));
  console.log("Wait complete.");
}

testLiveWeb();
