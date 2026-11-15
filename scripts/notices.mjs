import { readFile, writeFile } from "node:fs/promises";
const packages = [
  "@fullcalendar/core",
  "@fullcalendar/daygrid",
  "@fullcalendar/timegrid",
  "@fullcalendar/interaction",
  "@fullcalendar/react",
  "preact",
  "lunar-typescript",
  "rrule",
  "tslib",
  "zod",
];
let out =
  "# Third-party notices\n\nThe distributed bundles include the libraries below. React is provided by DeepSeek Harness and is not bundled.\n\n";
for (const name of packages) {
  const root = "node_modules/" + name + "/";
  const pkg = JSON.parse(await readFile(root + "package.json", "utf8"));
  let license = "";
  for (const f of [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENCE",
    "license",
    "license.md",
  ]) {
    try {
      license = await readFile(root + f, "utf8");
      break;
    } catch {}
  }
  if (!license) throw new Error("License missing: " + name);
  out += `## ${name} ${pkg.version}\n\nLicense: ${pkg.license}\n\n\`\`\`text\n${license.trim()}\n\`\`\`\n\n`;
}
await writeFile("THIRD_PARTY_NOTICES.md", out);
console.log(
  "Collected redistribution notices for " +
    packages.length +
    " bundled libraries.",
);
