import buble from "@rollup/plugin-buble";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

export default {
  input: "maplibre-gl-grid-protocol.js",
  output: [
    {
      file: "docs/maplibre-gl-grid-protocol.js",
      format: "iife",
      globals: { maplibregl: "maplibregl" },
      name: "GridProtocol",
    },
    {
      file: "docs/maplibre-gl-grid-protocol.min.js",
      format: "iife",
      globals: { maplibregl: "maplibregl" },
      name: "GridProtocol",
      plugins: [terser()],
    },
  ],
  plugins: [commonjs(), nodeResolve(), buble({ transforms: { forOf: false } })],
};
