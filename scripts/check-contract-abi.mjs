import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { HARTOLIT_PASSPORT_ABI } from "../lib/contract.ts";

const artifactPath = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../contracts/out/HartolitFieldPassport.sol/HartolitFieldPassport.json", import.meta.url));

const { abi: compiledAbi } = JSON.parse(await readFile(artifactPath, "utf8"));
if (!Array.isArray(compiledAbi)) throw new Error(`Missing compiled ABI in ${artifactPath}`);

function signature(entry) {
  return `${entry.type}:${entry.name ?? ""}(${entry.inputs.map(({ type }) => type).join(",")})`;
}

function inputs(entry) {
  return entry.inputs.map(({ name, type, indexed }) =>
    entry.type === "event" ? { name, type, indexed } : { name, type },
  );
}

function outputs(entry) {
  return (entry.outputs ?? []).map(({ name, type }) => ({ name, type }));
}

const compiledBySignature = new Map(compiledAbi.map((entry) => [signature(entry), entry]));
const checked = new Set();
const failures = [];

for (const declared of HARTOLIT_PASSPORT_ABI) {
  const key = signature(declared);
  if (checked.has(key)) {
    failures.push(`${key}: duplicate declaration`);
    continue;
  }
  checked.add(key);

  const compiled = compiledBySignature.get(key);
  if (!compiled) {
    failures.push(`${key}: absent from compiled contract`);
    continue;
  }

  if (JSON.stringify(inputs(declared)) !== JSON.stringify(inputs(compiled))) {
    failures.push(`${key}: inputs differ from compiled contract`);
  }
  if (declared.type === "event") {
    if (declared.anonymous !== compiled.anonymous) {
      failures.push(`${key}: anonymous flag differs from compiled contract`);
    }
  } else {
    if (declared.stateMutability !== compiled.stateMutability) {
      failures.push(`${key}: state mutability differs from compiled contract`);
    }
    const actualOutputs = outputs(compiled);
    const expectedOutputs = outputs(declared);
    if (expectedOutputs.length !== actualOutputs.length ||
        expectedOutputs.some((output, index) => output.type !== actualOutputs[index].type ||
          (output.name !== undefined && output.name !== actualOutputs[index].name))) {
      failures.push(`${key}: outputs differ from compiled contract`);
    }
  }
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`Contract ABI matches ${checked.size} declared entries in compiled artifact.`);
}
