import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { config } from "./config.js";

type Reply = { code: number; text: string };
type Waiter = {
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
};

/** Mini client SMTP : lit les réponses (multi-lignes) par code, supporte TLS implicite (465) et STARTTLS (587). */
class SmtpSession {
  socket: net.Socket;
  private buffer = "";
  private lines: string[] = [];
  private replies: Reply[] = [];
  private waiters: Waiter[] = [];
  private failure: Error | null = null;

  constructor(socket: net.Socket) {
    this.socket = socket;
    this.bind(socket);
  }

  private bind(socket: net.Socket) {
    socket.setTimeout(15_000, () => this.fail(new Error("Délai SMTP dépassé")));
    socket.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    socket.on("error", (err) => this.fail(err));
    socket.on("close", () => this.fail(new Error("Connexion SMTP fermée")));
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      this.lines.push(line);
      // Fin de réponse = code à 3 chiffres suivi d'un espace ("250 OK"), pas d'un tiret ("250-...")
      if (/^\d{3}( |$)/.test(line)) {
        const reply = {
          code: Number(line.slice(0, 3)),
          text: this.lines.join("\n"),
        };
        this.lines = [];
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(reply);
        else this.replies.push(reply);
      }
    }
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    this.socket.destroy();
  }

  private read(): Promise<Reply> {
    const queued = this.replies.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
  }

  async expect(codes: number[]): Promise<Reply> {
    const reply = await this.read();
    if (!codes.includes(reply.code))
      throw new Error(`SMTP ${reply.code} : ${reply.text}`);
    return reply;
  }

  write(line: string) {
    this.socket.write(`${line}\r\n`);
  }

  command(line: string, codes: number[]) {
    this.write(line);
    return this.expect(codes);
  }

  async upgradeToTls(host: string) {
    const raw = this.socket;
    raw.removeAllListeners("data");
    raw.removeAllListeners("close");
    raw.removeAllListeners("error");
    raw.setTimeout(0);
    raw.on("error", () => {});
    this.buffer = "";
    this.lines = [];
    const secure = tls.connect({
      socket: raw,
      servername: net.isIP(host) ? undefined : host,
    });
    this.socket = secure;
    this.bind(secure);
    await new Promise<void>((resolve, reject) => {
      secure.once("secureConnect", () => resolve());
      secure.once("error", reject);
    });
  }

  close() {
    this.socket.end();
  }
}

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeader(value: string) {
  return /^[\x20-\x7e]*$/.test(value)
    ? clean(value)
    : `=?UTF-8?B?${Buffer.from(clean(value), "utf8").toString("base64")}?=`;
}

let resendClient: Resend | null = null;
function getResendClient(): Resend | null {
  if (!config.resendApiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(config.resendApiKey);
  }
  return resendClient;
}

export type SendMailResult = {
  sent: boolean;
  provider: "resend" | "smtp" | "dev";
  messageId?: string;
  error?: string;
};

