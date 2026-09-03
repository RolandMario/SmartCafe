import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import { createTransport, Transporter } from 'nodemailer';

/**
 * Email service using nodemailer over SMTP.
 *
 * SMTP credentials come from the environment (SMTP_HOST, SMTP_PORT,
 * SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM, SMTP_FAMILY — see
 * configuration.ts).
 *
 * If SMTP_HOST is not configured the service falls back to logging the email
 * to the server console so local development keeps working without a server.
 */

/** How long to wait for a TCP connection / SMTP greeting before giving up. */
const CONNECTION_TIMEOUT_MS = 15_000;
/** Idle timeout for the socket while the conversation is in progress. */
const SOCKET_TIMEOUT_MS = 60_000;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {}

  /** Lazily builds (and reuses) the nodemailer transport from env config. */
  private async getTransporter(): Promise<Transporter | null> {
    const hostname = this.config.get<string>('SMTP_HOST', '');
    if (!hostname) return null;
    if (!this.transporter) {
      const port = this.config.get<number>('SMTP_PORT', 587);
      // Explicit SMTP_SECURE wins (e.g. SMTP_SECURE=true for 465/SSL); when
      // unset, treat port 465 as implicit-TLS (the common convention) so a
      // missing SMTP_SECURE cannot silently break 465 setups.
      const rawSecure = process.env.SMTP_SECURE;
      const secure = rawSecure !== undefined ? rawSecure === 'true' : port === 465;
      const user = this.config.get<string>('SMTP_USER', '');
      const pass = this.config.get<string>('SMTP_PASS', '');

      const host = await this.resolveHost(hostname);

      this.transporter = createTransport({
        // `host` may be a literal IP (see resolveHost). Keep the original
        // hostname for TLS SNI / certificate validation.
        host,
        ...(host !== hostname ? { servername: hostname } : {}),
        port,
        secure,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: CONNECTION_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
        ...(user ? { auth: { user, pass } } : {}),

        logger: true,
  debug: true,
  tls: {
    // keep true in production; only set false temporarily for diagnosis
    rejectUnauthorized: false,
  },
      });
    }
    return this.transporter;
  }

  /**
   * Resolves the SMTP hostname to a specific address family when SMTP_FAMILY
   * is set ('4' or '6').
   *
   * nodemailer resolves both families and connects to a random address, so on
   * IPv4-only networks it can pick an IPv6 address and die with EHOSTUNREACH.
   * By pinning the family here we pass nodemailer a concrete IP to connect to.
   */
  private async resolveHost(hostname: string): Promise<string> {
    const family = this.config.get<string>('SMTP_FAMILY', '');
    if (family !== '4' && family !== '6') return hostname;
    try {
      const { address } = await lookup(hostname, {
        family: family === '4' ? 4 : 6,
      });
      return address;
    } catch (err) {
      this.logger.warn(
        `Could not resolve ${hostname} to IPv${family} — connecting with the hostname as-is: ${String(err)}`,
      );
      return hostname;
    }
  }

  /**
   * Sends a password-reset verification code to `to`.
   *
   * Transient connection failures are retried once. If delivery fails every
   * time, the code is logged to the console as a dev fallback and the error is
   * re-thrown so the caller can record/log it.
   */
  async sendPasswordResetCode(to: string, code: string): Promise<void> {
    const transporter = await this.getTransporter();
    if (!transporter) {
      this.logger.warn('SMTP_HOST not configured — logging reset code to console instead of emailing.');
      this.logger.log(`Password reset code -> ${to}`);
      this.logger.log(`  Your verification code: ${code}`);
      this.logger.log(
        `  (Dev fallback: no email is actually sent. Use the code above to reset the password.)`,
      );
      return;
    }

    const from = this.config.get<string>('MAIL_FROM', '') || this.config.get<string>('SMTP_USER', '') || 'no-reply@localhost';
    const subject = 'Your password reset code';
    const text = `We received a request to reset the password for your account.

Your password reset code is: ${code}

The code expires in 15 minutes. If you did not request a password reset, you can safely ignore this email.`;

    try {
      await transporter.sendMail({ from, to, subject, text });
    } catch (firstError) {
      // Transient failures (timeouts, dropped connections) often succeed on
      // a retry. Give it one more attempt before giving up.
      const host = this.config.get<string>('SMTP_HOST', '');
      this.logger.warn(
        `SMTP attempt 1/2 failed (${host}:${this.config.get<number>('SMTP_PORT', 587)}) — retrying: ${String(firstError)}`,
      );
      try {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await transporter.sendMail({ from, to, subject, text });
      } catch (secondError) {
        // Dev fallback: keep the flow usable by printing the code even when
        // the SMTP server could not be reached.
        this.logger.error(`SMTP delivery failed after retry: ${String(secondError)}`);
        this.logger.log(`Password reset code -> ${to} (DEV FALLBACK)`);
        this.logger.log(`  Your verification code: ${code}`);
        throw secondError;
      }
    }

    this.logger.log(
      `Password reset code sent to ${to} via SMTP (${this.config.get<string>('SMTP_HOST')})`,
    );
  }
}