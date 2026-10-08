// Optional production build check. The Python server serves web/ directly;
// dist/ is not deployed. All three application pages are built so the build
// covers the SEDENS home, the room screen and the coaching workspace.
// anatomy.html relies on an import map and is served from source, as before.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(here, "index.html"),
        workspace: resolve(here, "workspace.html"),
        room: resolve(here, "room.html"),
      },
    },
  },
});
