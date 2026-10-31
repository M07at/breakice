import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { c1PreviewPlugin } from './dev/c1-preview-plugin';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [c1PreviewPlugin(), uni()],
});
