// Nessun invio vero: il trasporto SMTP di Gmail si controlla solo nella configurazione,
// i messaggi passano dal `jsonTransport` di nodemailer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer, { type SendMailOptions, type SentMessageInfo } from 'nodemailer';
import { credenzialiGmail, GmailMittente, trasportoGmail } from './mittente-gmail.ts';

const credenziali = { utente: 'mittente@example.org', password: 'abcd efgh ijkl mnop' };

test('il trasporto è Gmail SMTP su 465 con TLS e la App Password', () => {
  const trasporto = trasportoGmail(credenziali);
  const opzioni = trasporto.options as { host?: string; port?: number; secure?: boolean; auth?: { user?: string; pass?: string } };
  assert.equal(opzioni.host, 'smtp.gmail.com');
  assert.equal(opzioni.port, 465);
  assert.equal(opzioni.secure, true);
  assert.deepEqual(opzioni.auth, { user: 'mittente@example.org', pass: 'abcd efgh ijkl mnop' });
  trasporto.close();
});

test('un messaggio per Destinatario, solo lui in To:, da "Interpellevole", con HTML e testo', async () => {
  const inviate: SentMessageInfo[] = [];
  const json = nodemailer.createTransport({ jsonTransport: true });
  const trasporto = { sendMail: async (m: SendMailOptions) => { const info = await json.sendMail(m); inviate.push(info); return info; } };
  const mittente = new GmailMittente(credenziali, trasporto);

  await mittente.invia({ a: 'persona@example.org', oggetto: 'Interpelli: 1 nuovo · 24 set 2026', html: '<p>ciao</p>', testo: 'ciao\n' });

  assert.equal(inviate.length, 1);
  const busta = inviate[0]!.envelope as { from: string; to: string[] };
  assert.deepEqual(busta, { from: 'mittente@example.org', to: ['persona@example.org'] });
  const messaggio = JSON.parse(inviate[0]!.message as string);
  assert.deepEqual(messaggio.from, { address: 'mittente@example.org', name: 'Interpellevole' });
  assert.deepEqual(messaggio.to, [{ address: 'persona@example.org', name: '' }]);
  assert.equal(messaggio.cc, undefined);
  assert.equal(messaggio.bcc, undefined);
  assert.equal(messaggio.subject, 'Interpelli: 1 nuovo · 24 set 2026');
  assert.equal(messaggio.html, '<p>ciao</p>');
  assert.equal(messaggio.text, 'ciao\n');
});

test('un rifiuto SMTP fa fallire invia', async () => {
  const mittente = new GmailMittente(credenziali, { sendMail: () => Promise.reject(new Error('550 destinatario inesistente')) });
  await assert.rejects(mittente.invia({ a: 'x@example.org', oggetto: 'o', html: 'h', testo: 't' }), /550/);
});

test('le credenziali vengono solo da GMAIL_UTENTE e GMAIL_APP_PASSWORD', () => {
  assert.deepEqual(credenzialiGmail({ GMAIL_UTENTE: 'a@example.org', GMAIL_APP_PASSWORD: 'segreta' }), { utente: 'a@example.org', password: 'segreta' });
  assert.throws(() => credenzialiGmail({ GMAIL_UTENTE: 'a@example.org' }), /GMAIL_APP_PASSWORD non impostata/);
  assert.throws(() => credenzialiGmail({ GMAIL_APP_PASSWORD: 'segreta' }), /GMAIL_UTENTE non impostata/);
  assert.throws(() => credenzialiGmail({ GMAIL_UTENTE: '', GMAIL_APP_PASSWORD: '' }), /non impostata/);
});