export async function sendMailSmtp(to: string, subject: string, text: string): Promise<SendMailResult> {
  const { host, port, user, pass, from } = config.smtp;
  const implicitTls = port === 465;
  const servername = net.isIP(host) ? undefined : host;
  const socket = implicitTls
    ? tls.connect({ host, port, servername })
    : net.createConnection({ host, port });
  const session = new SmtpSession(socket);
  try {
    await session.expect([220]);
    let caps = (await session.command("EHLO savora.local", [250])).text;
    let encrypted = implicitTls;
    if (!encrypted && /STARTTLS/i.test(caps)) {
      await session.command("STARTTLS", [220]);
      await session.upgradeToTls(host);
      encrypted = true;
      caps = (await session.command("EHLO savora.local", [250])).text;
    }
    if (user) {
      if (!encrypted)
        throw new Error(
          "SMTP : connexion non chiffrée, authentification refusée",
        );
      if (/AUTH[ =].*PLAIN/i.test(caps)) {
        await session.command(
          `AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString("base64")}`,
          [235],
        );
      } else {
        await session.command("AUTH LOGIN", [334]);
        await session.command(Buffer.from(user).toString("base64"), [334]);
        await session.command(Buffer.from(pass).toString("base64"), [235]);
      }
    }
    const fromAddress = extractEmail(from);
    const recipient = clean(to);
    await session.command(`MAIL FROM:<${fromAddress}>`, [250]);
    await session.command(`RCPT TO:<${recipient}>`, [250, 251]);
    await session.command("DATA", [354]);
    const messageId = `<${randomUUID()}@${fromAddress.split("@")[1] || "savora.local"}>`;
    const message = [
      `From: ${clean(from)}`,
      `To: ${recipient}`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(text, "utf8")
        .toString("base64")
        .replace(/(.{76})/g, "$1\r\n"),
    ].join("\r\n");
    session.write(`${message}\r\n.`);
    await session.expect([250]);
    session.write("QUIT");
    return { sent: true, provider: "smtp", messageId };
  } finally {
    session.close();
  }
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(
  toOrOptions: string | SendMailOptions,
  subjectArg?: string,
  textArg?: string,
  htmlArg?: string,
): Promise<SendMailResult> {
  let to: string;
  let subject: string;
  let text: string;
  let html: string | undefined;

  if (typeof toOrOptions === "object" && toOrOptions !== null) {
    to = toOrOptions.to;
    subject = toOrOptions.subject;
    text = toOrOptions.text;
    html = toOrOptions.html;
  } else {
    to = toOrOptions;
    subject = subjectArg ?? "";
    text = textArg ?? "";
    html = htmlArg;
  }

  const recipient = clean(to);
  const subjectLine = clean(subject);

  // 1. Tenter via Resend SDK si la clé API est configurée
  const resend = getResendClient();
  if (resend) {
    try {
      const fromAddress = config.emailFrom || "onboarding@resend.dev";
      const { data, error } = await resend.emails.send({
        from: fromAddress,
        to: recipient,
        subject: subjectLine,
        text,
        html: html || text.replace(/\n/g, "<br/>"),
      });

      if (error) {
        console.warn(`[mail:resend] Échec Resend (${error.name}): ${error.message}`);
        if (config.smtp.host) {
          console.info("[mail:fallback] Tentative d'envoi via SMTP...");
          return await sendMailSmtp(to, subject, text);
        }
        if (!config.isProd) {
          console.info(`[mail:dev:fallback] to=${recipient} subject=${subjectLine}\n${text}`);
          return { sent: false, provider: "dev", error: error.message };
        }
        throw new Error(`Erreur Resend : ${error.message}`);
      }

      console.info(`[mail:resend:success] E-mail envoyé à ${recipient} (id=${data?.id})`);
      return { sent: true, provider: "resend", messageId: data?.id };
    } catch (resendErr) {
      console.warn("[mail:resend:exception]", resendErr instanceof Error ? resendErr.message : "Erreur inconnue");
      if (config.smtp.host) {
        return await sendMailSmtp(to, subject, text);
      }
      if (!config.isProd) {
        console.info(`[mail:dev:fallback] to=${recipient} subject=${subjectLine}\n${text}`);
        return { sent: false, provider: "dev", error: resendErr instanceof Error ? resendErr.message : "Erreur" };
      }
      throw resendErr;
    }
  }

  // 2. SMTP si configuré
  if (config.smtp.host) {
    try {
      return await sendMailSmtp(to, subject, text);
    } catch (smtpErr) {
      console.warn("[mail:smtp:error]", smtpErr instanceof Error ? smtpErr.message : "Erreur SMTP");
      if (!config.isProd) {
        console.info(`[mail:dev:fallback] to=${recipient} subject=${subjectLine}\n${text}`);
        return { sent: false, provider: "dev", error: smtpErr instanceof Error ? smtpErr.message : "Erreur" };
      }
      throw smtpErr;
    }
  }

  // 3. Mode dev / aucun service configuré
  if (!config.isProd) {
    console.info(`[mail:dev] to=${recipient} subject=${subjectLine}\n${text}`);
    return { sent: false, provider: "dev" };
  }

  throw new Error("Aucun service d'e-mail configuré (RESEND_API_KEY ou SMTP requis).");
}

function extractEmail(from: string) {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

export async function sendVerificationEmail(
  to: string,
  link: string,
  code?: string,
): Promise<SendMailResult> {
  const codePart = code
    ? `Votre code de confirmation : ${code} (valable 15 minutes).\n\nOu `
    : "";
  return await sendMail(
    to,
    "Confirmez votre adresse — Savora",
    `Bonjour,\n\n${codePart}${code ? "o" : "O"}uvrez ce lien pour confirmer votre adresse (valable 24 h) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez ce message.\n`,
  );
}

export async function sendPasswordResetEmail(
  to: string,
  link: string,
): Promise<SendMailResult> {
  return await sendMail(
    to,
    "Réinitialisation du mot de passe — Savora",
    `Bonjour,\n\nPour choisir un nouveau mot de passe (lien valable 1 h) :\n${link}\n\nSi vous n'avez rien demandé, vous pouvez ignorer ce message en toute sécurité.\n`,
  );
}

