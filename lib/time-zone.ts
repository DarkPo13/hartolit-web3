/** Accept a named IANA zone (or UTC); never infer a zone from the browser. */
export function isSupportedTimeZone(value: string): boolean {
  if (value !== "UTC" && !value.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
