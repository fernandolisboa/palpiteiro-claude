import { appIconResponse } from "@/components/brand/app-icon-mark";

// Ícone 192px do manifest (#440). Ver app/icon.tsx.
export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return appIconResponse(size.width, true);
}
