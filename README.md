# Medical Second Opinion Platform

A secure, multilingual web application connecting patients with world-class medical specialists for expert second opinions.

## Features

### Patient Portal
- Secure onboarding with email/OAuth authentication
- Case creation wizard with document upload (PDF, DICOM, images)
- File encryption and virus scanning
- Payment processing (Standard 5-7 days, Express 1-3 days)
- Real-time case status tracking
- Secure messaging with assigned doctors
- Final opinion PDF delivery
- Optional video consultations

### Doctor Portal
- Verified specialist onboarding
- Case assignment queue with SLAs
- Structured opinion editor with versioning
- Multidisciplinary co-signing
- Availability management
- Video consultation scheduling

### Admin Console
- User and case management
- Doctor verification and triage
- Pricing plans and coupons
- Organization (B2B) management
- Analytics dashboard
- Content management (FAQs, ToS, Privacy)
- Comprehensive audit logs

### B2B Features
- Organization accounts (employers, insurers, banks, hospitals)
- Seat and allowance management
- SSO support (SAML/OIDC) - placeholder hooks
- Monthly invoicing mode

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js Server Actions + REST API
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: NextAuth (Email, OAuth, SSO hooks)
- **Storage**: S3-compatible (AWS S3) for encrypted files
- **Payments**: Stripe (one-time and subscriptions)
- **Internationalization**: next-intl (EN, HY, RU)
- **Email**: Resend/SendGrid
- **Video**: WebRTC or provider SDK (abstraction ready)

## Security & Compliance

- Role-Based Access Control (RBAC)
- PII/PHI data separation
- Encrypted file storage with signed URLs
- Row-level security checks
- Comprehensive audit logging
- Data retention and export/delete capabilities
- Consent management with version tracking

## Getting Started

### Prerequisites

- Node.js 18+ and npm 9+
- Docker and Docker Compose (for local development)
- PostgreSQL 16+

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd HFC
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and configure:
   - Database connection
   - NextAuth secret and OAuth credentials
   - AWS S3 credentials
   - Stripe keys
   - Email service credentials

4. **Start development services**
   ```bash
   docker-compose up -d
   ```

   This starts:
   - PostgreSQL (port 5432)
   - Redis (port 6379)
   - MinIO (ports 9000, 9001)
   - MailHog (ports 1025, 8025)

5. **Set up the database**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

6. **Seed initial data (optional)**
   ```bash
   npm run prisma:seed
   ```

7. **Run the development server**
   ```bash
   npm run dev
   ```

8. **Open your browser**
   ```
   http://localhost:3000
   ```

## Development

### Project Structure

```
├── app/                    # Next.js App Router
│   ├── [locale]/          # Internationalized routes
│   │   ├── patient/       # Patient portal
│   │   ├── doctor/        # Doctor portal
│   │   ├── admin/         # Admin console
│   │   └── auth/          # Authentication pages
│   └── api/               # API routes
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── patient/          # Patient-specific components
│   ├── doctor/           # Doctor-specific components
│   └── admin/            # Admin-specific components
├── lib/                  # Utilities and configurations
│   ├── actions/          # Server actions
│   ├── auth.ts           # NextAuth config
│   ├── db.ts             # Prisma client
│   ├── utils.ts          # Utility functions
│   └── validation/       # Zod schemas
├── prisma/
│   └── schema.prisma     # Database schema
├── messages/             # i18n translations
│   ├── en.json
│   ├── hy.json
│   └── ru.json
└── types/                # TypeScript type definitions
```

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run prisma:generate` - Generate Prisma Client
- `npm run prisma:push` - Push schema changes to database
- `npm run prisma:studio` - Open Prisma Studio
- `npm test` - Run Vitest tests
- `npm run test:e2e` - Run Playwright E2E tests

### Database Management

```bash
# Generate Prisma Client
npm run prisma:generate

# Push schema changes (development)
npm run prisma:push

# Create migration (production)
npx prisma migrate dev --name <migration-name>

# Open Prisma Studio
npm run prisma:studio
```

### Adding a new UI component (shadcn/ui)

The project is set up to use shadcn/ui components. To add a new component:

```bash
npx shadcn-ui@latest add button
npx shadcn-ui@latest add dialog
npx shadcn-ui@latest add form
```

## Localization

The application supports three languages:
- English (en)
- Armenian (hy)
- Russian (ru)

Translations are stored in `messages/` directory. Add new keys to all three language files.

## Environment Variables

See `.env.example` for all required environment variables.

### Required Variables
- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_URL` - Application URL
- `NEXTAUTH_SECRET` - Secret for NextAuth (generate with `openssl rand -base64 32`)

### Optional Variables
- OAuth credentials (Google, etc.)
- AWS S3 credentials
- Stripe API keys
- Email service credentials

## Deployment

### Docker Production Build

```bash
docker build -t medical-second-opinion .
docker run -p 3000:3000 medical-second-opinion
```

### Environment-specific Builds

The application supports different environments via environment variables:
- Development: `NODE_ENV=development`
- Production: `NODE_ENV=production`

## Testing

### Unit Tests (Vitest)
```bash
npm test
```

### E2E Tests (Playwright)
```bash
npm run test:e2e
```

## Security Considerations

1. **File Upload**: All files are scanned for viruses and encrypted before storage
2. **Access Control**: Row-level security checks on all PHI/PII data
3. **Audit Logging**: All sensitive actions are logged
4. **Data Encryption**: Files encrypted at rest in S3
5. **Signed URLs**: Time-limited access to sensitive files
6. **HTTPS Only**: Force HTTPS in production

## Contributing

1. Create a feature branch
2. Make your changes
3. Add tests
4. Submit a pull request

## License

Proprietary - All rights reserved

## Support

For issues and questions, contact: support@example.com
