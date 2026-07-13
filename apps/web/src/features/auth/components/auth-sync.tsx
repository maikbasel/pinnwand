import { useAuthSync } from "../hooks/use-auth-sync";

// Headless component: drives useAuthSync so GoTrue auth events mirror into the
// query cache. Mounted once in __root.tsx.
export function AuthSync(): null {
  useAuthSync();
  return null;
}
