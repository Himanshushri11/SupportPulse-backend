const nodemailer = require('nodemailer');
const { config } = require('../config');
const { logger } = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// STATUS / PRIORITY COLOR MAPS (inline CSS for email client compatibility)
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  OPEN:        { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
  IN_PROGRESS: { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  PENDING:     { bg: '#ffedd5', color: '#9a3412', border: '#fdba74' },
  RESOLVED:    { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  REOPENED:    { bg: '#fce7f3', color: '#9d174d', border: '#f9a8d4' },
  CLOSED:      { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
};

const PRIORITY_COLORS = {
  URGENT: { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
  HIGH:   { bg: '#ffedd5', color: '#9a3412', border: '#fdba74' },
  MEDIUM: { bg: '#fef9c3', color: '#854d0e', border: '#fde047' },
  LOW:    { bg: '#f0fdf4', color: '#166534', border: '#86efac' },
};

class NotificationService {
  constructor() {
    this.transporter = null;
    this.initTransporter();
  }

  // ─── Infrastructure ────────────────────────────────────────────────────────

  initTransporter() {
    if (config.email.smtp.host && config.email.smtp.user) {
      this.transporter = nodemailer.createTransport({
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.secure,
        auth: {
          user: config.email.smtp.user,
          pass: config.email.smtp.pass,
        },
      });
      // Safe SMTP config dump (NO password)
      logger.info('[SMTP] Transporter initialized', {
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.secure,
        user: config.email.smtp.user,
        fromAddress: config.email.from,
      });
    } else {
      logger.warn('[SMTP] Missing SMTP_HOST or SMTP_USER — email sending disabled.');
    }
  }

  async verifyConnection() {
    if (!this.transporter) return false;
    try {
      await this.transporter.verify();
      logger.info('SMTP connection verification succeeded.');
      return true;
    } catch (err) {
      logger.error(`SMTP verification failed: ${err.message}`);
      return false;
    }
  }

  /** Prevent HTML injection in all user-supplied values */
  s(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── Template Helpers ──────────────────────────────────────────────────────

  /**
   * Consistent subject line format:
   * [SupportPulse] [TKT-2026-000510] Event — Subject title
   */
  buildSubject(ticketNumber, event, ticketTitle) {
    const num = this.s(ticketNumber || 'N/A');
    const title = this.s(ticketTitle || 'Support Request');
    return event
      ? `[SupportPulse] [${num}] ${event} — ${title}`
      : `[SupportPulse] [${num}] ${title}`;
  }

  /** Colored inline badge (email-safe, inline CSS) */
  getStatusBadge(status) {
    const c = STATUS_COLORS[String(status).toUpperCase()] || { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:9999px;font-size:12px;font-weight:700;background:${c.bg};color:${c.color};border:1px solid ${c.border};">${this.s(status)}</span>`;
  }

  getPriorityBadge(priority) {
    const c = PRIORITY_COLORS[String(priority).toUpperCase()] || { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:9999px;font-size:12px;font-weight:700;background:${c.bg};color:${c.color};border:1px solid ${c.border};">${this.s(priority)}</span>`;
  }

  /**
   * Dark branded email header with event title.
   */
  getEmailHeader(eventTitle) {
    return `
    <div style="background:#0f172a;border-radius:12px 12px 0 0;padding:28px 32px 24px;text-align:center;">
      <div style="font-size:22px;font-weight:900;color:#38bdf8;letter-spacing:-0.5px;margin-bottom:8px;">SupportPulse</div>
      <div style="font-size:15px;font-weight:600;color:#e2e8f0;">${this.s(eventTitle)}</div>
    </div>`;
  }

  /**
   * Two-column ticket summary card.
   * @param {Array<{label, value, raw}>} fields — raw=true skips escaping (for badges)
   */
  getTicketSummaryCard(fields) {
    const rows = fields
      .filter((f) => f.value !== undefined && f.value !== null && f.value !== '')
      .map((f) => {
        const val = f.raw ? f.value : `<span style="color:#1e293b;">${this.s(f.value)}</span>`;
        return `
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;white-space:nowrap;border-bottom:1px solid #e2e8f0;width:38%;">${this.s(f.label)}</td>
          <td style="padding:10px 16px;font-size:13px;color:#1e293b;font-weight:500;border-bottom:1px solid #e2e8f0;">${val}</td>
        </tr>`;
      })
      .join('');

    return `
    <div style="margin:20px 0;">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <div style="background:#1e293b;padding:10px 16px;">
          <span style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;">Ticket Details</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      </div>
    </div>`;
  }

  /**
   * Latest update / reply box.
   * @param {string} label  e.g. "Latest Reply", "Assignment Update", "Status Update"
   * @param {string} html   pre-escaped or raw html content for the body
   */
  getUpdateSection(label, html) {
    return `
    <div style="margin:20px 0;">
      <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">${this.s(label)}</div>
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-left:4px solid #0ea5e9;border-radius:8px;padding:16px 20px;font-size:14px;color:#0f172a;line-height:1.7;word-break:break-word;">${html}</div>
    </div>`;
  }

  /** Primary CTA button linking to the ticket in the frontend. */
  getViewTicketButton(ticketId) {
    if (!ticketId || !config.frontendUrl) return '';
    const url = `${config.frontendUrl}/tickets/${ticketId}`;
    return `
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${url}" style="display:inline-block;background:#0ea5e9;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:8px;">View Ticket</a>
    </div>`;
  }

  /** Consistent email footer. */
  getEmailFooter(ticketNumber) {
    const year = new Date().getFullYear();
    const num = ticketNumber ? `<div style="margin-top:6px;font-size:11px;color:#94a3b8;font-family:'Courier New',monospace;font-weight:700;">${this.s(ticketNumber)}</div>` : '';
    return `
    <div style="margin-top:28px;border-top:1px solid #e2e8f0;padding-top:16px;text-align:center;">
      <div style="font-size:12px;color:#64748b;font-weight:600;">SupportPulse &mdash; Automated Support Notification</div>
      ${num}
      <div style="font-size:11px;color:#94a3b8;margin-top:6px;">Reply to this email to continue the conversation on your ticket.</div>
      <div style="font-size:11px;color:#cbd5e1;margin-top:10px;">&copy; ${year} SupportPulse Enterprise. All rights reserved.</div>
    </div>`;
  }

  /**
   * Master email composer.
   * Produces the full HTML document from header + card + update section + button + footer.
   */
  composeEmail({
    eventTitle,
    greeting = '',
    introText = '',
    summaryFields = [],
    updateLabel = '',
    updateHtml = '',
    ticketId,
    ticketNumber,
  }) {
    const header = this.getEmailHeader(eventTitle);
    const greetingHtml = greeting
      ? `<p style="font-size:15px;font-weight:600;color:#1e293b;margin:0 0 4px;">${this.s(greeting)}</p>`
      : '';
    const introHtml = introText
      ? `<p style="font-size:14px;color:#475569;margin:0 0 16px;line-height:1.6;">${this.s(introText)}</p>`
      : '';
    const card = summaryFields.length ? this.getTicketSummaryCard(summaryFields) : '';
    const update = (updateLabel && updateHtml) ? this.getUpdateSection(updateLabel, updateHtml) : '';
    const button = this.getViewTicketButton(ticketId);
    const footer = this.getEmailFooter(ticketNumber);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>SupportPulse Notification</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,0.06);overflow:hidden;">
          <tr><td>${header}</td></tr>
          <tr>
            <td style="padding:28px 32px 24px;">
              ${greetingHtml}
              ${introHtml}
              ${card}
              ${update}
              ${button}
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  // ─── OTP / Auth Emails (unchanged — separate concern) ─────────────────────

  /**
   * OTP / Authentication email template (dark theme, code box).
   * Signature preserved exactly for auth flow compatibility.
   */
  getEmailTemplate({ title, greeting, message, code, subtext }) {
    const s = (v) => this.s(v);
    const safeSubtext = s(subtext || 'This code is valid for 10 minutes. If you did not make this request, you can safely ignore this email.');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; margin: 0; padding: 24px; color: #f8fafc; }
    .container { max-width: 560px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { text-align: center; margin-bottom: 24px; }
    .logo { font-size: 24px; font-weight: 800; color: #38bdf8; letter-spacing: -0.5px; }
    .badge { display: inline-block; background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 9999px; margin-top: 8px; }
    h2 { color: #ffffff; font-size: 20px; margin-top: 0; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 12px 0; }
    .code-box { background: #0f172a; border: 1px dashed #38bdf8; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0; }
    .code { font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #38bdf8; font-family: 'Courier New', monospace; }
    .footer { border-top: 1px solid #334155; margin-top: 24px; padding-top: 16px; text-align: center; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">SupportPulse</div>
      <div class="badge">${s(title)}</div>
    </div>
    <h2>${s(greeting)}</h2>
    <p>${s(message)}</p>
    <div class="code-box">
      <div class="code">${s(code)}</div>
    </div>
    <p style="font-size: 13px; color: #cbd5e1;">${safeSubtext}</p>
    <div class="footer">&copy; ${new Date().getFullYear()} SupportPulse Enterprise. All rights reserved.</div>
  </div>
</body>
</html>`;
  }

  /**
   * Send Email OTP — unchanged signature, unchanged behaviour.
   * Logs full safe SMTP result (never logs OTP or credentials).
   */
  async sendEmailOtp({ email, otp, purpose }) {
    let title = 'Verification Code';
    let greeting = 'Verify Your Email';
    let message = 'Thank you for registering. Please enter the verification code below to confirm your email address:';

    if (purpose === 'EMAIL_LOGIN') {
      title = 'Sign In Security Code';
      greeting = 'Your Sign In Code';
      message = 'You requested a secure login to your SupportPulse account. Use this one-time code to sign in:';
    } else if (purpose === 'PASSWORD_RESET') {
      title = 'Password Reset Code';
      greeting = 'Reset Your Password';
      message = 'We received a request to reset your password. Enter the code below to proceed:';
    }

    const html = this.getEmailTemplate({ title, greeting, message, code: otp });

    if (!this.transporter) {
      const msg = 'SMTP configuration missing. Cannot send OTP email.';
      logger.error(msg);
      throw new Error(msg);
    }

    const mailOptions = {
      from: config.email.from,
      to: email,
      subject: `[SupportPulse] ${title}`,
      html,
    };

    // Log what we are about to send (no OTP value in body)
    logger.info('[SMTP] Sending OTP email', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
    });

    try {
      const result = await this.transporter.sendMail(mailOptions);

      // Log the COMPLETE safe SMTP result — never log OTP or credentials
      logger.info('[SMTP] sendMail result', {
        messageId: result.messageId,
        accepted:  result.accepted,
        rejected:  result.rejected,
        response:  result.response,
        envelope:  result.envelope,
      });

      const wasAccepted = Array.isArray(result.accepted) && result.accepted.length > 0;
      const wasRejected = Array.isArray(result.rejected) && result.rejected.length > 0;

      if (wasRejected && !wasAccepted) {
        logger.error(`[SMTP] Recipient REJECTED by SMTP server: ${JSON.stringify(result.rejected)}`);
        throw new Error('Recipient rejected by mail server.');
      }

      if (wasAccepted) {
        logger.info(`[SMTP] Authentication email successfully delivered to SMTP for: ${result.accepted.join(', ')}`);
      } else {
        logger.warn(`[SMTP] sendMail resolved but accepted list is empty. Result: ${JSON.stringify({ accepted: result.accepted, rejected: result.rejected, response: result.response })}`);
      }

      return true;
    } catch (err) {
      logger.error(`[SMTP] sendMail FAILED for ${email}`, {
        errorMessage: err.message,
        errorCode: err.code,
        errorCommand: err.command,
        responseCode: err.responseCode,
        response: err.response,
      });
      throw new Error('Failed to send verification email. Please try again later.');
    }
  }

  // ─── Shared Ticket Data Helpers ────────────────────────────────────────────

  /**
   * Build the standard summary fields for a ticket.
   * Pass override fields to add/replace entries.
   */
  _getTicketFields(ticket, customer, overrides = {}) {
    const ts = (d) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';

    const base = {
      'Ticket ID':     ticket.ticketNumber || 'N/A',
      'Subject':       ticket.title || ticket.subject || 'N/A',
      'Status':        { raw: true, value: this.getStatusBadge(ticket.status || 'OPEN') },
      'Priority':      { raw: true, value: this.getPriorityBadge(ticket.priority || 'MEDIUM') },
      'Category':      ticket.category?.name || 'General',
      'Customer':      customer?.fullName || 'N/A',
      'Customer Email':customer?.email || 'N/A',
      'Assigned Agent':ticket.assignedTo?.fullName || 'Unassigned',
      'Created':       ts(ticket.createdAt),
      'Last Updated':  ts(ticket.updatedAt),
    };

    // Apply overrides (add/replace/delete)
    const merged = { ...base, ...overrides };

    return Object.entries(merged)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([label, value]) => {
        if (typeof value === 'object' && value.raw) return { label, raw: true, value: value.value };
        return { label, value };
      });
  }

  /** Safely escape a reply body for HTML display, preserving newlines as <br>. */
  _escapeReplyBody(body) {
    return this.s(body || '').replace(/\n/g, '<br>');
  }

  // ─── TICKET CREATION ───────────────────────────────────────────────────────

  async sendTicketCreatedToCustomer({ ticket, customer }) {
    if (!this.transporter || !customer?.email) return false;
    const ticketNumber = ticket.ticketNumber || 'N/A';
    const ticketTitle = ticket.title || ticket.subject || 'N/A';

    const fields = this._getTicketFields(ticket, customer, {
      'Description': ticket.description ? ticket.description.substring(0, 300) + (ticket.description.length > 300 ? '…' : '') : null,
    });

    const html = this.composeEmail({
      eventTitle: 'New Support Ticket Created',
      greeting: `Hello ${this.s(customer.fullName || 'there')},`,
      introText: 'Your support ticket has been successfully created. Our team will review your request and respond as soon as possible.',
      summaryFields: fields,
      updateLabel: 'Latest Update',
      updateHtml: 'Your support ticket has been successfully created and is now in our queue. We will get back to you shortly.',
      ticketId: ticket._id,
      ticketNumber,
    });

    try {
      await this.transporter.sendMail({
        from: config.email.from,
        to: customer.email,
        subject: this.buildSubject(ticketNumber, 'New Ticket', ticketTitle),
        html,
      });
      logger.info(`Ticket confirmation email sent to customer: ${customer.email} (${ticketNumber})`);
      return true;
    } catch (err) {
      logger.error(`Failed to send ticket confirmation to customer ${customer.email}: ${err.message}`);
      return false;
    }
  }

  async sendTicketCreatedToAdmin({ ticket, customer }) {
    if (!this.transporter) return false;
    const adminEmail = config.email.adminSupportEmail;
    if (!adminEmail) {
      logger.error('ADMIN_SUPPORT_EMAIL not configured. Skipping admin notification.');
      return false;
    }

    const ticketNumber = ticket.ticketNumber || 'N/A';
    const ticketTitle = ticket.title || ticket.subject || 'N/A';

    const fields = this._getTicketFields(ticket, customer, {
      'Description': ticket.description ? ticket.description.substring(0, 300) + (ticket.description.length > 300 ? '…' : '') : null,
    });

    const html = this.composeEmail({
      eventTitle: 'New Support Ticket',
      greeting: 'Support Team,',
      introText: 'A new support ticket has been submitted and requires attention.',
      summaryFields: fields,
      updateLabel: 'Action Required',
      updateHtml: `A new ticket from <strong>${this.s(customer?.fullName || 'Unknown')}</strong> (${this.s(customer?.email || 'N/A')}) has arrived. Please assign it to an agent and begin review.`,
      ticketId: ticket._id,
      ticketNumber,
    });

    try {
      await this.transporter.sendMail({
        from: config.email.from,
        to: adminEmail,
        subject: this.buildSubject(ticketNumber, 'New Ticket', ticketTitle),
        html,
      });
      logger.info(`New ticket notification sent to admin/support: ${adminEmail} (${ticketNumber})`);
      return true;
    } catch (err) {
      logger.error(`Failed to send admin ticket notification for ${ticketNumber}: ${err.message}`);
      return false;
    }
  }

  async sendTicketCreatedNotifications({ ticket, customer }) {
    const ticketNumber = ticket.ticketNumber || 'unknown';
    const [r1, r2] = await Promise.allSettled([
      this.sendTicketCreatedToCustomer({ ticket, customer }),
      this.sendTicketCreatedToAdmin({ ticket, customer }),
    ]);
    const customerSent = r1.status === 'fulfilled' ? r1.value : false;
    const adminSent = r2.status === 'fulfilled' ? r2.value : false;
    logger.info(`Ticket email results for ${ticketNumber} — customer: ${customerSent}, admin: ${adminSent}`);
    return { customerEmailSent: customerSent, adminEmailSent: adminSent };
  }

  // ─── ASSIGNMENT / REASSIGNMENT ─────────────────────────────────────────────

  async sendAssignmentToCustomer({ ticket, customer, assignee, isReassignment }) {
    if (!this.transporter || !customer?.email) return false;
    const ticketNumber = ticket.ticketNumber || 'N/A';
    const ticketTitle = ticket.title || ticket.subject || 'N/A';
    const eventWord = isReassignment ? 'Ticket Reassigned' : 'Ticket Assigned';
    const assigneeName = assignee?.fullName || 'Support Team';

    const fields = this._getTicketFields(ticket, customer);

    const html = this.composeEmail({
      eventTitle: eventWord,
      greeting: `Hello ${this.s(customer.fullName || 'there')},`,
      introText: `Your ticket has been ${isReassignment ? 'reassigned' : 'assigned'} to a support agent.`,
      summaryFields: fields,
      updateLabel: 'Assignment Update',
      updateHtml: `Your ticket has been ${isReassignment ? 'reassigned' : 'assigned'} to <strong>${this.s(assigneeName)}</strong>. They will review your request and respond promptly.`,
      ticketId: ticket._id,
      ticketNumber,
    });

    try {
      await this.transporter.sendMail({
        from: config.email.from,
        to: customer.email,
        subject: this.buildSubject(ticketNumber, eventWord, ticketTitle),
        html,
      });
      logger.info(`Assignment email sent to customer: ${customer.email} (${ticketNumber})`);
      return true;
    } catch (err) {
      logger.error(`Failed to send assignment email to customer ${customer.email}: ${err.message}`);
      return false;
    }
  }

  async sendAssignmentToAgent({ ticket, customer, assignee, isReassignment }) {
    if (!this.transporter || !assignee?.email) return false;
    const ticketNumber = ticket.ticketNumber || 'N/A';
    const ticketTitle = ticket.title || ticket.subject || 'N/A';
    const eventWord = isReassignment ? 'Ticket Reassigned to You' : 'Ticket Assigned to You';

    const fields = this._getTicketFields(ticket, customer);

    const html = this.composeEmail({
      eventTitle: eventWord,
      greeting: `Hello ${this.s(assignee.fullName || 'Agent')},`,
      introText: `A ticket has been ${isReassignment ? 'reassigned' : 'assigned'} to you. Please review the details below and respond to the customer.`,
      summaryFields: fields,
      updateLabel: 'Assignment Update',
      updateHtml: `This ticket has been ${isReassignment ? 'reassigned' : 'assigned'} to you by the support team. Please take action promptly.`,
      ticketId: ticket._id,
      ticketNumber,
    });

    try {
      await this.transporter.sendMail({
        from: config.email.from,
        to: assignee.email,
        subject: this.buildSubject(ticketNumber, eventWord, ticketTitle),
        html,
      });
      logger.info(`Assignment email sent to agent: ${assignee.email} (${ticketNumber})`);
      return true;
    } catch (err) {
      logger.error(`Failed to send assignment email to agent ${assignee.email}: ${err.message}`);
      return false;
    }
  }

  async sendAssignmentNotifications({ ticket, customer, assignee, isReassignment }) {
    const adminEmail = config.email.adminSupportEmail;
    const ticketNumber = ticket.ticketNumber || 'N/A';
    const ticketTitle = ticket.title || ticket.subject || 'N/A';
    const eventWord = isReassignment ? 'Ticket Reassigned' : 'Ticket Assigned';

    if (!assignee) {
      logger.info(`Ticket ${ticketNumber} unassigned — no assignment emails sent.`);
      return;
    }

    const sends = [
      this.sendAssignmentToCustomer({ ticket, customer, assignee, isReassignment }),
      this.sendAssignmentToAgent({ ticket, customer, assignee, isReassignment }),
    ];

    // Admin mailbox — skip if admin IS the assignee to avoid duplicate
    if (adminEmail && adminEmail !== assignee.email) {
      const fields = this._getTicketFields(ticket, customer);
      const adminHtml = this.composeEmail({
        eventTitle: `[Admin] ${eventWord}`,
        greeting: 'Support Team,',
        introText: `Ticket ${this.s(ticketNumber)} has been ${isReassignment ? 'reassigned' : 'assigned'}.`,
        summaryFields: fields,
        updateLabel: 'Assignment Update',
        updateHtml: `Ticket has been ${isReassignment ? 'reassigned' : 'assigned'} to <strong>${this.s(assignee.fullName)}</strong> (${this.s(assignee.email)}).`,
        ticketId: ticket._id,
        ticketNumber,
      });
      sends.push(
        (async () => {
          try {
            await this.transporter.sendMail({
              from: config.email.from,
              to: adminEmail,
              subject: this.buildSubject(ticketNumber, `[Admin] ${eventWord}`, ticketTitle),
              html: adminHtml,
            });
            logger.info(`Assignment admin notification sent to ${adminEmail} (${ticketNumber})`);
            return true;
          } catch (err) {
            logger.error(`Failed to send assignment admin notification for ${ticketNumber}: ${err.message}`);
            return false;
          }
        })()
      );
    }

    const results = await Promise.allSettled(sends);
    const [r1, r2, r3] = results;
    logger.info(
      `Assignment email results for ${ticketNumber} — customer: ${r1.value ?? false}, agent: ${r2.value ?? false}, admin: ${r3?.value ?? 'skipped'}`
    );
  }

  // ─── REPLY NOTIFICATIONS ───────────────────────────────────────────────────

  /**
   * Agent/Admin → Customer: PUBLIC reply only. NEVER internal notes.
   */
  async sendAgentReplyToCustomer({ ticket, customer, replyBody, senderName }) {
    if (!this.transporter || !customer?.email) return false;
    const ticketNumber = ticket.ticketNumber || 'N/A';
    const ticketTitle = ticket.title || ticket.subject || 'N/A';

    const fields = this._getTicketFields(ticket, customer, {
      'Customer': null, 'Customer Email': null, // Remove customer fields from reply
    });

    const html = this.composeEmail({
      eventTitle: 'New Reply on Your Ticket',
      greeting: `Hello ${this.s(customer.fullName || 'there')},`,
      introText: `${this.s(senderName || 'A support agent')} has replied to your ticket.`,
      summaryFields: fields,
      updateLabel: 'Latest Reply',
      updateHtml: this._escapeReplyBody(replyBody),
      ticketId: ticket._id,
      ticketNumber,
    });

    try {
      await this.transporter.sendMail({
        from: config.email.from,
        to: customer.email,
        subject: this.buildSubject(ticketNumber, 'New Reply', ticketTitle),
        html,
      });
      logger.info(`Agent reply email sent to customer: ${customer.email} (${ticketNumber})`);
      return true;
    } catch (err) {
      logger.error(`Failed to send agent reply email to ${customer.email}: ${err.message}`);
      return false;
    }
  }

  /**
   * Orchestrator: Agent/Admin public reply → Customer + Admin mailbox.
   * INTERNAL NOTES must NEVER be passed here.
   */
  async sendAgentReplyNotifications({ ticket, customer, replyBody, senderName }) {
    const adminEmail = config.email.adminSupportEmail;
    const ticketNumber = ticket.ticketNumber || 'N/A';
    const ticketTitle = ticket.title || ticket.subject || 'N/A';

    const sends = [];

    if (customer?.email) {
      sends.push(this.sendAgentReplyToCustomer({ ticket, customer, replyBody, senderName }));
    }

    if (adminEmail && adminEmail !== customer?.email) {
      const fields = this._getTicketFields(ticket, customer);
      const adminHtml = this.composeEmail({
        eventTitle: '[Admin] Support Reply Sent',
        greeting: 'Support Team,',
        introText: `${this.s(senderName || 'A support agent')} sent a public reply to the customer.`,
        summaryFields: fields,
        updateLabel: 'Reply Sent to Customer',
        updateHtml: this._escapeReplyBody(replyBody),
        ticketId: ticket._id,
        ticketNumber,
      });
      sends.push(
        (async () => {
          try {
            await this.transporter.sendMail({
              from: config.email.from,
              to: adminEmail,
              subject: this.buildSubject(ticketNumber, '[Admin] Support Reply', ticketTitle),
              html: adminHtml,
            });
            logger.info(`Agent reply admin copy sent to ${adminEmail} (${ticketNumber})`);
            return true;
          } catch (err) {
            logger.error(`Failed to send agent reply admin copy for ${ticketNumber}: ${err.message}`);
            return false;
          }
        })()
      );
    }

    const results = await Promise.allSettled(sends);
    const [r1, r2] = results;
    logger.info(
      `Agent reply email results for ${ticketNumber} — customer: ${r1?.value ?? false}, admin: ${r2?.value ?? 'skipped'}`
    );
  }

  /**
   * Customer → Agent/Admin: notify assigned agent + admin support mailbox.
   * Never sends back to the customer.
   */
  async sendCustomerReplyNotifications({ ticket, customer, replyBody, assignedAgent }) {
    if (!this.transporter) return;
    const ticketNumber = ticket.ticketNumber || 'N/A';
    const ticketTitle = ticket.title || ticket.subject || 'N/A';
    const adminEmail = config.email.adminSupportEmail;

    const recipients = [];
    if (assignedAgent?.email) {
      recipients.push({ email: assignedAgent.email, name: assignedAgent.fullName || 'Agent' });
    }
    if (adminEmail && !recipients.find((r) => r.email === adminEmail)) {
      recipients.push({ email: adminEmail, name: 'Support Team' });
    }

    if (recipients.length === 0) {
      logger.info(`Customer reply — no recipients configured (${ticketNumber})`);
      return;
    }

    const fields = this._getTicketFields(ticket, customer);

    const sends = recipients.map(async ({ email, name }) => {
      const html = this.composeEmail({
        eventTitle: 'Customer Reply Received',
        greeting: `Hello ${this.s(name)},`,
        introText: `Customer ${this.s(customer?.fullName || customer?.email || 'Unknown')} has replied to this ticket.`,
        summaryFields: fields,
        updateLabel: 'Customer Reply',
        updateHtml: this._escapeReplyBody(replyBody),
        ticketId: ticket._id,
        ticketNumber,
      });
      try {
        await this.transporter.sendMail({
          from: config.email.from,
          to: email,
          subject: this.buildSubject(ticketNumber, 'Customer Reply', ticketTitle),
          html,
        });
        logger.info(`Customer reply notification sent to ${email} (${ticketNumber})`);
        return true;
      } catch (err) {
        logger.error(`Failed to send customer reply notification to ${email}: ${err.message}`);
        return false;
      }
    });

    await Promise.allSettled(sends);
  }

  // ─── STATUS LIFECYCLE NOTIFICATIONS ───────────────────────────────────────

  async sendStatusChangeNotifications({ ticket, customer, newStatus, actor }) {
    if (!this.transporter) return;
    const ticketNumber = ticket.ticketNumber || 'N/A';
    const ticketTitle = ticket.title || ticket.subject || 'N/A';
    const adminEmail = config.email.adminSupportEmail;
    const s = (v) => this.s(v);
    const actorName = actor?.fullName || actor?.email || 'Support Team';

    const statusConfig = {
      RESOLVED: {
        eventTitle: 'Ticket Resolved',
        customerIntro: 'Great news! Your support ticket has been marked as resolved.',
        customerUpdate: 'Your ticket has been resolved. If the issue is not fully addressed, you can reopen this ticket from the portal.',
        adminUpdate: `Ticket marked as RESOLVED by ${s(actorName)}.`,
      },
      REOPENED: {
        eventTitle: 'Ticket Reopened',
        customerIntro: 'Your ticket has been reopened.',
        customerUpdate: 'Your ticket is now REOPENED. Our support team will review your additional concerns and respond as soon as possible.',
        adminUpdate: `Ticket REOPENED by ${s(actorName)}.`,
      },
      CLOSED: {
        eventTitle: 'Ticket Closed',
        customerIntro: 'Your support ticket has been closed.',
        customerUpdate: 'Your ticket is now CLOSED and archived. If you have a new issue, please open a new ticket from the support portal.',
        adminUpdate: `Ticket CLOSED by ${s(actorName)}.`,
      },
    };

    const cfg = statusConfig[newStatus];
    if (!cfg) {
      logger.info(`Status notification skipped for: ${newStatus}`);
      return;
    }

    const fields = this._getTicketFields(ticket, customer);
    const sends = [];

    // Customer notification
    if (customer?.email) {
      const html = this.composeEmail({
        eventTitle: cfg.eventTitle,
        greeting: `Hello ${s(customer.fullName || 'there')},`,
        introText: cfg.customerIntro,
        summaryFields: fields,
        updateLabel: 'Status Update',
        updateHtml: cfg.customerUpdate,
        ticketId: ticket._id,
        ticketNumber,
      });
      sends.push(
        (async () => {
          try {
            await this.transporter.sendMail({
              from: config.email.from,
              to: customer.email,
              subject: this.buildSubject(ticketNumber, cfg.eventTitle, ticketTitle),
              html,
            });
            logger.info(`${cfg.eventTitle} email sent to customer: ${customer.email} (${ticketNumber})`);
            return true;
          } catch (err) {
            logger.error(`Failed to send ${cfg.eventTitle} email to customer ${customer.email}: ${err.message}`);
            return false;
          }
        })()
      );
    }

    // Admin notification
    if (adminEmail) {
      const adminHtml = this.composeEmail({
        eventTitle: `[Admin] ${cfg.eventTitle}`,
        greeting: 'Support Team,',
        introText: cfg.adminUpdate,
        summaryFields: fields,
        updateLabel: 'Status Update',
        updateHtml: cfg.adminUpdate,
        ticketId: ticket._id,
        ticketNumber,
      });
      sends.push(
        (async () => {
          try {
            await this.transporter.sendMail({
              from: config.email.from,
              to: adminEmail,
              subject: this.buildSubject(ticketNumber, `[Admin] ${cfg.eventTitle}`, ticketTitle),
              html: adminHtml,
            });
            logger.info(`${cfg.eventTitle} admin email sent to ${adminEmail} (${ticketNumber})`);
            return true;
          } catch (err) {
            logger.error(`Failed to send ${cfg.eventTitle} admin email for ${ticketNumber}: ${err.message}`);
            return false;
          }
        })()
      );
    }

    await Promise.allSettled(sends);
  }

  // ─── Phone OTP ─────────────────────────────────────────────────────────────

  async sendPhoneOtp({ phone, otp, purpose }) {
    let actionText = 'verify your phone number';
    if (purpose === 'PHONE_LOGIN') actionText = 'log in to SupportPulse';
    const smsBody = `Your SupportPulse verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
    logger.info(`[NotificationService] SMS OTP for ${phone} (${purpose} / ${actionText}): "${smsBody}"`);
    return true;
  }
}

const notificationService = new NotificationService();

module.exports = {
  NotificationService,
  notificationService,
};
