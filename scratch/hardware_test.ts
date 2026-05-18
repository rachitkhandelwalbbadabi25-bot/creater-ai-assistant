import si from "systeminformation";

async function test() {
  console.log("Scanning hardware...");
  const mem = await si.mem();
  console.log("RAM Total (bytes):", mem.total);
  console.log("RAM Total (GB):", mem.total / (1024 * 1024 * 1024));

  const cpu = await si.cpu();
  console.log("CPU Cores:", cpu.cores);
  console.log("CPU Brand:", cpu.brand);

  const graphics = await si.graphics();
  console.log("Graphics Controllers:");
  console.log(JSON.stringify(graphics.controllers, null, 2));
}

test().catch(console.error);
