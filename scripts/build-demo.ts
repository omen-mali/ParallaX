import { buildTrackedDemo, checkTrackedDemo } from "../src/demo/build.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await buildTrackedDemo();
    return;
  }
  if (args.length === 1 && args[0] === "--check") {
    await checkTrackedDemo();
    return;
  }
  throw new Error("Usage: tsx scripts/build-demo.ts [--check]");
}

await main();
