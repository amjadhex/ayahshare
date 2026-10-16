// Email sign-in: sending the 6-digit code, through Cloudflare Email Sending (the `send_email` binding EMAIL in
// wrangler.jsonc). Without that binding, or without the AUTH_CODE_SECRET secret (the key the codes are hashed with),
// email sign-in is off: /api/config says emailSignIn false and the routes answer 503.

/** Who the codes come from. Must be one of the binding's allowed_sender_addresses (wrangler.jsonc). */
export const EMAIL_FROM = { name: "AyahShare", email: "hello@ayahshare.com" };
export const CODE_MINUTES = 10;

export class EmailUnavailable extends Error {}

export const emailSignInEnabled = (env: Env) => !!env.EMAIL && !!env.AUTH_CODE_SECRET;

export interface EmailMessage { to: string; subject: string; text: string; html: string }

/** Sends through the EMAIL binding; throws EmailUnavailable when it is not bound. */
export async function sendEmail(env: Env, msg: EmailMessage): Promise<void> {
  if (!env.EMAIL) throw new EmailUnavailable("no email sender configured");
  await env.EMAIL.send({ from: EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
}

/** The sign-in code email, in AyahShare's look (owner, 9 Oct 2026): the logo (one image, from our own site, so no
 *  tracking), the code large on an emerald tint, and the tagline. Table layout and inline styles, so mail apps show it
 *  the same; the plain-text part says the same. */
export const EMAIL_LOGO = "https://ayahshare.com/brand/email-lockup.png";
export function codeEmail(to: string, code: string): EmailMessage {
  const subject = `Your AyahShare code: ${code}`;
  const text = [
    `Your AyahShare sign-in code is ${code}`,
    "",
    `It expires in ${CODE_MINUTES} minutes.`,
    "",
    "If you didn't ask for this, you can ignore this email.",
    "",
    "AyahShare · An ayah for every moment. · https://ayahshare.com",
  ].join("\n");
  const font = "font-family:'Montserrat','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f1ea">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;background:#ffffff;border-radius:20px;border:1px solid #e7e2d7">
<tr><td align="center" style="padding:28px 24px 8px">
<img src="${EMAIL_LOGO}" width="200" height="47" alt="AyahShare" style="display:block;border:0;width:200px;height:auto;${font};font-size:22px;font-weight:700;color:#0f5c4d">
</td></tr>
<tr><td align="center" style="padding:16px 28px 0;${font};color:#141414">
<p style="margin:0;font-size:17px;line-height:1.5;font-weight:600">Your sign-in code</p>
</td></tr>
<tr><td align="center" style="padding:16px 28px">
<div style="display:inline-block;padding:16px 22px;border-radius:14px;background:#eef4f2;border:1px solid #cfe2dc;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:34px;line-height:1.2;font-weight:700;letter-spacing:10px;color:#0f5c4d">${code}</div>
</td></tr>
<tr><td align="center" style="padding:0 28px 8px;${font};color:#3b3a36">
<p style="margin:0;font-size:15px;line-height:1.5">It expires in ${CODE_MINUTES} minutes.</p>
</td></tr>
<tr><td align="center" style="padding:8px 28px 28px;${font};color:#6b6b6b">
<p style="margin:0;font-size:13px;line-height:1.5">If you didn't ask for this, you can ignore this email.</p>
</td></tr>
<tr><td style="height:4px;background:#d9a648;border-radius:0 0 20px 20px;font-size:0;line-height:0">&nbsp;</td></tr>
</table>
<p style="margin:16px 0 0;${font};font-size:12px;line-height:1.5;color:#8a857a">An ayah for every moment. · <a href="https://ayahshare.com" style="color:#0f5c4d;text-decoration:none;font-weight:600">ayahshare.com</a></p>
</td></tr>
</table>
</body>
</html>`;
  return { to, subject, text, html };
}

/** For logs: an error with addresses and 6-digit numbers (codes) taken out. */
export const scrubbed = (e: unknown) => String(e).replace(/[^\s@<>"']+@[^\s@<>"']+/g, "<email>").replace(/\b\d{6}\b/g, "<code>").slice(0, 300);
