import type { Env } from "./env";

export async function sendMagicLinkEmail(
  env: Env,
  email: string,
  link: string,
): Promise<void> {
  const subject = "Your PaceApp login link";
  const text = [
    "Click the link below to sign in to PaceApp:",
    "",
    link,
    "",
    "This link expires in 15 minutes and can only be used once.",
    "If you did not request this, ignore this email.",
  ].join("\n");
  const html = `
    <p>Click the button below to sign in to PaceApp.</p>
    <p><a href="${escapeHtml(link)}"
          style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;">
      Sign in to PaceApp
    </a></p>
    <p style="color:#555;font-size:12px;">
      Or paste this URL: <br><code>${escapeHtml(link)}</code>
    </p>
    <p style="color:#888;font-size:12px;">
      Expires in 15 minutes. If you did not request this, ignore this email.
    </p>`;

  try {
    await env.EMAIL.send({
      to: email,
      from: { email: env.MAGIC_FROM, name: env.MAGIC_FROM_NAME || "PaceApp" },
      subject,
      text,
      html,
    });
  } catch (e) {
    // In local dev without a configured sender, log the link instead of failing.
    console.error("EMAIL.send failed:", e);
    console.log(`[dev magic link for ${email}] ${link}`);
    throw e;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
