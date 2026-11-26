// Runs the pinned Terraform image for the local checks. Everything after the one provider
// download happens in a container with no network and no AWS variables, so these checks
// cannot reach AWS, Neon or anything else.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const IMAGE = "hashicorp/terraform:1.17.2@sha256:6e9c1e647c31a960dc9b59e13272f9111d90010c10b717f77ffb324767660475";
export const PLUGIN_VOLUME = "hartolit-terraform-plugins";
export const TF = "/work/infra/terraform";
export const ROOTS = [
  "modules/opennext-site",
  "modules/github-oidc-roles",
  "bootstrap",
  "envs/staging/site",
  "envs/staging/secrets",
  "envs/production/site",
  "envs/production/secrets",
];

export function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, ...options });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

export function copyWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hartolit-terraform-"));
  const skip = (source) => !/[\\/](\.terraform|\.build)([\\/]|$)/.test(source) && !/\.tfstate(\.|$)/.test(source);
  fs.cpSync("infra/terraform", path.join(dir, "infra/terraform"), { recursive: true, filter: skip });
  fs.cpSync("public", path.join(dir, "public"), { recursive: true });
  return dir;
}

// The only step with network: fetches the pinned providers, verified against the lock file.
export function ensureProviders(workspace) {
  const probe = docker(["run", "--rm", "--network", "none", "-v", `${PLUGIN_VOLUME}:/plugins:ro`, "--entrypoint", "sh", IMAGE, "-c",
    "test -d /plugins/registry.terraform.io/hashicorp/aws/6.73.0/linux_amd64 && test -d /plugins/registry.terraform.io/hashicorp/archive/2.8.1/linux_amd64"]);
  if (probe.status === 0) return;
  const result = docker(["run", "--rm", "-e", "TF_PLUGIN_CACHE_DIR=/plugins", "-v", `${PLUGIN_VOLUME}:/plugins`, "-v", `${workspace}:/src:ro`, "--entrypoint", "sh", IMAGE, "-c",
    "cp -r /src /work && cd /work/infra/terraform/envs/staging/site && terraform init -backend=false -input=false -lockfile=readonly -no-color"]);
  if (result.status !== 0) throw new Error(`Provider download failed\n${result.output}`);
}

export function startContainer(workspace) {
  const name = `hartolit-terraform-${crypto.randomBytes(4).toString("hex")}`;
  const started = docker(["run", "-d", "--rm", "--name", name, "--network", "none", "-e", "TF_IN_AUTOMATION=1", "-e", "AWS_EC2_METADATA_DISABLED=true",
    "-v", `${PLUGIN_VOLUME}:/plugins:ro`, "--entrypoint", "sleep", IMAGE, "3600"]);
  if (started.status !== 0) throw new Error(`Container did not start\n${started.output}`);
  const copied = docker(["cp", `${workspace}${path.sep}.`, `${name}:/work`]);
  if (copied.status !== 0) { docker(["rm", "-f", name]); throw new Error(`Copy failed\n${copied.output}`); }
  return name;
}

export function stopContainer(name) {
  docker(["rm", "-f", name]);
}

export function terraform(container, root, args, env = {}) {
  const environment = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  return docker(["exec", ...environment, "-w", `${TF}/${root}`, container, "terraform", ...args]);
}

export function initRoot(container, root) {
  const result = terraform(container, root, ["init", "-backend=false", "-input=false", "-no-color", "-lockfile=readonly", "-plugin-dir=/plugins"]);
  if (result.status !== 0) throw new Error(`terraform init failed in ${root}\n${result.output}`);
}
