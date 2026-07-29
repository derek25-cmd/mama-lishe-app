import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

export function sendEmail(to: string, subject: string, html: string) {
  return transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
}
