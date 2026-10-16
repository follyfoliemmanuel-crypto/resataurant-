import { spawn } from "node:child_process";
import process from "node:process";

console.log("🚀 Lancement de l'environnement Savora...");

const api = spawn("npx", ["tsx", "server/index.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, FORCE_COLOR: "1" },
});

const web = spawn("npx", ["vite"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, FORCE_COLOR: "1" },
});

function cleanup() {
  console.log("\nArrêt des serveurs...");
  api.kill();
  web.kill();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
