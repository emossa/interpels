# Which free email provider fits a daily summary to a list of recipients?

Research for [#4](https://github.com/emossa/interpels/issues/4), part of map [#1](https://github.com/emossa/interpels/issues/1).
Checked against official pricing pages and docs on 2026-09-24. Free tiers change often, so re-check the linked pages before you rely on a number.

## Use case

- One HTML digest a day (in Italian) per recipient, sent from a Vercel Hobby serverless function (cron).
- Now: a small configured list, so fewer than about 20 emails a day. Later, possibly public subscribers (hundreds).
- Because recipients get one email each, **emails/day ≈ number of recipients**.

## Recommendation

**Primary: Resend, sending from a custom domain you own (a cheap domain or a subdomain).**
- The free plan gives 100 emails/day and 3,000/month. That is room for about 100 recipients a day, far more than the MVP needs.
- It has a first-party Node SDK built for serverless (`npm i resend`, one `emails.send()` call), a batch endpoint (100 emails per call), idempotency keys and custom headers for `List-Unsubscribe`.
- Free accounts can send to real recipients straight away, with no sandbox or approval step.
- It can send from the EU (`eu-west-1`), but account data stays in the US.
- **Bootstrap with no domain:** sending from `onboarding@resend.dev` works, but **only to the Resend account owner's own address**. That is enough to build and test locally before a domain exists, not for a real list.

**Fallback: Brevo** (a French company whose data is hosted in the EU).
- The free plan allows 300 emails/day with no time limit and stores up to 100k contacts.
- It has a REST API, SMTP and a Node SDK.
- It has built-in contact lists and unsubscribe handling, which suit the future public-subscriber phase.
- It still needs your own domain for good deliverability: with an unauthenticated or `@gmail.com` sender, Brevo rewrites the From address to `@brevosend.com`.
- It is the pick if strict EU data residency or more than 100 recipients a day becomes a requirement.

**Zero-domain stopgap: Gmail SMTP** (Nodemailer with an App Password).
- It sends from your own `@gmail.com` address to anyone, up to about 500 emails a day.
- The catches: it needs 2-Step Verification, Google itself says App Passwords are "not recommended", it has no List-Unsubscribe or bounce tooling, and its terms are aimed at personal use.
- It is only acceptable for a handful of known recipients, and only until a domain exists.

**Design implication:** keep an `EmailSender` port with one adapter per provider, so switching from Resend to Brevo or Gmail only means config plus a small adapter. Send one email per recipient, never a To/BCC blast, because each recipient gets a filtered digest and Resend counts each To/CC/BCC address as a separate email anyway.

## Comparison (free tiers, Sept 2026)

| Provider | Free cap | Permanent? | Own domain needed to reach others? | Node / serverless | List-Unsubscribe | Data location |
|---|---|---|---|---|---|---|
| **Resend** | 100/day, 3,000/month ([1][2]) | Yes | Yes. `resend.dev` sends only to the account owner ([3]) | Official SDK, REST, batch of 100, 10 req/s ([2][4]) | Custom `headers`, documented RFC 8058 guide; Broadcasts handle it automatically ([5]) | Sends from US/EU/BR/JP; **account data stored in the US** ([6]) |
| **Brevo** | 300/day ([7]) | Yes | Effectively yes. Free-mail senders cannot be authenticated and get rewritten to `@brevosend.com` ([8]) | REST, SMTP, Node SDK | Built-in unsubscribe for campaigns; API allows custom headers | **EU** (OVH France/Germany, GCP Belgium) ([9]) |
| **Mailjet** | 200/day, 6,000/month; Mailjet logo on emails ([10]) | Yes | Strongly advised. Free-mail senders fail DMARC under `p=reject` ([11]) | REST (v3.1 send), SMTP, Node SDK | Custom headers; built-in for campaigns | **EU** (GCP Frankfurt + Belgium) ([12]) |
| **Postmark** | 100/month total, no overages ([13]) | Yes | Yes. Until manual approval you can send only to your own verified domains ([14]) | Excellent API and Node library | Broadcast streams manage unsubscribes | **US** (Chicago data center + AWS), EU transfers via SCCs ([15]) |
| **MailerSend** | 500/month and 100 API requests/day per the pricing page; the help page says 100/month ([16][17]) | Yes | Trial domain available, but sandbox allows only 2 recipients until approval ([17]) | REST, SMTP, Node SDK | **Custom headers not available on free** ([17]) | **EU** (Google Cloud, Belgium) ([18]) |
| **SendGrid** | 100/day for **60 days only** ([19]) | **No**, trial ends; paid plans from $19.95/month | Yes (sender authentication) | Mature Node SDK | Yes (ASM groups, custom headers) | US |
| **Amazon SES** | No volume free tier; up to $200 of general AWS credits for new accounts (6-month free plan). Then $0.10 per 1,000 emails à la carte ([20]) | No | Sandbox: only verified recipients, 200/day, 1/s until production access is approved; the From address must always be verified ([21]) | AWS SDK v3; needs IAM keys | Custom headers; list management features | Choose an EU region (for example eu-south-1 Milan, eu-west-1) |
| **Gmail SMTP** | About 500 emails/day, 500 recipients per message (personal account) ([22]) | Yes | **No.** Sends as your own `@gmail.com` | Nodemailer over SMTP; App Password needs 2-Step Verification ([23]) | Manual header only; no unsubscribe or bounce handling | Google (global) |

## Notes by criterion

### Caps
- For the MVP (fewer than 20 recipients), every permanent free tier is enough except Postmark (100 a month ≈ 3 a day) and MailerSend (100–500 a month).
- Resend's daily quota is a UTC calendar day, and exceeding it returns HTTP 429 `daily_quota_exceeded`. Inbound emails also count toward it ([2]).
- Brevo's 300/day is the largest permanent daily cap among the API providers ([7]).

### Custom domain
- Every serious API provider needs a domain you control (SPF/DKIM) before it will deliver to arbitrary recipients.
- Gmail and Yahoo require SPF or DKIM from all senders, and DMARC plus alignment from bulk senders ([24]). Google also warns against "impersonating Gmail From: headers" ([24]). That rules out sending *as* `@gmail.com` through a third-party provider.
- The only no-domain paths are Gmail SMTP itself, and Resend's `resend.dev` for sending only to yourself.

### Deliverability
- With an authenticated domain, Resend, Brevo, Mailjet and Postmark all meet the Gmail/Yahoo 2024 sender rules.
- Postmark has the strongest reputation for transactional mail, but its free tier is far too small here.
- Mailjet puts its logo on free-plan emails ([10]). Brevo adds a "Sent with Brevo" mark to free-plan emails. It is documented for campaigns, so check whether API sends carry it too.

### Serverless friendliness
- Resend is HTTP-only, with a tiny SDK and a `{ data, error }` return ([25]). Idempotency keys guard against a Vercel cron retrying and sending twice ([25]).
- Brevo, Mailjet and MailerSend also offer HTTPS APIs.
- Gmail and SES over SMTP work from Vercel functions, but they are slower and more fragile. SES also needs IAM credentials and sandbox approval.

### List-Unsubscribe
- One-click unsubscribe (RFC 8058) is **mandatory only for bulk senders (more than 5,000 a day to Gmail)** ([24]). It is still good practice, and it will be needed once public sign-up exists.
- With Resend, add `List-Unsubscribe: <https://…/unsubscribe?token=…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The endpoint must accept a POST and act on it within 48 hours ([5]).
- This fits the "public sign-up later" extension: store an unsubscribe token per recipient in the data model now.

### EU/GDPR data residency
- Brevo, Mailjet and MailerSend store data in the EU.
- Resend and Postmark store data in the US and rely on DPAs/SCCs. Resend's EU region changes only where emails are sent from ([6]).
- With a handful of known recipients this is a low risk, but it matters if public subscribers arrive. That is the main reason Brevo is the fallback.

## Sources

1. Resend pricing: https://resend.com/pricing
2. Resend usage limits: https://resend.com/docs/api-reference/rate-limit and https://resend.com/docs/knowledge-base/account-quotas-and-limits
3. Resend, 403 error using the resend.dev domain: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain
4. Resend, no production approval needed: https://resend.com/docs/knowledge-base/does-resend-require-production-approval
5. Resend, unsubscribe headers: https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails
6. Resend regions and data residency: https://resend.com/docs/dashboard/domains/regions
7. Brevo pricing (FAQ "up to 300 emails per day"): https://www.brevo.com/pricing/ ; Free plan limits: https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan
8. Brevo, Gmail/Yahoo/Microsoft sender requirements (rewrite to @brevosend.com): https://help.brevo.com/hc/en-us/articles/14925263522578 ; free email senders: https://help.brevo.com/hc/en-us/articles/4410613910418
9. Brevo data storage location: https://help.brevo.com/hc/en-us/articles/360001005510-Data-storage-location
10. Mailjet pricing: https://www.mailjet.com/pricing/
11. Mailjet, avoid free webmail senders: https://documentation.mailjet.com/hc/en-us/articles/19308800104091
12. Mailjet, where personal data is stored: https://documentation.mailjet.com/hc/en-us/articles/360042712274-Where-is-my-personal-data-stored
13. Postmark pricing: https://postmarkapp.com/pricing
14. Postmark account approval: https://postmarkapp.com/support/article/1084-how-does-the-account-approval-process-work
15. Postmark EU data protection / GDPR FAQ: https://postmarkapp.com/eu-privacy ; https://postmarkapp.com/support/article/1218-gdpr-faq
16. MailerSend pricing: https://www.mailersend.com/pricing
17. MailerSend sandbox vs trial: https://www.mailersend.com/help/sandbox-mode-and-the-professional-trial
18. MailerSend GDPR: https://www.mailersend.com/legal/how-mailersend-stays-gdpr-compliant
19. Twilio SendGrid Email API pricing: https://www.twilio.com/en-us/products/email-api/pricing
20. Amazon SES pricing: https://aws.amazon.com/ses/pricing/
21. Amazon SES sandbox / production access: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
22. Gmail sending limits (personal): https://support.google.com/mail/answer/22839
23. Google App Passwords: https://support.google.com/accounts/answer/185833
24. Google email sender guidelines: https://support.google.com/a/answer/81126
25. Resend Node.js guide: https://resend.com/docs/send-with-nodejs
