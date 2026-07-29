/** SMS via Beem Africa (https://docs.beem.africa) */
export async function sendSms(phone: string, message: string) {
  const auth = Buffer.from(`${process.env.BEEM_API_KEY}:${process.env.BEEM_SECRET_KEY}`).toString("base64");
  const res = await fetch("https://apisms.beem.africa/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      source_addr: process.env.BEEM_SENDER_ID ?? "FAIDA",
      encoding: 0,
      message,
      recipients: [{ recipient_id: 1, dest_addr: phone }],
    }),
  });
  if (!res.ok) throw new Error(`Beem SMS failed: ${res.status} ${await res.text()}`);
  return res.json();
}
