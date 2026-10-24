import assert from "node:assert/strict";
import net from "node:net";
import { execFileSync, spawn } from "node:child_process";

const container = "hartolit-web3-kubo-local";

/** Test-only TCP tunnels: keep Kubo on its internal, offline network while Node's
 * real fetch talks to its RPC and gateway. No proxy to arbitrary hosts/containers.
 * Neither tunnel is an app service; both exist only for this smoke's lifetime.
 */
export function assertOfflineKubo() {
  const inspect = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8", windowsHide: true }))[0];
  assert.ok(inspect.State.Running && inspect.Config.Cmd.includes("--offline"),
    "Start the offline fixture first: docker compose --env-file .env.db.local --profile publication-local up -d kubo-local");
  const networks = Object.values(inspect.NetworkSettings.Networks);
  assert.equal(networks.length, 1);
  assert.equal(execFileSync("docker", ["network", "inspect", networks[0].NetworkID, "--format", "{{.Internal}}"],
    { encoding: "utf8", windowsHide: true }).trim(), "true", "fixture must have no external network");
}

export async function openOfflineKuboTunnels() {
  assertOfflineKubo();
  const servers = [], sockets = new Set(), children = new Set();
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    for (const child of children) child.kill();
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  };
  try {
    for (const [hostPort, nodePort] of [[15001, 5001], [18080, 8080]]) {
      const server = net.createServer((socket) => {
        sockets.add(socket);
        const child = spawn("docker", ["exec", "-i", container, "nc", "-w", "20", "127.0.0.1", String(nodePort)],
          { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
        children.add(child);
        socket.setTimeout(35_000, () => socket.destroy());
        socket.on("error", () => socket.destroy());
        child.stdin.on("error", () => socket.destroy());
        child.on("error", () => socket.destroy());
        child.on("close", () => { children.delete(child); socket.destroy(); });
        socket.on("close", () => { sockets.delete(socket); child.kill(); });
        socket.pipe(child.stdin); child.stdout.pipe(socket);
      });
      servers.push(server);
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(hostPort, "127.0.0.1", resolve); });
    }
    return close;
  } catch (error) { await close(); throw error; }
}
