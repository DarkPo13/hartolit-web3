import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      // React Compiler hints — these are noisy warnings about RHF's watch()
      "react-hooks/incompatible-library": "off",
      // Allow intentional state updates inside effects (sync-from-prop pattern, async flows)
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: ["contracts/**", ".next/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default config;
