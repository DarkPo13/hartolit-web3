// Copies the server's SSM parameters into process.env before the application loads.
// Any problem stops the cold start: the app never runs with a missing secret. Errors name
// environment variables only, never a value.
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const PARAMETER_NAME = /^\/hartolit\/(staging|production)\/[a-z0-9-]+$/;
// The GetParameters API accepts at most 10 names per call.
const MAX_PARAMETERS = 10;

function parseSpec(raw) {
  let spec;
  try {
    spec = JSON.parse(raw ?? "");
  } catch {
    throw new Error("HARTOLIT_SECRET_PARAMETERS is not valid JSON");
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("HARTOLIT_SECRET_PARAMETERS must be an object");
  const entries = Object.entries(spec);
  if (entries.length === 0) throw new Error("HARTOLIT_SECRET_PARAMETERS is empty");
  for (const [envName, parameter] of entries) {
    if (!ENV_NAME.test(envName) || typeof parameter !== "string" || !PARAMETER_NAME.test(parameter)) {
      throw new Error(`HARTOLIT_SECRET_PARAMETERS has an invalid entry for ${ENV_NAME.test(envName) ? envName : "an unnamed variable"}`);
    }
  }
  return entries;
}

export async function loadSecretParameters(env, getParameters) {
  const entries = parseSpec(env.HARTOLIT_SECRET_PARAMETERS);
  const names = [...new Set(entries.map(([, parameter]) => parameter))];
  if (names.length > MAX_PARAMETERS) throw new Error("HARTOLIT_SECRET_PARAMETERS lists too many parameters");

  const result = await getParameters(names);
  if (result?.InvalidParameters?.length) throw new Error("A required SSM parameter is missing");
  const values = new Map((result?.Parameters ?? []).map((parameter) => [parameter.Name, parameter.Value]));

  for (const [envName, parameter] of entries) {
    const value = values.get(parameter);
    if (typeof value !== "string" || value.length === 0) throw new Error(`No value for ${envName}`);
  }
  for (const [envName, parameter] of entries) env[envName] = values.get(parameter);
  delete env.HARTOLIT_SECRET_PARAMETERS;
}
