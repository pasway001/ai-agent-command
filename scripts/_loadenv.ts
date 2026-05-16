import { config } from "dotenv";

// Load .env.local first (Next.js convention), then .env (fallback).
config({ path: ".env.local" });
config();
