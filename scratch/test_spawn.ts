declare const Bun: any;
export {};
const proc = Bun.spawn({
  cmd: ["cmd.exe", "/c", "start", "", "notepad.exe"],
  stdout: "ignore",
  stderr: "ignore",
  windowsHide: true,
});

const exitCode = await proc.exited;
console.log("Exit code:", exitCode);
