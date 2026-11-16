import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile("package.json", "utf8"));
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await build({
  entryPoints: ["src/host.js"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "eof",
  sourcemap: false,
  define: { __LIFE_DESK_VERSION__: JSON.stringify(manifest.version) },
});
const client = await build({
  entryPoints: ["src/client.tsx"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["react", "react-dom", "react-dom/*"],
  loader: { ".css": "text", ".png": "dataurl", ".webp": "dataurl" },
  write: false,
  legalComments: "eof",
  define: {
    "process.env.NODE_ENV": '"production"',
    __LIFE_DESK_VERSION__: JSON.stringify(manifest.version),
  },
});
const code = client.outputFiles[0].text;
await writeFile(
  "dist/client.js",
  `window.__ModuleLoader__.load({id:'dsh-time-desk',factory(require){var module={exports:{}};var exports=module.exports;\n${code}\nreturn module.exports;}});\n`,
);
console.log(
  "Built self-contained Host and Client bundles. React stays external to use the DSH runtime.",
);
