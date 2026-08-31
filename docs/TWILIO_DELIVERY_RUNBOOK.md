# Twilio WhatsApp Delivery Runbook

This runbook separates live Sandbox proof from production configuration. Never place credentials, phone numbers, or health information in screenshots or application logs.

## Before every send

Workflow B must confirm that the recipient is active and opted in, and that the scheduled row is approved, due, and unsent. Preparation reserves the row as `sending` with a unique delivery-attempt ID before Twilio is called. A row already sending, queued, sent, delivered, or read is not submitted again. An uncertain request remains reserved for reconciliation and is not automatically retried.

## Sandbox proof

Set `TWILIO_SANDBOX_MODE=true`, configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_WHATSAPP_FROM`, and make sure the test phone has joined the Sandbox and opened the customer-service window. Sandbox sends use `From`, `To`, and free-form `Body`.

Capture one correlated chain for a text-only nudge and one tracked-media-link nudge:

- nudge ID and delivery-attempt ID;
- Twilio Message SID and accepted status;
- delivered/read callbacks where available;
- tracked-link visit;
- ordinary reply;
- matching schedule, interaction, and Monitor audit records.

Do not capture auth tokens or an unmasked phone number.

## Production configuration gate

Set `TWILIO_SANDBOX_MODE=false` and configure:

- `TWILIO_MESSAGING_SERVICE_SID` beginning with `MG`;
- `TWILIO_SEND_ONLY_CONTENT_SID` beginning with `HX`;
- approved public HTTPS inbound and status-callback URLs.

Production Workflow B uses `MessagingServiceSid`, `ContentSid`, and validated `ContentVariables`. It does not fall back to a free-form `Body`. Do not call the sender live production until the WhatsApp Business Account, sender, Messaging Service, content template, webhooks, and one controlled end-to-end production delivery are independently confirmed.

## Webhook safety

Inbound and status callbacks use Twilio's supported request validator. A missing or invalid signature returns `403` before patient data is read or changed. Duplicate callbacks are idempotent. STOP immediately opts the patient out and cancels future unsent messages.
