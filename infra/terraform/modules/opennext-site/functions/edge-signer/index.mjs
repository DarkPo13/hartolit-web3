// Lambda@Edge, origin-request, with the body included. Lambda function URLs behind CloudFront
// OAC refuse POST, PUT and PATCH without the body's SHA-256. The body is never logged or
// changed. An unexpected error reaches CloudFront as a failure, so nothing goes out unsigned.
import { createHash } from "node:crypto";

const HASHED_METHODS = new Set(["POST", "PUT", "PATCH"]);

function refuse(status, statusDescription, message) {
  return {
    status,
    statusDescription,
    headers: {
      "cache-control": [{ key: "Cache-Control", value: "no-store" }],
      "content-type": [{ key: "Content-Type", value: "application/json" }],
    },
    body: JSON.stringify({ error: message }),
  };
}

export const handler = async (event) => {
  const request = event.Records[0].cf.request;
  if (!HASHED_METHODS.has(request.method)) return request;

  const body = request.body;
  // CloudFront cuts the body at 1 MB here; a hash of part of it would be wrong.
  if (body?.inputTruncated) return refuse("413", "Payload Too Large", "Request body exceeds the 1 MB limit.");

  let bytes = Buffer.alloc(0);
  if (body?.data) {
    if (body.encoding === "base64") bytes = Buffer.from(body.data, "base64");
    else if (body.encoding === "text") bytes = Buffer.from(body.data, "utf8");
    else return refuse("400", "Bad Request", "Unsupported request body encoding.");
  }

  request.headers["x-amz-content-sha256"] = [{
    key: "x-amz-content-sha256",
    value: createHash("sha256").update(bytes).digest("hex"),
  }];
  return request;
};
