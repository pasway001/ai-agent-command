import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function formatUsd(n: number | string): string {
  return usdFormatter.format(Number(n));
}

const numFormatter = new Intl.NumberFormat("ja-JP");

export function formatNum(n: number | string): string {
  return numFormatter.format(Number(n));
}

const SYSTEM_LABELS_MAP: Record<number, string> = {
  1: "Scout",
  2: "LP",
  3: "Ad",
  4: "Outreach",
  5: "CS",
  6: "Review",
};

export function systemLabel(no: number): string {
  return SYSTEM_LABELS_MAP[no] ?? `?(${no})`;
}

const SYSTEM_HUE_MAP: Record<number, string> = {
  1: "bg-sky-500",
  2: "bg-violet-500",
  3: "bg-amber-500",
  4: "bg-emerald-500",
  5: "bg-rose-500",
  6: "bg-slate-500",
};

export function systemHue(no: number): string {
  return SYSTEM_HUE_MAP[no] ?? "bg-slate-500";
}
