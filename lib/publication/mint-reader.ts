import "server-only";

import type { MintReader } from "./chain-mint";

/** One cumulative RPC budget across discovery, receipt and wallet-history reads.
 * Timeout rejects the awaited read, not a detached database-writing operation.
 * The trusted transport still owns response-size limits and actual cancellation.
 */
export function boundedMintMonitorReader(reader: MintReader): MintReader {
  const end = performance.now() + 20_000;
  return new Proxy(reader, { get(target, key) {
    const method = Reflect.get(target, key);
    if (typeof method !== "function") return method;
    return async (...args: unknown[]) => {
      const remaining = end - performance.now();
      if (remaining <= 0) throw new Error("Mint monitoring RPC deadline exceeded");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([Promise.resolve().then(() => Reflect.apply(method, target, args)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Mint monitoring RPC deadline exceeded")), remaining); })]);
      } finally { clearTimeout(timer); }
    };
  } });
}
