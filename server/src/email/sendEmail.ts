export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || "Whiteboard <no-reply@example.com>";
}

// Sends via Resend's HTTP API directly (plain fetch — no SDK dependency
// needed for one endpoint). EMAIL_API_KEY unset means dev mode: the message
// (including any reset link) is logged instead of sent, so the flow stays
// testable locally with zero external setup.
//
// ponytail: until EMAIL_FROM points at a domain verified in Resend, sending
// from the default onboarding@resend.dev sandbox address only delivers to
// the email on the Resend account itself — fine for testing, not for real
// users. Verify a domain in the Resend dashboard and set EMAIL_FROM to it
// when this needs to reach real inboxes.
export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.EMAIL_API_KEY;
  if (!apiKey) {
    console.log(`[email:dev] from=${fromAddress()} to=${message.to} subject="${message.subject}"\n${message.text}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}
