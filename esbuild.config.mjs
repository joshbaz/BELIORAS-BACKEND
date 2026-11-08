import esbuild from "esbuild";

/**
 * Bundles the API into dist/index.cjs — the same setup as the Artistry 360
 * server. `yarn build` runs it once for production (minified); `--watch`
 * rebuilds on every change.
 *
 * node_modules stay external (Prisma's engine, bcrypt and friends are loaded
 * from node_modules at runtime), so the bundle is only our own code — plus the
 * seed JSON files, which are imported with `with { type: "json" }` and inlined.
 */

const isProduction = process.env.NODE_ENV === "production";
const watch = process.argv.includes("--watch");

async function build() {
  try {
    const context = await esbuild.context({
      entryPoints: ["src/index.js"],
      platform: "node",
      bundle: true,
      packages: "external",
      outdir: "dist",
      outExtension: { ".js": ".cjs" },
      format: "cjs",
      target: "node22",
      sourcemap: true,
      minify: isProduction,
      logLevel: "info",
    });

    if (watch) {
      await context.watch();
      console.log("✨ Build succeeded & watching the files.");
    } else {
      await context.rebuild();
      await context.dispose();
      console.log("✨ Build succeeded & disposed the context.");
    }
  } catch (error) {
    console.error("Build: failed", error);
    process.exit(1);
  }
}

build();
