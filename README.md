# Personal Assistant

A minimal personal assistant MVP built with Next.js, TypeScript, and Tailwind CSS.

## What is included

- Next.js app router
- TypeScript
- Tailwind CSS
- Simple homepage with the title `Personal Assistant`
- Basic chat layout with:
  - a message area
  - a text input
  - a send button

## Project structure

```text
personal-assistant/
  src/
    app/
      globals.css
      layout.tsx
      page.tsx
  public/
  package.json
  tsconfig.json
  next.config.ts
```

## Before you start

Make sure you have Node.js installed.

Recommended version:

- Node.js 20 or newer

To check your version, run:

```powershell
node -v
```

## Install dependencies

Open a terminal inside the `personal-assistant` folder:

```powershell
cd C:\Users\admin\Desktop\lifechat\personal-assistant
```

Then install dependencies:

```powershell
npm install
```

If PowerShell shows a script policy error for `npm`, use this instead:

```powershell
npm.cmd install
```

## Supabase environment setup

Create a file named `.env.local` in the project root:

```powershell
cd C:\Users\admin\Desktop\lifechat\personal-assistant
```

```text
NEXT_PUBLIC_SUPABASE_URL=https://axbxczunechbdysazxua.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_WkOHxULUoiLwy0vtWdb0XA_TBdOdGlO
OPENAI_API_KEY=your_openai_api_key_here

# Optional integration scaffolds
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
GOOGLE_REFRESH_TOKEN=your_google_refresh_token
GOOGLE_CALENDAR_ID=primary

MAIL_PROVIDER=resend
MAIL_FROM_EMAIL=your_email@example.com
MAIL_API_KEY=your_mail_provider_api_key

TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

If you change `.env.local`, restart the development server.

## Multi-user test mode setup

The app now supports multi-user testing with Supabase Auth.

To enable it:

1. Open your Supabase project dashboard.
2. Go to `Authentication` -> `Providers` -> `Email`.
3. Enable email/password sign-in.
4. For easy testing, you can disable email confirmation in your Supabase auth settings.

Then run the SQL migration in:

```text
supabase/migrations/20260406_add_multi_user_auth.sql
```

This migration:

- adds `user_id` to `tasks`
- adds `user_id` to `notes`
- enables row level security
- makes each signed-in user see only their own tasks and notes

After that, each friend can:

- open the app
- create an account with email and password
- sign in
- use a separate private workspace on the same deployed app

Important note:

- older rows without a `user_id` will not be visible after row level security is enabled
- that is okay for test mode, but if you want to preserve old shared rows, we should migrate them more carefully

## Integration scaffolds

The app now includes starter API routes for:

- Google Calendar: `src/app/api/integrations/calendar/route.ts`
- Email: `src/app/api/integrations/mail/route.ts`
- WhatsApp: `src/app/api/integrations/whatsapp/route.ts`

There is also a status route at `src/app/api/integrations/status/route.ts` and a shared helper in `src/lib/integrations.ts`.

These routes are scaffolded and safe to extend, but they do not send real calendar events, emails, or WhatsApp messages until you add valid provider credentials and connect the provider-specific API logic.

## Start the development server

Run:

```powershell
npm run dev
```

If PowerShell blocks `npm`, run:

```powershell
npm.cmd run dev
```

Then open this address in your browser:

```text
http://localhost:3000
```

## Build for production

To create a production build, run:

```powershell
npm run build
```

If needed in PowerShell:

```powershell
npm.cmd run build
```

## Start the production server

After building, run:

```powershell
npm run start
```

If needed in PowerShell:

```powershell
npm.cmd run start
```

## Useful scripts

- `npm run dev` - start the local development server
- `npm run build` - create a production build
- `npm run start` - run the production build
- `npm run lint` - check the code with ESLint

## How to edit the homepage

The main homepage lives here:

`src/app/page.tsx`

Global styles live here:

`src/app/globals.css`

## Tech versions used

- Next.js `16.2.2`
- React `19.2.4`
- TypeScript `5`
- Tailwind CSS `4`
