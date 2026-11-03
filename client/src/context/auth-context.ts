import { createContext } from "react";
import type { Me } from "../types";

export interface AuthContextValue {
  me: Me | null | undefined; // undefined = still loading
  refresh: () => void;
}

export const AuthContext = createContext<AuthContextValue>({ me: undefined, refresh: () => {} });
