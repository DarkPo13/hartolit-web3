/// <reference path="./.sst/platform/config.d.ts" />

// AWS staging for the Hartolit web app (D79): one Next.js site on Lambda in eu-central-1,
// built by OpenNext and served through its own CloudFront distribution. Scale to zero: no
// VPC, NAT, load balancer, container, database or warmer. Every value below was checked
// against the installed SST 4.17.2 platform source (`.sst/platform`, from `sst install`).
// Secrets are set per stage with `sst secret set <Name> --stage staging`; none live here.

// The customer-managed policy every role below is bounded by (D82, infra/aws/iam).
const LAMBDA_BOUNDARY_POLICY = "hartolit-staging-lambda-boundary";

export default $config({
  app(input) {
    return {
      name: "hartolit-field-passport",
      home: "aws",
      // The CLI refuses to run with any other SST version.
      version: "4.17.2",
      // Staging only: `sst remove` deletes everything, including the assets bucket.
      removal: "remove",
      protect: false,
      providers: {
        aws: {
          version: "7.20.0",
          region: "eu-central-1",
          defaultTags: { tags: { Project: "hartolit-field-passport", Stage: input?.stage ?? "unknown" } },
        },
      },
    };
  },
  async run() {
    if ($app.stage !== "staging") throw new Error(`Only the "staging" stage is defined; got "${$app.stage}".`);

    const fs = await import("node:fs");
    const path = await import("node:path");
    // `next build` reads these files and inlines their NEXT_PUBLIC_* values into the
    // browser bundle, and OpenNext copies `.env`/`.env.production` into the Lambda. Deploy
    // from a clean checkout so a developer's local settings cannot reach AWS.
    const envFiles = [".env", ".env.local", ".env.production", ".env.production.local"]
      .filter((file) => fs.existsSync(path.join($cli.paths.root, file)));
    if (envFiles.length) throw new Error(`Deploy from a clean checkout; found ${envFiles.join(", ")}.`);
    // The same for public variables in the deploying shell: only the ones set below may be inlined.
    const publicNames = ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_CHAIN_ID", "NEXT_PUBLIC_CONTRACT_ADDRESS", "NEXT_PUBLIC_DEMO_MODE"];
    const strayPublic = Object.keys(process.env).filter((key) => key.startsWith("NEXT_PUBLIC_") && !publicNames.includes(key));
    if (strayPublic.length) throw new Error(`Unset ${strayPublic.join(", ")} before deploying.`);

    // Every IAM role SST creates here (server, image optimizer, ISR revalidation subscriber,
    // ISR table seeder, and the Lambda@Edge signer in us-east-1) gets this permissions
    // boundary (D82). An administrator creates the policy by hand in the AWS console from
    // infra/aws/iam; SST never manages it, and the deploy role may create roles only with
    // it and cannot change it, so no role's inline policy reaches past it. Registered
    // before any component: SST applies it to every role created afterwards.
    const accountId = aws.getCallerIdentityOutput({}).accountId;
    $transform(aws.iam.Role, (role) => {
      role.permissionsBoundary = $interpolate`arn:aws:iam::${accountId}:policy/${LAMBDA_BOUNDARY_POLICY}`;
    });

    const { CLOUDFRONT_CLIENT_IP_INJECTION } = await import("./lib/client-ip");

    // Stored encrypted in the SST state bucket; the deploy fails until each one is set.
    const databaseUrl = new sst.Secret("DatabaseUrl");
    const betterAuthSecret = new sst.Secret("BetterAuthSecret");
    // The site's own https:// address. The CloudFront URL exists only after the first
    // deploy, so that deploy uses a placeholder and the site refuses sign-in until this is
    // set to the real URL and deployed again (README, "AWS staging").
    const siteUrl = new sst.Secret("SiteUrl");

    // SST's default is one month; merged over each function's arguments.
    const oneWeekOfLogs = { logging: { retention: "1 week" as const } };

    const web = new sst.aws.Nextjs("Web", {
      openNextVersion: "4.1.16",
      regions: ["eu-central-1"],
      warm: 0,
      // CloudFront signs every request to the Lambda function URLs (OAC); a Lambda@Edge
      // function adds the body hash Lambda needs for POST, PUT and PATCH. Direct calls to
      // the function URLs are refused by AWS before the app runs.
      protection: "oac-with-edge-signing",
      // CloudFront writes the viewer's address; the app reads only this header (D78).
      edge: { viewerRequest: { injection: CLOUDFRONT_CLIENT_IP_INJECTION } },
      server: {
        runtime: "nodejs24.x",
        // The server bundle has no native modules (2026-11-13 OpenNext build), so arm64 works and costs 20% less.
        architecture: "arm64",
        memory: "1024 MB",
        // Also CloudFront's origin read timeout (SST copies it); 60 s is CloudFront's default ceiling.
        timeout: "60 seconds",
      },
      // Only the 32 px logo goes through next/image; 512 MB instead of SST's 1536 MB.
      imageOptimization: { memory: "512 MB" },
      invalidation: { paths: "all", wait: false },
      // Available to `next build` and to the server function at runtime.
      environment: {
        HARTOLIT_CLIENT_IP_SOURCE: "cloudfront",
        DATABASE_URL: databaseUrl.value,
        // One request per Lambda instance; keep each instance's database connections few.
        DATABASE_POOL_MAX: "3",
        BETTER_AUTH_SECRET: betterAuthSecret.value,
        BETTER_AUTH_URL: siteUrl.value,
        NEXT_PUBLIC_APP_URL: siteUrl.value,
        NEXT_PUBLIC_CHAIN_ID: "97",
        NEXT_PUBLIC_CONTRACT_ADDRESS: "",
        NEXT_PUBLIC_DEMO_MODE: "false",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      transform: {
        server: oneWeekOfLogs,
        revalidationEventsSubscriber: oneWeekOfLogs,
        revalidationSeeder: oneWeekOfLogs,
        // Edge locations in Europe and North America only; Ukrainian visitors use European ones.
        cdn: (cdn) => {
          cdn.transform = { ...cdn.transform, distribution: (distribution) => { distribution.priceClass = "PriceClass_100"; } };
        },
      },
    });

    return { url: web.url };
  },
});
