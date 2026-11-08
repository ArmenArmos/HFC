> Historical demo/access setup. The public demo/access form is disabled.
> For the new contact form and email notifications, use [CONTACT.md](CONTACT.md).

# The homepage request form

The homepage has one form. It opens as a dialog from "Request a demo" and from
"Activate access", collects a first name, a last name, an email address and
optional notes, and appends a row to a Google Sheet.

Two audiences arrive through it and the `Intent` column tells them apart:
`demo` is an organisation asking for a demonstration, `access` is a member who
was given access by one.

Nothing on the public site links to `/demo`. The guided demonstration is for
internal stakeholders and is reached by typing its URL.

## How the pieces fit

```
components/marketing/request-access.tsx   the dialog, and the provider that opens it
lib/marketing/access-request.ts           the shape and its validation, shared by both sides
app/(marketing)/actions.ts                the server action that POSTs to the webhook
docs/sheets/access-requests.gs            the Apps Script the webhook runs
```

The form posts through a **server action** rather than from the browser. The
webhook URL and the shared secret stay on the server, and Apps Script sends no
CORS headers on a JSON POST, so a browser could not read the reply anyway.

## Setting it up

This has to be done once, by somebody with the Google account. The app cannot
create any of it.

1. **Create the spreadsheet.** Add a tab named `Requests`. The script writes the
   header row on the first submission, so leave it empty.

2. **Open the script editor.** Extensions > Apps Script, from inside that
   spreadsheet. It must be bound to the sheet — a standalone script will not
   find it.

3. **Paste `access-requests.gs`** over the default `Code.gs`.

4. **Set the shared secret.** In the script editor: Project Settings > Script
   Properties > Add script property.

   - Property: `SHARED_SECRET`
   - Value: a long random string. `openssl rand -base64 32` gives one.

   It is a script property rather than a constant in the file so the secret is
   not sitting in this repository.

5. **Deploy.** Deploy > New deployment > Web app.

   - Execute as: **Me**
   - Who has access: **Anyone**

   "Anyone" is what lets an unauthenticated visitor submit. The shared secret is
   what stops anyone else who finds the URL, which is why step 4 is not optional.

   Copy the `/exec` URL it gives you.

6. **Put both values in the environment.** Locally that is `.env.local`; in
   production it is the hosting platform's environment settings.

   ```
   SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/AKfy.../exec
   SHEETS_WEBHOOK_SECRET=the same string as SHARED_SECRET
   ```

   Neither is prefixed `NEXT_PUBLIC_`, so neither reaches the browser. Keep it
   that way.

7. **Check it.** Open the `/exec` URL in a browser. A working deployment answers
   `{"ok":true,"service":"noreon access requests"}`. Then submit the form and
   watch the row arrive.

## Changing the script later

Editing the script does nothing until it is redeployed, and a **new
deployment** issues a **new URL**. To keep the URL, use Deploy > Manage
deployments > the pencil icon > Version: New version. Paste the updated
`access-requests.gs` here as well, so the file and the deployment agree.

## If the form stops working

The server action logs and the person sees "something went wrong at our end",
never a rejected submission — a broken environment must not read as a refusal.
What to check, in order:

- **`SHEETS_WEBHOOK_URL` or `SHEETS_WEBHOOK_SECRET` is not set.** The log says
  so in as many words and no request is made.
- **`{"ok":false,"error":"bad secret"}`.** The script property and the
  environment variable have drifted apart.
- **An HTML page instead of JSON.** The deployment's access is not set to
  "Anyone", so Google is serving a sign-in page to the server action.
- **Nothing in the log and nothing in the sheet.** Look at the script's
  Executions tab in the Apps Script editor; a script that throws still answers
  200, and that is where the reason is.
