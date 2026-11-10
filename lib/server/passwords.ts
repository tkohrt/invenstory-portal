import "server-only";
// One temporary-password generator for every provisioning path (red-team M3,
// 9 Nov 2026). Math.random() is not cryptographically secure and these
// passwords guard brand-new client accounts until the client changes them, a
// window that can last days. crypto.randomBytes(12) gives 96 bits of real
// entropy; base64url keeps it paste-safe.
import crypto from "node:crypto";

export function tempPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}
