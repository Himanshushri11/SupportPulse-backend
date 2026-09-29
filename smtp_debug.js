/**
 * smtp_debug.js — One-shot SMTP delivery diagnostic.
 * Run: node smtp_debug.js
 *
 * Logs full safe sendMail result. NEVER logs passwords or secrets.
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

const SMTP_HOST    = process.env.SMTP_HOST;
const SMTP_PORT    = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE  = process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465';
const SMTP_USER    = process.env.SMTP_USER;
const SMTP_PASS    = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
const FROM_ADDR    = process.env.SMTP_FROM || process.env.EMAIL_FROM;
const TEST_TO      = process.argv[2] || SMTP_USER; // default: send to yourself

// ─── Safe config dump ────────────────────────────────────────────────────────
console.log('\n[SMTP DEBUG] Configuration (no secrets):');
console.log({
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS_SET: !!SMTP_PASS,
  FROM_ADDR,
  TEST_TO,
});

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error('\n[SMTP DEBUG] MISSING required env vars: SMTP_HOST, SMTP_USER, SMTP_PASSWORD');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

async function run() {
  // 1. Verify SMTP connection
  console.log('\n[SMTP DEBUG] Verifying SMTP connection...');
  try {
    await transporter.verify();
    console.log('[SMTP DEBUG] ✅ SMTP verify: OK — connection and auth succeeded');
  } catch (err) {
    console.error('[SMTP DEBUG] ❌ SMTP verify FAILED:', {
      message: err.message,
      code: err.code,
      responseCode: err.responseCode,
      response: err.response,
    });
    process.exit(1);
  }

  // 2. Send test email
  const mailOptions = {
    from: FROM_ADDR,
    to: TEST_TO,
    subject: '[SupportPulse] SMTP Debug Test',
    text: 'This is a test email from the SupportPulse SMTP debug script. If you receive this, SMTP delivery is working correctly.',
    html: '<p>This is a <strong>test email</strong> from the SupportPulse SMTP debug script.</p><p>If you receive this, SMTP delivery is working correctly.</p>',
  };

  console.log('\n[SMTP DEBUG] Sending test email...');
  console.log('[SMTP DEBUG] Mail options (safe):', {
    from: mailOptions.from,
    to: mailOptions.to,
    subject: mailOptions.subject,
  });

  try {
    const result = await transporter.sendMail(mailOptions);

    console.log('\n[SMTP DEBUG] ✅ sendMail() RESOLVED. Full safe result:');
    console.log(JSON.stringify({
      messageId: result.messageId,
      accepted:  result.accepted,
      rejected:  result.rejected,
      response:  result.response,
      envelope:  result.envelope,
    }, null, 2));

    const accepted = result.accepted || [];
    const rejected = result.rejected || [];

    if (accepted.includes(TEST_TO) || accepted.includes(TEST_TO.toLowerCase())) {
      console.log(`\n[SMTP DEBUG] ✅ SMTP server ACCEPTED recipient: ${TEST_TO}`);
      console.log('[SMTP DEBUG] The email has been handed to Gmail SMTP successfully.');
      console.log('[SMTP DEBUG] If it does not appear in inbox, check:');
      console.log('  1. Spam / Junk folder');
      console.log('  2. Gmail "All Mail" label');
      console.log('  3. Gmail Promotions or Updates tab');
      console.log('  4. Gmail filters / blocked addresses');
    } else if (rejected.length > 0) {
      console.error(`\n[SMTP DEBUG] ❌ SMTP server REJECTED recipient: ${JSON.stringify(rejected)}`);
    } else {
      console.warn('\n[SMTP DEBUG] ⚠️ sendMail resolved but accepted list is empty — check response above.');
    }

  } catch (err) {
    console.error('\n[SMTP DEBUG] ❌ sendMail() THREW ERROR:');
    console.error(JSON.stringify({
      message:      err.message,
      code:         err.code,
      command:      err.command,
      responseCode: err.responseCode,
      response:     err.response,
    }, null, 2));
    process.exit(1);
  }
}

run();
