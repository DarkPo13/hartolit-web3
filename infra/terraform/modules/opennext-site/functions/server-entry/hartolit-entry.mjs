// The server function's handler. The application deploy copies this file and
// hartolit-secrets.mjs next to OpenNext's index.mjs. Secrets are loaded first because the
// application reads them from process.env as it starts.
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { loadSecretParameters } from "./hartolit-secrets.mjs";

const client = new SSMClient({});
await loadSecretParameters(process.env, (names) => client.send(new GetParametersCommand({ Names: names, WithDecryption: true })));

const { handler: openNextHandler } = await import("./index.mjs");
export const handler = openNextHandler;
