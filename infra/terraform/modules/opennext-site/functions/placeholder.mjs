// Stands in until the first application deploy. A web request gets 503; any other event
// fails, so a queued revalidation is retried instead of being acknowledged and lost.
export const handler = async (event) => {
  if (!event?.requestContext?.http) throw new Error("The application package is not deployed");
  return {
    statusCode: 503,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    body: "Service unavailable",
  };
};
