This is the **Fluid Admin Dashboard** - a secure admin interface for managing Stellar fee sponsorship operations.

## Authentication

The admin dashboard uses NextAuth.js for secure authentication with the following features:

- **Protected Routes**: All `/admin/*` routes require authentication
- **Credentials Provider**: Email/password authentication with bcrypt hashing
- **Session Management**: JWT-based sessions with 8-hour expiry
- **Security**: Timing-safe comparisons, CSRF protection, secure cookies

### Environment Variables

Create a `.env.local` file with the following variables:

```bash
# Required: Random 32+ character secret for JWT signing
AUTH_SECRET=

# Required: Admin login email address
ADMIN_EMAIL=

# Required: bcrypt hash of admin password
ADMIN_PASSWORD_HASH=

# Optional: Development URL (defaults to http://localhost:3001)
NEXTAUTH_URL=http://localhost:3001
```

#### Generate AUTH_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

#### Generate ADMIN_PASSWORD_HASH:
```bash
# Replace 'your-password' with your actual password
node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('your-password', 12));"
```

### Route Protection

- **Unauthenticated users** accessing `/admin/*` are redirected to `/login`
- **Authenticated users** accessing `/login` are redirected to `/admin/dashboard`
- **Static assets** and Next.js internals are automatically excluded

### Security Notes

- In production, ensure `NEXTAUTH_URL` uses HTTPS for secure cookies
- Session cookies are `httpOnly` and `secure` (in production)
- No credentials or tokens are ever logged
- Password validation uses timing-safe comparisons

## Getting Started

First, install dependencies and configure environment variables:

```bash
npm install
# Create .env.local with the variables above
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) with your browser to access the login page.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
