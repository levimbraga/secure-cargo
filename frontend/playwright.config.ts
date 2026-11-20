import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);

/**
 * Browser tests: the parity of the live lab (MuJoCo WebAssembly in headless Chromium) with the
 * server's results. They need a production build: `pnpm build && pnpm e2e`.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The API allows http://localhost:3000, not 127.0.0.1. Software WebGL, so the 3D scene also renders on machines without a GPU.
        launchOptions: {
          args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
          // An already installed Chromium can be used instead of the one Playwright downloads.
          executablePath: process.env.E2E_CHROMIUM || undefined,
        },
      },
    },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/app`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
