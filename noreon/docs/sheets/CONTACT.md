# Website contact form

The /contact page collects name, email, message and an optional callback number.
The existing demo/access endpoint stays disabled. The contact action uses the
server-only SHEETS_WEBHOOK_URL and SHEETS_WEBHOOK_SECRET environment variables.

## Company-owned integration

Owner: ops@noreon.health.
Requests sheet: https://docs.google.com/spreadsheets/d/1c5sxvOxYaR3qZJtrTLO6kX4eK_wxANE05JDpqxsFiBk/edit
Apps Script project: https://script.google.com/home/projects/1TW4GiaAbkZMPzSRZFJ7IEJNab8i1Eboy9diQLcQ7R8nDGCF3XwDS7f0o/edit

The Google web app is deployed and its URL configured in Vercel for Production
and Preview. Keep the shared secret in Script Properties and Vercel only.
The sheet remains private to its owner; the public endpoint exposes only a health
response and accepts authenticated contact submissions.

## Update the Google integration

1. Open the Apps Script project bound to the current requests spreadsheet.
2. Replace the old access-requests.gs implementation with contact-requests.gs.
   Preserve the existing SHARED_SECRET script property.
3. Run authorizeContactNotifications and approve the Google Mail permission.
4. Deploy > Manage deployments > Edit > New version > Deploy. Preserve the /exec URL.
5. GET the endpoint: it must report contactVersion: 1. If the URL changed, update
   SHEETS_WEBHOOK_URL in Vercel.
6. Submit a clearly labelled test enquiry. Confirm the new Contact requests tab
   contains the row with Notification = Sent and info@noreon.health received it.
   Confirm Reply uses the visitor's address. Then publish the website change.

Requests are saved before notification, with an ID to prevent duplicate rows and
repeat emails during ordinary retries. A notification failure remains Pending;
inspect this column regularly. MailApp acknowledgement confirms Google accepted
sending, not final inbox delivery. A send followed by a failed status update can
cause a duplicate notification on retry. Email-key and global throttles limit
submissions, and spreadsheet formula prefixes are escaped. The website only
shows success after the contact-specific response confirms notification sending.
Old webhook implementations cannot produce a false success.

The contact button and page do not create accounts or restore the retired demo.

Checks: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/register-alias.mjs scripts/check-contact.mjs`.
