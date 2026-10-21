// Files imported with the "?raw" suffix are embedded as text: esbuild.config.mjs does it for the
// bundle and Vite does it for the tests.
declare module "*?raw" {
  const text: string;
  export default text;
}
