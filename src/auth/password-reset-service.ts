import crypto from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { RuntimeConfig } from "../config.js";

const RESET_TOKEN_BYTES = 32;
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;

type PasswordResetEmailInput = {
  email: string;
  resetUrl: string;
  username: string;
};

function hashResetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function parseEmailFrom(value: string) {
  const match = value.match(/^(.*)<(.+)>$/);

  if (!match) {
    return {
      email: value.trim(),
      name: "Vibehall"
    };
  }

  return {
    email: match[2].trim(),
    name: match[1].trim()
  };
}

export function createPasswordResetToken() {
  const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString("base64url");

  return {
    token,
    tokenHash: hashResetToken(token)
  };
}

export function hashPasswordResetToken(token: string) {
  return hashResetToken(token);
}

export function createPasswordResetExpiresAt(now = new Date()) {
  return new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000);
}

export function createPasswordResetUrl(config: RuntimeConfig, token: string) {
  const params = new URLSearchParams({ token });
  return `${normalizeBaseUrl(config.frontendUrl)}/auth/reset?${params.toString()}`;
}

export async function sendPasswordResetEmail(
  config: RuntimeConfig,
  logger: FastifyBaseLogger,
  input: PasswordResetEmailInput
) {
  if (config.emailProvider === "console") {
    logger.info(
      {
        email: input.email,
        resetUrl: input.resetUrl,
        username: input.username
      },
      "Password reset email console delivery"
    );
    return;
  }

  const sender = parseEmailFrom(config.emailFrom);
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    body: JSON.stringify({
      htmlContent: `<p>Hello ${input.username},</p><p>Use this link to reset your Vibehall password. The link expires in ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.</p><p><a href="${input.resetUrl}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`,
      sender,
      subject: "Reset your Vibehall password",
      textContent: `Hello ${input.username},\n\nUse this link to reset your Vibehall password. The link expires in ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.\n\n${input.resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      to: [{ email: input.email, name: input.username }]
    }),
    headers: {
      Accept: "application/json",
      "api-key": config.brevoApiKey ?? "",
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const responseText = await response.text();
    logger.error(
      {
        email: input.email,
        providerStatus: response.status,
        providerText: responseText.slice(0, 300)
      },
      "Password reset email provider failed"
    );
    throw new Error("Password reset email provider failed.");
  }

  logger.info({ email: input.email }, "Password reset email sent");
}
