import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class InvitationMailerService {
  async send(input: { email: string; displayName: string; token: string; tenantName: string }) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, WEB_APP_URL } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM || !WEB_APP_URL) {
      throw new ServiceUnavailableException('Envio de convites por e-mail ainda não está configurado.');
    }
    const port = Number(SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ServiceUnavailableException('Configuração de e-mail inválida.');
    }
    const baseUrl = WEB_APP_URL.replace(/\/$/, '');
    const inviteUrl = `${baseUrl}/accept-invitation#token=${encodeURIComponent(input.token)}`;
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    try {
      await transport.sendMail({
        from: SMTP_FROM,
        to: input.email,
        subject: `Convite para acessar ${input.tenantName}`,
        text: `Olá, ${input.displayName}. Você foi convidado(a) para acessar ${input.tenantName}. O convite expira em 72 horas. Acesse: ${inviteUrl}`,
        html: `<p>Olá, ${this.escape(input.displayName)}.</p><p>Você foi convidado(a) para acessar <strong>${this.escape(input.tenantName)}</strong>.</p><p>O convite expira em 72 horas.</p><p><a href="${this.escape(inviteUrl)}">Aceitar convite</a></p>`,
      });
    } catch {
      throw new ServiceUnavailableException('Não foi possível enviar o convite por e-mail. Tente novamente.');
    } finally {
      transport.close();
    }
  }

  private escape(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  }
}
