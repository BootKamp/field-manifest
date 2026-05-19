import "../styles/globals.css";
import { useEffect } from "react";

export default function App({ Component, pageProps }) {
  // Shim window.storage on top of localStorage so the existing component code
  // (originally written for the Claude artifact platform) works unchanged.
  // This runs on the client only.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.storage) return;

    window.storage = {
      get: async (key) => {
        const val = localStorage.getItem(key);
        if (val === null) throw new Error("Key not found");
        return { key, value: val, shared: false };
      },
      set: async (key, value) => {
        localStorage.setItem(key, value);
        return { key, value, shared: false };
      },
      delete: async (key) => {
        localStorage.removeItem(key);
        return { key, deleted: true, shared: false };
      },
      list: async (prefix = "") => {
        const keys = Object.keys(localStorage).filter((k) =>
          k.startsWith(prefix)
        );
        return { keys, prefix, shared: false };
      },
    };
  }, []);

  return <Component {...pageProps} />;
}
