import { createServer } from "node:http";

// Optional manual browser checkpoints, guarded by the caller's local DB fixture.
// PUBLICATION_BROWSER_FIXTURE selects one stage: "1" (preparation), "withdrawal"
// or "issued". Test account cookies stay in this process and Set-Cookie, never
// in logs/files. `actors` maps a helper path such as "/publisher" to a session.
export function browserStage(stage) {
  return process.env.PUBLICATION_BROWSER_FIXTURE === stage;
}

export async function browserCheckpoint(stage, { base, actors, label, links = {} }) {
  if (!browserStage(stage)) return false;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const server = createServer((req, res) => {
    if (req.url === "/finish") { res.end("finished"); finish(); return; }
    if (links[req.url]) { res.writeHead(302, { Location: links[req.url], "Cache-Control": "no-store" }); res.end(); return; }
    const actor = actors[req.url];
    if (!actor) { res.writeHead(404); res.end(); return; }
    res.writeHead(302, { "Set-Cookie": actor.header().split("; ").map(cookie => `${cookie}; Path=/; HttpOnly; SameSite=Lax`),
      Location: `${base}/admin`, "Cache-Control": "no-store" }); res.end();
  });
  const timer = setTimeout(finish, 20 * 60_000);
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3103, "127.0.0.1", resolve); });
    process.stdout.write(`Fictional ${stage === "1" ? "preparation" : stage} browser checkpoint ready: ${label}. Session bootstrap on loopback port 3103.\n`);
    await done;
  } finally { clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  return true;
}

/** After a stage whose browser actions change the fixture, later assertions no
 * longer hold; stop through the normal cleanup without reporting a pass.
 */
export function stopAfterBrowserStage(stage) {
  throw new Error(`Browser fixture "${stage}" finished; remaining smoke stages were intentionally not run`);
}
