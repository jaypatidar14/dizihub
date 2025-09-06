// src/config.ts
interface Config {
  API_BASE_URL: string;
  SOCKET_URL: string;
}

const config: Config = {
  API_BASE_URL: import.meta.env.VITE_API_URL || "http://localhost:3001",
  SOCKET_URL: import.meta.env.VITE_SOCKET_URL || "http://localhost:3001",
};

export default config;
