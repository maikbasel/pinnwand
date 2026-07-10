import {
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config";

// The brand blue (Modern Minimal `--primary`, oklch(0.6231 0.188 259.8145))
// baked as a literal sRGB hex: the generator's rasterizer (resvg) does not
// parse `oklch()`, and it fills the maskable/apple safe-zone padding with this
// solid colour so no generated icon is ever transparent — the empty-icon
// failure mode seen on Android PWAs.
const PINNWAND_BG = "#3b82f6";

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    ...minimal2023Preset,
    maskable: {
      sizes: [512],
      padding: 0.1,
      resizeOptions: { fit: "contain", background: PINNWAND_BG },
    },
    apple: {
      sizes: [180],
      padding: 0.1,
      resizeOptions: { fit: "contain", background: PINNWAND_BG },
    },
  },
  images: ["public/favicon.svg"],
});
