import { randomBytes } from "node:crypto";

export function generateReportShareSlug() {
  return randomBytes(9).toString("base64url");
}

export function buildReportUrl(slug: string, baseUrl?: string) {
  const resolvedBaseUrl =
    baseUrl ??
    (typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXTAUTH_URL ?? "http://localhost:3000");

  return `${resolvedBaseUrl.replace(/\/$/, "")}/reports/${slug}`;
}

export function isReportBranded() {
  return true;
}

export function getBrandInitials(name: string) {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return "RF";
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

export function getReadableTextColor(hexColor: string) {
  const fallback = "#112620";
  const normalized = /^#[0-9A-Fa-f]{6}$/.test(hexColor) ? hexColor : fallback;
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1_000;
  return luminance > 150 ? "#112620" : "#FFFFFF";
}
