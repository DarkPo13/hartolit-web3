import "server-only";

import { createConnection } from "node:net";

export async function scanEvidence(bytes: Uint8Array): Promise<"clean" | "infected"> {
  const host = process.env.EVIDENCE_CLAMD_HOST;
  const port = Number(process.env.EVIDENCE_CLAMD_PORT ?? "3310");
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Evidence scanner is not configured");
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = "";
    let settled = false;
    const finish = (error?: Error, result?: "clean" | "infected") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(result!);
    };
    socket.setTimeout(20_000, () => finish(new Error("Evidence scanner timed out")));
    socket.on("error", (error) => finish(error));
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString("utf8");
      if (response.length > 4096) return finish(new Error("Invalid scanner response"));
      if (response.includes("\0") || response.includes("\n")) {
        if (/^stream: OK[\0\n]/.test(response)) finish(undefined, "clean");
        else if (/^stream: .* FOUND[\0\n]/.test(response)) finish(undefined, "infected");
        else finish(new Error("Evidence scanner could not verify the file"));
      }
    });
    socket.on("close", () => { if (!settled) finish(new Error("Evidence scanner disconnected")); });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        const chunk = bytes.subarray(offset, offset + 64 * 1024);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
