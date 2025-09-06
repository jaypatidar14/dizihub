// src/config.ts
interface Config {
  API_BASE_URL: string;
  SOCKET_URL: string;
}

const config: Config = {
    API_BASE_URL: import.meta.env.VITE_API_URL || "https://dizihub-jv1r.onrender.com",
  SOCKET_URL: import.meta.env.VITE_SOCKET_URL || "https://dizihub-jv1r.onrender.com",
};

export default config;
