// Keep the package-local configuration available when Logos imports an adapter directly.
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch {}
